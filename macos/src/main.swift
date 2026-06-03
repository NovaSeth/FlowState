import AppKit

// Status-bar-only app: no Dock icon, no main window (LSUIElement in Info.plist).
let app = NSApplication.shared
app.setActivationPolicy(.accessory)

// Build-time icon export (headless): `FlowState --export-iconset <dir>`. Handled
// before the delegate/runloop so it never starts the server or shows a Dock icon.
if let i = CommandLine.arguments.firstIndex(of: "--export-iconset"),
   i + 1 < CommandLine.arguments.count {
    IconExport.run(to: CommandLine.arguments[i + 1])
    exit(0)
}

let delegate = AppDelegate()
app.delegate = delegate
app.run()
