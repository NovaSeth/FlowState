import AppKit
import ServiceManagement

// The whole controller lives on the main thread (status item, menu, NSApp, timers).
// Making that explicit isolates every method to the main actor, so AppKit access is
// checked-correct; blocking server I/O is the only thing hopped onto `work`.
@MainActor
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

    private let work = DispatchQueue(label: "com.flowstate.menubar.work", qos: .utility)

    // MARK: - lifecycle

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let menu = NSMenu()
        menu.delegate = self            // rebuilt fresh each time it opens
        // Make our explicit per-item isEnabled authoritative. With the default
        // auto-validation, AppKit would re-enable any item with a valid action+target
        // (e.g. "Open in Browser") regardless of the enabled: we pass, so it would
        // stay clickable while the server is down.
        menu.autoenablesItems = false
        statusItem.menu = menu
        installMainMenu()
        renderState()

        // Autostart: register as a login item on the FIRST ever launch only.
        // After that we never re-register at launch, so the user's toggle choice
        // (reflected by SMAppService.mainApp.status) stands - a deliberate "off" is
        // not silently re-enabled.
        registerLoginItemIfFirstLaunch()

        // Local control port (web Settings: Start/Stop/Restart). Server port + 1.
        let cs = ControlServer(port: UInt16(controller.port + 1))
        // ControlServer always invokes this on the main thread (see its route()).
        cs.onCommand = { [weak self] cmd in
            MainActor.assumeIsolated {
                switch cmd {
                case "start": self?.startServer()
                case "stop": self?.stopServer()
                case "restart": self?.restartServer()
                default: break
                }
            }
        }
        cs.start()
        controlServer = cs
        controlServer?.updateStatus(token(displayState()))

        schedulePoll(interval: slowInterval)
        // Nudge the independent server agent up if it is installed but not serving.
        // The app does NOT own the server (it is a launchd agent); this is just a
        // convenience. `--no-server` skips even the nudge (pure observer).
        if !CommandLine.arguments.contains("--no-server") {
            startServerIfNeeded()
        } else {
            refreshNow()
        }

        // Optional: open straight to the dashboard window on launch (for a
        // Spotlight/Dock launcher, or testing). Normal login launch stays menu-bar
        // only (no window) per the autostart design.
        if CommandLine.arguments.contains("--open-dashboard") {
            openDashboard()
        }
    }

    /// Clicking the app in Launchpad / Finder / Dock while it is already running
    /// (it autostarts at login, so it usually is) fires this. Without it, a
    /// menu-bar (accessory) app would just do nothing - confusing. Open or re-focus
    /// the dashboard window so the icon behaves the way users expect.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        openDashboard()
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        // Full shutdown on quit: tear down the whole Flow State stack, not just this
        // client. Quitting the app (menu item, Cmd+Q, Dock) also stops the independent
        // server agent, so nothing is left serving. (A crash/rebuild does NOT reach
        // here, so an unexpected exit still leaves the server up.)
        controller.stop()
    }

    /// Install a standard NSMainMenu so the app has a real menu bar (an "About /
    /// Hide / Quit" app menu named "Flow State" and an Edit menu) when the
    /// dashboard window is focused. As a status-bar accessory app we had none, so
    /// Cmd+Q and copy/paste did not work; this fixes that. The app menu title is
    /// taken from CFBundleName automatically, so it reads "Flow State".
    private func installMainMenu() {
        let mainMenu = NSMenu()
        let appName = "Flow State"

        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu
        appMenu.addItem(withTitle: "About \(appName)",
                        action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide \(appName)",
                        action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: "Hide Others",
                                         action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "Show All",
                        action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit \(appName)",
                        action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "Edit")
        editItem.submenu = editMenu
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        // Standard Window menu (Minimize / Zoom / Close) so the app behaves like a
        // normal Mac app when the dashboard window is up. NSApp.windowsMenu wires the
        // automatic window list.
        let windowItem = NSMenuItem()
        mainMenu.addItem(windowItem)
        let windowMenu = NSMenu(title: "Window")
        windowItem.submenu = windowMenu
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(.separator())
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = mainMenu
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
        menu.addItem(item("Quit Flow State & Stop Server", #selector(quit), enabled: true))
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
        // If the agent is installed, ensure it is up (idempotent kickstart); else we
        // can only observe whatever server happens to be serving.
        guard controller.isAgentInstalled else { refreshNow(); return }
        beginTransition(target: .running) { self.controller.start() }
    }

    @objc private func toggleOpenAtLogin() {
        let enable = !isLoginEnabled()
        if #available(macOS 13.0, *) {
            do {
                if enable { try SMAppService.mainApp.register() }
                else      { try SMAppService.mainApp.unregister() }
            } catch {
                NSLog("FlowState: toggle login item failed: \(error)")
            }
        }
        renderState()
    }

    @objc private func quit() { NSApp.terminate(nil) }

    // MARK: - transitions + polling

    private func beginTransition(target: ServerState, action: @escaping @Sendable () -> Void) {
        transitionTarget = target
        transitionDeadline = Date().addingTimeInterval(30)
        renderState()
        schedulePoll(interval: fastInterval)
        // `action` is the blocking server call (start/stop/restart) - run it off the
        // main actor, then hop back to refresh.
        work.async { [weak self] in
            action()
            _Concurrency.Task { @MainActor in self?.refreshNow() }
        }
    }

    private func schedulePoll(interval: TimeInterval) {
        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.refreshNow() }
        }
    }

    private func refreshNow() {
        // refreshState / fetchStats are non-blocking (URLSession); call directly and
        // hop each result back onto the main actor.
        controller.refreshState { [weak self] base in
            _Concurrency.Task { @MainActor in
                guard let self else { return }
                self.applyBaseState(base)
                if base == .running {
                    self.controller.fetchStats { [weak self] s in
                        _Concurrency.Task { @MainActor in
                            guard let self else { return }
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

    /// UserDefaults key: whether we have ever opted the user into autostart.
    private static let firstLaunchDoneKey = "com.flowstate.firstLaunchDone"

    /// On the very first launch, opt the user into autostart (so installing the app
    /// "just works"). On later launches we do NOT touch the registration -
    /// SMAppService.mainApp.status is the single source of truth (read by
    /// isLoginEnabled / toggled by the menu), and nothing re-registers at launch, so
    /// a deliberate "off" is never silently re-enabled.
    private func registerLoginItemIfFirstLaunch() {
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: Self.firstLaunchDoneKey) else { return }
        if #available(macOS 13.0, *) {
            do {
                if SMAppService.mainApp.status != .enabled {
                    try SMAppService.mainApp.register()
                }
                // Record first-launch-done only AFTER a successful registration, so a
                // transient failure (e.g. an unsigned dev build) is retried next
                // launch instead of permanently abandoning the autostart opt-in.
                defaults.set(true, forKey: Self.firstLaunchDoneKey)
            } catch {
                NSLog("FlowState: could not register login item: \(error)")
            }
        } else {
            // No SMAppService before macOS 13: nothing to register, do not retry.
            defaults.set(true, forKey: Self.firstLaunchDoneKey)
        }
    }

    private func isLoginEnabled() -> Bool {
        if #available(macOS 13.0, *) {
            return SMAppService.mainApp.status == .enabled
        }
        return false
    }
}
