import AppKit

// Status-bar-only app: no Dock icon, no main window (LSUIElement in Info.plist).
let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let delegate = AppDelegate()
app.delegate = delegate
app.run()
