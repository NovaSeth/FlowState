import Foundation

/// Observable server state, shared by the controller, the menu and the icon.
enum ServerState {
    case running
    case stopped
    case starting
    case stopping
    case unknown

    var label: String {
        switch self {
        case .running:  return "Running"
        case .stopped:  return "Stopped"
        case .starting: return "Starting..."
        case .stopping: return "Stopping..."
        case .unknown:  return "Unknown"
        }
    }
}

/// Client view of the INDEPENDENT Flow State server.
///
/// The server runs as its own launchd LaunchAgent (`com.flowstate.server`): started
/// at login, kept alive by launchd, and completely separate from this app. This app
/// is a CLIENT - it probes the server over HTTP for status and can ask launchd to
/// start/stop/restart the agent, but it never owns the server as a child process and
/// never stops it on quit. The server therefore survives the app crashing, quitting
/// or being rebuilt/re-signed.
///
/// Why a LaunchAgent + Full Disk Access: the repo lives under ~/Documents, which is
/// TCC-protected; a launchd agent must be granted Full Disk Access on `node` to read
/// it. install.sh installs the agent and guides that one-time grant.
///
/// `@unchecked Sendable`: it holds only immutable config (let), so it is trivially
/// safe to share across the menu work queue and the main actor.
final class ServerController: @unchecked Sendable {
    /// Repo dir, node bin and port are baked into Info.plist by build.sh.
    let repoDir: String
    let nodeBin: String
    let port: Int

    /// launchd label / paths for the independent server agent (must match install.sh).
    let agentLabel = "com.flowstate.server"

    init() {
        let info = Bundle.main.infoDictionary
        repoDir = (info?["FSRepoDir"] as? String) ?? FileManager.default.currentDirectoryPath
        nodeBin = (info?["FSNodeBin"] as? String) ?? "/opt/homebrew/bin"
        port = Int((info?["FSPort"] as? String) ?? "3000") ?? 3000
    }

    var logPath: String {
        (NSHomeDirectory() as NSString)
            .appendingPathComponent("Library/Logs/FlowState/server.log")
    }

    var dashboardURL: URL { URL(string: "http://localhost:\(port)/")! }
    var host: String { "localhost:\(port)" }

    private var agentTarget: String { "gui/\(getuid())/\(agentLabel)" }
    private var plistPath: String {
        (NSHomeDirectory() as NSString)
            .appendingPathComponent("Library/LaunchAgents/\(agentLabel).plist")
    }

    // MARK: - agent control (launchctl on the independent server)

    /// Whether the LaunchAgent is installed (its plist exists). When false, the
    /// server was not set up via install.sh and the app can only observe.
    var isAgentInstalled: Bool { FileManager.default.fileExists(atPath: plistPath) }

    /// Load (if needed) and (re)start the agent. Idempotent: a bootstrap of an
    /// already-loaded agent fails harmlessly, then kickstart ensures it is running.
    @discardableResult
    func start() -> Bool {
        guard isAgentInstalled else { return false }
        _ = runLaunchctl(["bootstrap", "gui/\(getuid())", plistPath])
        _ = runLaunchctl(["kickstart", agentTarget])
        return true
    }

    /// Stop the agent (and disable KeepAlive revival) until the next start.
    @discardableResult
    func stop() -> Bool {
        guard isAgentInstalled else { return false }
        _ = runLaunchctl(["bootout", agentTarget])
        return true
    }

    /// Restart the running server in place (launchd respawns it immediately).
    @discardableResult
    func restart() -> Bool {
        guard isAgentInstalled else { return false }
        // kickstart -k of a loaded agent restarts it; if it was not loaded, fall
        // back to a fresh bootstrap+kickstart.
        if runLaunchctl(["kickstart", "-k", agentTarget]) != 0 {
            return start()
        }
        return true
    }

    @discardableResult
    private func runLaunchctl(_ args: [String]) -> Int32 {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        proc.arguments = args
        proc.standardOutput = nil
        proc.standardError = nil
        do {
            try proc.run()
            proc.waitUntilExit()
            return proc.terminationStatus
        } catch {
            NSLog("FlowState: launchctl \(args.first ?? "") failed: \(error)")
            return -1
        }
    }

    // MARK: - stats (from /api/dashboard)

    /// Glanceable numbers shown in the menu.
    struct Stats: Sendable {
        let needsAttention: Int   // blocked tasks waiting to be unblocked
        let todayTasks: Int
        let todayMilestones: Int
        let todayProjects: Int
        let percent: Int          // overall completion
    }

    func fetchStats(completion: @escaping @Sendable (Stats?) -> Void) {
        var req = URLRequest(url: dashboardURL.appendingPathComponent("api/dashboard"))
        req.timeoutInterval = 2.0
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.setValue("1", forHTTPHeaderField: "x-fs-monitor")   // do not count our own polling
        URLSession.shared.dataTask(with: req) { data, _, _ in
            guard let data = data,
                  let dash = try? JSONDecoder().decode(DashboardDTO.self, from: data) else {
                completion(nil); return
            }
            completion(Stats(
                needsAttention: dash.statusCounts.blocked,
                todayTasks: dash.completedToday.tasks,
                todayMilestones: dash.completedToday.milestones,
                todayProjects: dash.completedToday.projects,
                percent: dash.progress.percent
            ))
        }.resume()
    }

    /// Poll the lightweight API-activity counter. Used to "blink" the icon when
    /// other clients (dashboard, agents) hit the API. Carries the monitor header
    /// so our own poll does not inflate the count.
    func fetchPulse(completion: @escaping @Sendable (Int?) -> Void) {
        var req = URLRequest(url: dashboardURL.appendingPathComponent("api/pulse"))
        req.timeoutInterval = 1.0
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.setValue("1", forHTTPHeaderField: "x-fs-monitor")
        URLSession.shared.dataTask(with: req) { data, _, _ in
            guard let data = data,
                  let dto = try? JSONDecoder().decode(PulseDTO.self, from: data) else {
                completion(nil); return
            }
            completion(dto.count)
        }.resume()
    }

    private struct PulseDTO: Decodable { let count: Int }

    // Minimal decode of just the fields we surface.
    private struct DashboardDTO: Decodable {
        struct StatusCounts: Decodable { let blocked: Int }
        struct Today: Decodable { let tasks: Int; let milestones: Int; let projects: Int }
        struct Progress: Decodable { let percent: Int }
        let statusCounts: StatusCounts
        let completedToday: Today
        let progress: Progress
    }

    // MARK: - HTTP probe

    /// GET the dashboard with a short timeout. 2xx/3xx implies the server serves.
    func probeHTTP(completion: @escaping @Sendable (Bool) -> Void) {
        var req = URLRequest(url: dashboardURL)
        req.httpMethod = "GET"
        req.timeoutInterval = 1.5
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.setValue("1", forHTTPHeaderField: "x-fs-monitor")
        URLSession.shared.dataTask(with: req) { _, response, _ in
            if let http = response as? HTTPURLResponse, (200..<400).contains(http.statusCode) {
                completion(true)
            } else {
                completion(false)
            }
        }.resume()
    }

    /// Derive the base state purely from the HTTP probe (the server is an external
    /// agent, so "serving" is the only thing we can observe). Transitional
    /// starting/stopping is driven by the menu while a launchctl command settles.
    func refreshState(completion: @escaping @Sendable (ServerState) -> Void) {
        probeHTTP { serving in
            completion(serving ? .running : .stopped)
        }
    }
}
