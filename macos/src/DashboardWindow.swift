import AppKit
import SwiftUI

/// Native dashboard window: hosts the SwiftUI `DashboardRootView` via an
/// `NSHostingController`. The window is created once and reused across opens, so
/// reopening (Dock/Spotlight click) just brings it to front WITHOUT reloading -
/// the view state lives in the AppStore and is preserved. Liveness/offline is
/// handled inside SwiftUI (EventStream + OfflineOverlay), so there is no WKWebView
/// load-time splash anymore.
///
/// The window owner (AppDelegate) flips the app's activation policy to `.regular`
/// while the window is open (Dock icon) and back to `.accessory` on close.
@MainActor
final class DashboardWindowController: NSObject, NSWindowDelegate {
    private let controller: ServerController
    private var window: NSWindow?
    private var store: AppStore?

    /// Called when the window closes so the owner can drop the Dock icon.
    var onWindowClose: (() -> Void)?

    init(controller: ServerController) {
        self.controller = controller
        super.init()
    }

    /// Create the window on first use, then bring it to front. No reload: the
    /// AppStore keeps the current section/selection across opens.
    func show() {
        let firstBuild = (window == nil)
        if firstBuild { buildWindow() }
        guard let window else { return }
        window.makeKeyAndOrderFront(nil)
        ensureOnScreen(window)
        NSApp.activate(ignoringOtherApps: true)
        // First open relies on the root view's `.task { bootstrap() }`; a reopen
        // (the stream was suspended on the previous close) resumes it and catches up.
        if !firstBuild, let store {
            _Concurrency.Task { await store.resumeLive() }
        }
    }

    /// Keep the window fully inside the active screen's visible area. A stale saved
    /// frame (setFrameAutosaveName) can otherwise place the title bar at or above the
    /// menu bar, so its top is clipped by the menu bar - which reads as "the app is
    /// cut off at the top". constrainFrameRect pins the top edge below the menu bar.
    private func ensureOnScreen(_ window: NSWindow) {
        guard let screen = window.screen ?? NSScreen.main else { return }
        let fitted = window.constrainFrameRect(window.frame, to: screen)
        if fitted != window.frame { window.setFrame(fitted, display: true) }
    }

    private func buildWindow() {
        let api = FlowStateAPI(baseURL: controller.dashboardURL)
        let events = EventStream(baseURL: controller.dashboardURL)
        let store = AppStore(api: api, events: events)
        self.store = store

        let win = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1100, height: 720),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        win.title = "Flow State"
        win.minSize = NSSize(width: 960, height: 600)
        win.delegate = self
        win.setFrameAutosaveName("FlowStateDashboardWindow")
        win.isReleasedWhenClosed = false   // reuse the same window across opens
        win.backgroundColor = DS.nsColor("canvas")
        win.center()

        win.contentViewController = NSHostingController(
            rootView: DashboardRootView().environmentObject(store)
        )
        self.window = win
    }

    /// AppDelegate pushes server-state changes. When the server becomes ready,
    /// nudge a refetch of the visible slice (the store also auto-reconnects via SSE).
    func serverStateChanged(_ state: ServerState) {
        guard state == .running, let store else { return }
        _Concurrency.Task { await store.refetchVisible() }
    }

    // MARK: - NSWindowDelegate

    func windowWillClose(_ notification: Notification) {
        // Release the live SSE connection + watchdog while the window is gone; it
        // resumes on the next show(). Prevents an invisible stream/timer running for
        // the rest of the app's lifetime.
        store?.suspendLive()
        onWindowClose?()
    }
}
