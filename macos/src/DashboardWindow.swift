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
        if window == nil { buildWindow() }
        guard let window else { return }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
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
        onWindowClose?()
    }
}
