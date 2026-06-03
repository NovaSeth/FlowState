import AppKit
import ServiceManagement

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let controller = ServerController()
    private var statusItem: NSStatusItem!
    private var controlServer: ControlServer?
    /// Lazily created on first "Open Dashboard"; reused across opens.
    private var dashboardWindow: DashboardWindowController?

    private var state: ServerState = .unknown {
        didSet { if oldValue != state { renderState() } }
    }

    private var stats: ServerController.Stats?

    // Optimistic transition handling: while a Start/Stop/Restart is in flight we
    // show a transitional label and poll fast until the base state reaches the
    // target (or we time out).
    private var transitionTarget: ServerState?
    private var transitionDeadline: Date?

    private var pollTimer: Timer?
    private let slowInterval: TimeInterval = 4
    private let fastInterval: TimeInterval = 1

    // Icon "blink" on server API activity (only while running).
    private var pulseTimer: Timer?
    private var lastPulse: Int?
    private let pulseInterval: TimeInterval = 0.8

    private let work = DispatchQueue(label: "com.flowstate.menubar.work", qos: .utility)

    // MARK: - lifecycle

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let menu = NSMenu()
        menu.delegate = self            // rebuilt fresh each time it opens
        statusItem.menu = menu
        renderState()

        // Autostart: register as a login item on the FIRST ever launch only.
        // After that we honor the user's toggle choice (persisted in UserDefaults)
        // instead of re-enabling it on every launch (which would override a user
        // who deliberately turned it off).
        registerLoginItemIfFirstLaunch()

        // Local control port (web Settings: Start/Stop/Restart). Server port + 1.
        let cs = ControlServer(port: UInt16(controller.port + 1))
        cs.onCommand = { [weak self] cmd in
            switch cmd {
            case "start": self?.startServer()
            case "stop": self?.stopServer()
            case "restart": self?.restartServer()
            default: break
            }
        }
        cs.start()
        controlServer = cs
        controlServer?.updateStatus(token(displayState()))

        schedulePoll(interval: slowInterval)
        pulseTimer = Timer.scheduledTimer(withTimeInterval: pulseInterval, repeats: true) { [weak self] _ in
            self?.checkPulse()
        }
        // Bring the server up on launch (i.e. at login) unless it already runs.
        // `--no-server` skips this: the app then drives an externally-managed server
        // (e.g. `npm run dev` in a terminal) instead of owning the child process.
        if !CommandLine.arguments.contains("--no-server") {
            startServerIfNeeded()
        }

        // Optional: open straight to the dashboard window on launch (for a
        // Spotlight/Dock launcher, or testing). Normal login launch stays menu-bar
        // only (no window) per the autostart design.
        if CommandLine.arguments.contains("--open-dashboard") {
            openDashboard()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        // The server is our child process; tear it down cleanly on quit. With
        // `--no-server` we do not own it (external dev server), so leave it running.
        if !CommandLine.arguments.contains("--no-server") {
            controller.stop()
        }
    }

    // MARK: - menu

    // MARK: - menu delegate (rebuild on open, refresh data for next time)

    func menuNeedsUpdate(_ menu: NSMenu) {
        populate(menu)
    }

    func menuWillOpen(_ menu: NSMenu) {
        refreshNow()   // pull fresh state + stats; next open shows them
    }

    private func populate(_ menu: NSMenu) {
        menu.removeAllItems()
        let ds = displayState()

        // --- status (left-aligned: colored dot as the leading icon) ---------
        // Enabled while serving so the label stays full-color (only the ip:port
        // is dimmed); clicking it opens the dashboard.
        let statusOpens = (ds == .running)
        let status = item("", statusOpens ? #selector(openDashboard) : nil, enabled: statusOpens)
        status.attributedTitle = statusHeader(ds)
        status.image = symbol("circle.fill", color: FlowIcon.dotColor(for: ds))
        menu.addItem(status)

        // --- Today and Needs-attention: each its own section ----------------
        if ds == .running, let s = stats {
            menu.addItem(.separator())
            let today = item(todaySummary(s), #selector(openDashboard), enabled: true)
            today.image = symbol("checkmark", color: nil)
            today.toolTip = "Completed today - \(s.percent)% overall. Opens the dashboard."
            menu.addItem(today)

            if s.needsAttention > 0 {
                menu.addItem(.separator())
                let noun = s.needsAttention == 1 ? "task needs attention" : "tasks need attention"
                let attn = item("\(s.needsAttention) \(noun)", #selector(openDashboard), enabled: true)
                attn.image = symbol("exclamationmark.triangle.fill", color: .systemOrange)
                attn.toolTip = "Blocked tasks - opens the dashboard to unblock them"
                menu.addItem(attn)
            }
        }

        // --- server actions for the current state ---------------------------
        menu.addItem(.separator())
        switch ds {
        case .running:
            menu.addItem(item("Restart Server", #selector(restartServer), enabled: true))
            menu.addItem(item("Stop Server", #selector(stopServer), enabled: true))
        case .stopped, .unknown:
            menu.addItem(item("Start Server", #selector(startServer), enabled: true))
        case .starting:
            menu.addItem(item("Stop Server", #selector(stopServer), enabled: true))   // cancel
        case .stopping:
            menu.addItem(item("Stopping...", nil, enabled: false))
        }

        // --- app-level --------------------------------------------------------
        menu.addItem(.separator())
        // Browser path stays available (DevTools / sharing the LAN URL); only
        // meaningful while the server actually serves.
        menu.addItem(item("Open in Browser", #selector(openInBrowser), enabled: ds == .running))
        menu.addItem(item("View Logs", #selector(viewLogs), enabled: true))

        let login = item("Launch at Login", #selector(toggleOpenAtLogin), enabled: true)
        login.state = isLoginEnabled() ? .on : .off
        login.toolTip = "Start Flow State (and the server) automatically when you log in"
        menu.addItem(login)

        menu.addItem(.separator())
        menu.addItem(item("Quit Flow State (app & server)", #selector(quit), enabled: true))
    }

    private func item(_ title: String, _ action: Selector?, enabled: Bool) -> NSMenuItem {
        let mi = NSMenuItem(title: title, action: action, keyEquivalent: "")
        mi.target = self
        mi.isEnabled = enabled
        return mi
    }

    private func symbol(_ name: String, color: NSColor?) -> NSImage? {
        guard let base = NSImage(systemSymbolName: name, accessibilityDescription: nil) else { return nil }
        if let color = color {
            let cfg = NSImage.SymbolConfiguration(paletteColors: [color])
            let img = base.withSymbolConfiguration(cfg) ?? base
            img.isTemplate = false
            return img
        }
        base.isTemplate = true   // tint with the menu text color
        return base
    }

    private func todaySummary(_ s: ServerController.Stats) -> String {
        var parts = ["\(s.todayTasks) task\(s.todayTasks == 1 ? "" : "s")"]
        if s.todayMilestones > 0 { parts.append("\(s.todayMilestones) milestone\(s.todayMilestones == 1 ? "" : "s")") }
        if s.todayProjects > 0 { parts.append("\(s.todayProjects) project\(s.todayProjects == 1 ? "" : "s")") }
        return "Today: " + parts.joined(separator: " . ")
    }

    /// Header label: the state (full color) and, when up, the dimmed endpoint.
    /// The colored dot is the menu item's leading image, so this is left-aligned.
    private func statusHeader(_ ds: ServerState) -> NSAttributedString {
        let s = NSMutableAttributedString(string: ds.label, attributes: [
            .foregroundColor: NSColor.labelColor,
            .font: NSFont.boldSystemFont(ofSize: 13)
        ])
        if ds == .running {
            s.append(NSAttributedString(string: "   \(controller.host)", attributes: [
                .foregroundColor: NSColor.secondaryLabelColor,
                .font: NSFont.systemFont(ofSize: 11)
            ]))
        }
        return s
    }


    private func renderState() {
        let ds = displayState()
        statusItem.button?.image = FlowIcon.image(for: ds)
        statusItem.button?.toolTip = "Flow State - \(ds.label)"
        controlServer?.updateStatus(token(ds))   // web Settings reads this state
        dashboardWindow?.serverStateChanged(ds)   // native window: copy + auto-reload
        // The menu rebuilds itself from current state/stats on open
        // (menuNeedsUpdate), so there is nothing else to do here.
    }

    /// State token for the web (GET /status on the control port).
    private func token(_ s: ServerState) -> String {
        switch s {
        case .running:  return "running"
        case .stopped:  return "stopped"
        case .starting: return "starting"
        case .stopping: return "stopping"
        case .unknown:  return "unknown"
        }
    }

    private func displayState() -> ServerState {
        if let target = transitionTarget {
            return target == .stopped ? .stopping : .starting
        }
        return state
    }

    // MARK: - activity blink

    private func checkPulse() {
        guard state == .running else { lastPulse = nil; return }
        work.async {
            self.controller.fetchPulse { count in
                guard let count = count else { return }
                DispatchQueue.main.async {
                    if let last = self.lastPulse, count > last { self.blink() }
                    self.lastPulse = count
                }
            }
        }
    }

    /// Quick flicker of the menu-bar icon to signal API activity.
    private func blink() {
        guard let btn = statusItem.button else { return }
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.07
            btn.animator().alphaValue = 0.3
        }, completionHandler: {
            NSAnimationContext.runAnimationGroup { ctx in
                ctx.duration = 0.2
                btn.animator().alphaValue = 1.0
            }
        })
    }

    // MARK: - actions

    /// Open the native dashboard window (default). Shows the Dock icon while it is
    /// up; the window itself shows a branded splash if the server is not yet serving.
    @objc private func openDashboard() {
        if dashboardWindow == nil {
            let w = DashboardWindowController(controller: controller)
            w.onWindowClose = {
                // Drop the Dock icon; stay a menu-bar accessory.
                NSApp.setActivationPolicy(.accessory)
            }
            dashboardWindow = w
        }
        NSApp.setActivationPolicy(.regular)
        dashboardWindow?.serverStateChanged(displayState())
        dashboardWindow?.show()
    }

    /// Secondary path: open the dashboard in the default browser (DevTools, sharing
    /// the LAN URL). Disabled when the server is not serving.
    @objc private func openInBrowser() { NSWorkspace.shared.open(controller.dashboardURL) }

    @objc private func viewLogs() {
        NSWorkspace.shared.open(URL(fileURLWithPath: controller.logPath))
    }

    @objc private func startServer() { beginTransition(target: .running) { self.controller.start() } }
    @objc private func stopServer()  { beginTransition(target: .stopped) { self.controller.stop() } }
    @objc private func restartServer() { beginTransition(target: .running) { self.controller.restart() } }

    private func startServerIfNeeded() {
        if controller.isProcessAlive() { refreshNow(); return }
        beginTransition(target: .running) { self.controller.start() }
    }

    @objc private func toggleOpenAtLogin() {
        let enable = !isLoginEnabled()
        if #available(macOS 13.0, *) {
            do {
                if enable { try SMAppService.mainApp.register() }
                else      { try SMAppService.mainApp.unregister() }
                // Persist the explicit choice so launch does not override it.
                UserDefaults.standard.set(enable, forKey: Self.loginChoiceKey)
            } catch {
                NSLog("FlowState: toggle login item failed: \(error)")
            }
        }
        renderState()
    }

    @objc private func quit() { NSApp.terminate(nil) }

    // MARK: - transitions + polling

    private func beginTransition(target: ServerState, action: @escaping () -> Void) {
        transitionTarget = target
        transitionDeadline = Date().addingTimeInterval(30)
        renderState()
        schedulePoll(interval: fastInterval)
        work.async {
            action()
            DispatchQueue.main.async { self.refreshNow() }
        }
    }

    private func schedulePoll(interval: TimeInterval) {
        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            self?.refreshNow()
        }
    }

    private func refreshNow() {
        work.async {
            self.controller.refreshState { base in
                DispatchQueue.main.async {
                    self.applyBaseState(base)
                    if base == .running {
                        self.controller.fetchStats { s in
                            DispatchQueue.main.async {
                                self.stats = s
                                self.renderState()
                            }
                        }
                    } else if self.stats != nil {
                        self.stats = nil
                        self.renderState()
                    }
                }
            }
        }
    }

    private func applyBaseState(_ base: ServerState) {
        if let target = transitionTarget {
            let reached = (target == base)
            let expired = (transitionDeadline.map { Date() >= $0 } ?? true)
            if reached || expired {
                transitionTarget = nil
                transitionDeadline = nil
                state = base
                schedulePoll(interval: slowInterval)
            } else {
                // still transitioning: keep the transitional display, keep polling fast
                renderState()
            }
        } else {
            state = base
        }
    }

    // MARK: - login item for this controller app

    /// UserDefaults keys: whether we have ever launched, and the user's last
    /// explicit Launch-at-Login choice.
    private static let firstLaunchDoneKey = "com.flowstate.firstLaunchDone"
    private static let loginChoiceKey = "com.flowstate.launchAtLogin"

    /// On the very first launch, opt the user into autostart (so installing the
    /// app "just works"). On later launches we do NOT touch the registration -
    /// the user's toggle choice (persisted by toggleOpenAtLogin) is authoritative,
    /// so a deliberate "off" is not silently re-enabled.
    private func registerLoginItemIfFirstLaunch() {
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: Self.firstLaunchDoneKey) else { return }
        defaults.set(true, forKey: Self.firstLaunchDoneKey)
        if #available(macOS 13.0, *) {
            do {
                if SMAppService.mainApp.status != .enabled {
                    try SMAppService.mainApp.register()
                }
                defaults.set(true, forKey: Self.loginChoiceKey)
            } catch {
                NSLog("FlowState: could not register login item: \(error)")
            }
        }
    }

    private func isLoginEnabled() -> Bool {
        if #available(macOS 13.0, *) {
            return SMAppService.mainApp.status == .enabled
        }
        return false
    }
}
