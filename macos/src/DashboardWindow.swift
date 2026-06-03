import AppKit
import WebKit

/// Native dashboard window: a thin WKWebView hosting the same web UI, plus a
/// branded "reconnect" overlay shown when the page cannot LOAD (server not up at
/// navigation time, or a hard reload against a dead server). That load-time gap is
/// the one the in-web OfflineOverlay cannot cover (nothing serves the page, so the
/// browser would show its own ERR_CONNECTION_REFUSED). Once the page is loaded, a
/// mid-session server death is handled by the web overlay instead; this native
/// overlay stays hidden.
///
/// The window owner (AppDelegate) flips the app's activation policy to `.regular`
/// while the window is open (Dock icon) and back to `.accessory` on close.
final class DashboardWindowController: NSObject, WKNavigationDelegate, NSWindowDelegate {
    private let controller: ServerController
    private var window: NSWindow?
    private var webView: WKWebView?
    private var overlay: ReconnectOverlay?
    private var retryTimer: Timer?

    /// Latest known server state, pushed by AppDelegate. Drives the overlay copy
    /// (starting vs offline) and an immediate reload when the server comes back.
    private var serverState: ServerState = .unknown

    /// Called when the window closes so the owner can drop the Dock icon.
    var onWindowClose: (() -> Void)?

    init(controller: ServerController) {
        self.controller = controller
        super.init()
    }

    // MARK: - show / build

    /// Create the window on first use, then bring it to front and (re)load.
    func show() {
        if window == nil { buildWindow() }
        guard let window = window, let webView = webView else { return }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        // Avoid a white flash when the server is already up: only pre-show the
        // overlay when we know the load will fail. A successful load hides it on
        // didFinish; a failed one (re)shows it from didFail.
        if serverState == .running {
            overlay?.hide()
        } else {
            overlay?.show(for: serverState)
        }
        webView.load(URLRequest(url: controller.dashboardURL))
    }

    private func buildWindow() {
        let win = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1100, height: 720),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        win.title = "Flow State"
        win.minSize = NSSize(width: 900, height: 600)
        win.delegate = self
        win.setFrameAutosaveName("FlowStateDashboardWindow")
        win.isReleasedWhenClosed = false   // we reuse the same window across opens
        win.center()

        let container = NSView(frame: win.contentLayoutRect)
        container.autoresizingMask = [.width, .height]

        let config = WKWebViewConfiguration()
        let web = WKWebView(frame: container.bounds, configuration: config)
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        container.addSubview(web)

        let ov = ReconnectOverlay(frame: container.bounds)
        ov.autoresizingMask = [.width, .height]
        ov.hide()
        ov.onRetry = { [weak self] in self?.reloadNow() }
        ov.onOpenInBrowser = { [weak self] in
            guard let self = self else { return }
            NSWorkspace.shared.open(self.controller.dashboardURL)
        }
        container.addSubview(ov)

        win.contentView = container
        self.window = win
        self.webView = web
        self.overlay = ov
    }

    // MARK: - server state -> reload

    /// AppDelegate pushes server-state changes. When the server becomes ready and
    /// the overlay is up (we are waiting on it), reload at once instead of waiting
    /// for the next retry tick. Also refresh the overlay copy if it is showing.
    func serverStateChanged(_ state: ServerState) {
        let wasReady = serverState == .running
        serverState = state
        guard window != nil else { return }
        if state == .running, !wasReady, overlay?.isVisible == true {
            reloadNow()
        } else if overlay?.isVisible == true {
            overlay?.show(for: state)
        }
    }

    private func reloadNow() {
        webView?.load(URLRequest(url: controller.dashboardURL))
    }

    // MARK: - retry loop (self-contained backstop)

    private func startRetry() {
        guard retryTimer == nil else { return }
        retryTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            self?.reloadNow()
        }
    }

    private func stopRetry() {
        retryTimer?.invalidate()
        retryTimer = nil
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        stopRetry()
        overlay?.hide()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
                 withError error: Error) {
        handleLoadFailure()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleLoadFailure()
    }

    private func handleLoadFailure() {
        overlay?.show(for: serverState)
        startRetry()
    }

    // MARK: - NSWindowDelegate

    func windowWillClose(_ notification: Notification) {
        stopRetry()
        onWindowClose?()
    }
}

/// The full-window splash shown while the dashboard cannot load. Native (no server
/// dependency), reusing the Flow wave for brand consistency.
final class ReconnectOverlay: NSView {
    private let mark = NSImageView()
    private let title = NSTextField(labelWithString: "")
    private let subtitle = NSTextField(labelWithString: "")
    private let spinner = NSProgressIndicator()

    var onRetry: (() -> Void)?
    var onOpenInBrowser: (() -> Void)?

    private(set) var isVisible = false

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        // Near-black canvas, matching the dashboard's dark background.
        layer?.backgroundColor = NSColor(srgbRed: 13.0/255, green: 17.0/255, blue: 23.0/255, alpha: 1).cgColor

        mark.translatesAutoresizingMaskIntoConstraints = false

        title.translatesAutoresizingMaskIntoConstraints = false
        title.alignment = .center
        title.font = .systemFont(ofSize: 20, weight: .semibold)
        title.textColor = .white

        subtitle.translatesAutoresizingMaskIntoConstraints = false
        subtitle.alignment = .center
        subtitle.font = .systemFont(ofSize: 13)
        subtitle.textColor = NSColor(srgbRed: 141.0/255, green: 150.0/255, blue: 160.0/255, alpha: 1)
        subtitle.maximumNumberOfLines = 2

        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.isDisplayedWhenStopped = false

        let retry = NSButton(title: "Retry now", target: self, action: #selector(retryTapped))
        retry.translatesAutoresizingMaskIntoConstraints = false
        retry.bezelStyle = .rounded

        let browser = NSButton(title: "Open in Browser", target: self, action: #selector(browserTapped))
        browser.translatesAutoresizingMaskIntoConstraints = false
        browser.bezelStyle = .rounded

        let buttons = NSStackView(views: [retry, browser])
        buttons.orientation = .horizontal
        buttons.spacing = 10

        let stack = NSStackView(views: [mark, title, subtitle, spinner, buttons])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 14
        stack.setCustomSpacing(20, after: subtitle)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            mark.widthAnchor.constraint(equalToConstant: 96),
            mark.heightAnchor.constraint(equalToConstant: 77),
            subtitle.widthAnchor.constraint(lessThanOrEqualToConstant: 360),
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been used") }

    /// Show the splash with copy + dot color for the given server state.
    func show(for state: ServerState) {
        let starting = (state == .starting || state == .stopping)
        let dot: NSColor = starting ? .systemOrange : .systemRed
        mark.image = FlowIcon.largeImage(stroke: .white, dotColor: dot, size: NSSize(width: 96, height: 77))
        title.stringValue = starting ? "Starting Flow State..." : "Server offline"
        subtitle.stringValue = starting
            ? "Bringing the Flow State server up. This will load automatically."
            : "Lost the connection to the Flow State server. Reconnecting automatically the moment it is back..."
        spinner.startAnimation(nil)
        isHidden = false
        isVisible = true
    }

    func hide() {
        spinner.stopAnimation(nil)
        isHidden = true
        isVisible = false
    }

    @objc private func retryTapped() { onRetry?() }
    @objc private func browserTapped() { onOpenInBrowser?() }
}
