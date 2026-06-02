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

/// Owns the Flow State server as a child process and probes it over HTTP.
///
/// The server (`npm run start`) is launched as a child of this GUI app rather
/// than a launchd agent, because the repo lives under ~/Documents (TCC-protected)
/// and only a user-launched .app gets the native "allow Documents access" grant.
/// Blocking calls (Process, URLSession) run off the main thread; callers marshal
/// results back to main.
final class ServerController {
    /// Repo dir, node bin and port are baked into Info.plist by build.sh.
    let repoDir: String
    let nodeBin: String
    let port: Int

    /// Serializes ALL access to the mutable state below. It is mutated from the
    /// AppDelegate work queue, the Process terminationHandler (Foundation's own
    /// queue) and the main thread, so every read/write goes through this queue
    /// (stateQueue.sync for reads, stateQueue.async/sync for writes).
    private let stateQueue = DispatchQueue(label: "com.flowstate.server.state")

    /// All four fields below are guarded by stateQueue - never touch directly.
    private var process: Process?
    /// Set while we deliberately stop, so the crash-relaunch logic stays quiet.
    private var intentionalStop = false
    /// Guard against a crash-loop hammering relaunch.
    private var recentRelaunches = 0
    private var relaunchWindowStart = Date()

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

    // MARK: - lifecycle

    func isProcessAlive() -> Bool {
        stateQueue.sync { process?.isRunning ?? false }
    }

    /// Spawn `npm run start` if not already running. Returns true if a process is
    /// (now) running.
    @discardableResult
    func start() -> Bool {
        if isProcessAlive() { return true }

        ensureLogDir()
        let handle = logHandle()

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/bash")
        // Login shell for a full PATH; prepend the known node bin to be safe.
        let inner = "cd \(shellQuote(repoDir)) && export PATH=\(shellQuote(nodeBin)):$PATH && export PORT=\(port) && exec npm run start"
        // Make the launched server lead its OWN process group so we can later
        // signal the whole subtree at once (npm spawns next as a grandchild;
        // signalling npm's pid alone may not reach next). Foundation.Process
        // cannot set the child's process group, so we have perl call setpgrp(0,0)
        // - making this process a new group leader whose pgid equals its pid -
        // and then exec the shell command in place. proc.processIdentifier is
        // therefore both the leader pid AND the pgid; killTree signals -pgid.
        // setsid(1) does not ship on macOS, but /usr/bin/perl always does.
        let cmd = "exec /usr/bin/perl -e 'setpgrp(0,0); exec \"/bin/bash\", \"-lc\", $ARGV[0] or die $!;' \(shellQuote(inner))"
        proc.arguments = ["-lc", cmd]
        if let handle = handle {
            proc.standardOutput = handle
            proc.standardError = handle
        }
        proc.terminationHandler = { [weak self] p in
            self?.handleTermination(p)
        }
        do {
            try proc.run()
            stateQueue.sync {
                intentionalStop = false
                process = proc
            }
            return true
        } catch {
            NSLog("FlowState: failed to start server: \(error)")
            return false
        }
    }

    /// Terminate the server child (and anything left on the port).
    @discardableResult
    func stop() -> Bool {
        // Atomically mark intentional + detach the process under the lock so the
        // terminationHandler (which also reads intentionalStop) sees a consistent
        // view and the crash-relaunch logic stays quiet.
        let proc: Process? = stateQueue.sync {
            intentionalStop = true
            let p = process
            process = nil
            return p
        }
        if let proc = proc, proc.isRunning {
            let pid = proc.processIdentifier
            killTree(pid: pid)                     // SIGTERM group, then SIGKILL
            proc.terminate()                       // SIGTERM the bash leader too
        }
        killPort()                                 // belt-and-suspenders
        return true
    }

    @discardableResult
    func restart() -> Bool {
        stop()
        // Small gap so the port frees before we rebind.
        Thread.sleep(forTimeInterval: 0.4)
        return start()
    }

    private func handleTermination(_ p: Process) {
        // Runs on Foundation's own queue. Read AND mutate the crash-loop counters
        // under stateQueue so we stay consistent with start()/stop(). `shouldRelaunch`
        // captures the decision atomically; only the (cheap) relaunch scheduling
        // happens outside the lock.
        let shouldRelaunch: Bool = stateQueue.sync {
            if intentionalStop { return false }
            // Unexpected exit: relaunch like launchd KeepAlive, with a loop guard.
            if Date().timeIntervalSince(relaunchWindowStart) > 60 {
                relaunchWindowStart = Date()
                recentRelaunches = 0
            }
            recentRelaunches += 1
            guard recentRelaunches <= 5 else {
                NSLog("FlowState: server crash-looping, not relaunching")
                return false
            }
            return true
        }
        guard shouldRelaunch else { return }
        NSLog("FlowState: server exited unexpectedly, relaunching")
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 1.0) { [weak self] in
            guard let self = self else { return }
            // Re-check intentionalStop under the lock - the user may have hit Stop
            // during the 1s delay.
            let stopped = self.stateQueue.sync { self.intentionalStop }
            if stopped { return }
            self.start()
        }
    }

    // MARK: - stats (from /api/dashboard)

    /// Glanceable numbers shown in the menu.
    struct Stats {
        let needsAttention: Int   // blocked tasks waiting to be unblocked
        let todayTasks: Int
        let todayMilestones: Int
        let todayProjects: Int
        let percent: Int          // overall completion
    }

    func fetchStats(completion: @escaping (Stats?) -> Void) {
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
    func fetchPulse(completion: @escaping (Int?) -> Void) {
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
    func probeHTTP(completion: @escaping (Bool) -> Void) {
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

    /// Derive a base state: HTTP is authoritative for "serving"; a live child
    /// that is not yet serving means "starting".
    func refreshState(completion: @escaping (ServerState) -> Void) {
        let alive = isProcessAlive()
        probeHTTP { serving in
            if serving {
                completion(.running)
            } else if alive {
                completion(.starting)
            } else {
                completion(.stopped)
            }
        }
    }

    // MARK: - helpers

    private func ensureLogDir() {
        let dir = (logPath as NSString).deletingLastPathComponent
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    }

    private func logHandle() -> FileHandle? {
        let fm = FileManager.default
        if !fm.fileExists(atPath: logPath) { fm.createFile(atPath: logPath, contents: nil) }
        guard let h = FileHandle(forWritingAtPath: logPath) else { return nil }
        h.seekToEndOfFile()
        return h
    }

    /// Kill the process subtree rooted at pid (SIGTERM then SIGKILL).
    ///
    /// start() makes the child a process-group leader (pgid == pid via perl's
    /// setpgrp), so signalling the negative pgid reaches the whole subtree
    /// (bash -> npm -> next ...) in one shot. We also signal the pid directly as
    /// a safety net, and killPort() sweeps any survivor on the port.
    private func killTree(pid: pid_t) {
        guard pid > 0 else { return }
        let pgid = pid                 // child leads its own group (see start()).
        kill(-pgid, SIGTERM)           // whole group
        kill(pid, SIGTERM)             // and the leader, in case it is not a group leader
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 2.0) {
            kill(-pgid, SIGKILL)
            kill(pid, SIGKILL)
        }
    }

    /// Kill whatever is listening on the server port (cleans up orphans).
    private func killPort() {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/bash")
        proc.arguments = ["-lc", "lsof -ti tcp:\(port) -sTCP:LISTEN | xargs kill -9 2>/dev/null || true"]
        try? proc.run()
        proc.waitUntilExit()
    }

    private func shellQuote(_ s: String) -> String {
        "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}
