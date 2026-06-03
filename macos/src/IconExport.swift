import AppKit

/// Build-time app-icon generator. Renders the Flow wave mark onto a rounded
/// (squircle-ish) dark tile at every iconset size and writes the PNGs into a
/// `.iconset` directory; build.sh then runs `iconutil` to make `AppIcon.icns`.
///
/// Reuses `FlowIcon` so the Dock icon, the menu-bar glyph and the web wordmark all
/// share one wave. Invoked headless via `FlowState --export-iconset <dir>` before
/// the app's normal startup (no server, no Documents access, no Dock).
enum IconExport {
    /// (filename, pixel size) pairs required for a macOS .iconset.
    private static let variants: [(String, Int)] = [
        ("icon_16x16.png", 16),
        ("icon_16x16@2x.png", 32),
        ("icon_32x32.png", 32),
        ("icon_32x32@2x.png", 64),
        ("icon_128x128.png", 128),
        ("icon_128x128@2x.png", 256),
        ("icon_256x256.png", 256),
        ("icon_256x256@2x.png", 512),
        ("icon_512x512.png", 512),
        ("icon_512x512@2x.png", 1024),
    ]

    static func run(to dir: String) {
        let fm = FileManager.default
        try? fm.createDirectory(atPath: dir, withIntermediateDirectories: true)
        for (name, px) in variants {
            guard let png = pngData(forIcon: appIcon(px), pixels: px) else { continue }
            try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent(name))
        }
    }

    /// One square app icon at `px` x `px`.
    private static func appIcon(_ px: Int) -> NSImage {
        let size = NSSize(width: px, height: px)
        return NSImage(size: size, flipped: false) { rect in
            let s = rect.width

            // Tile: macOS app icons leave a margin and use a large corner radius.
            let inset = s * 0.085
            let tile = rect.insetBy(dx: inset, dy: inset)
            let radius = tile.width * 0.2237
            let path = NSBezierPath(roundedRect: tile, xRadius: radius, yRadius: radius)

            // Brand blue gradient (Primer #0969da, the Flow State accent). Makes the
            // Dock/Launchpad app icon read completely differently from the thin
            // monochrome wave in the menu bar, so the two surfaces are easy to tell
            // apart at a glance.
            let top = NSColor(srgbRed: 47.0/255, green: 129.0/255, blue: 247.0/255, alpha: 1)   // #2f81f7
            let bottom = NSColor(srgbRed: 9.0/255, green: 105.0/255, blue: 218.0/255, alpha: 1)  // #0969da
            path.addClip()
            NSGradient(starting: top, ending: bottom)?.draw(in: tile, angle: -90)
            // Hairline edge for definition on light wallpapers.
            NSColor(srgbRed: 1, green: 1, blue: 1, alpha: 0.12).setStroke()
            path.lineWidth = max(1, s * 0.004)
            path.stroke()

            // The wave, centered in the tile (white stroke + green "running" dot).
            let markW = tile.width * 0.60
            let markH = markW * 77.0 / 96.0   // keep the FlowIcon aspect
            let markRect = NSRect(
                x: tile.midX - markW / 2,
                y: tile.midY - markH / 2,
                width: markW, height: markH
            )
            let mark = FlowIcon.largeImage(
                stroke: .white,
                dotColor: .systemGreen,
                size: NSSize(width: markW, height: markH)
            )
            mark.draw(in: markRect)
            return true
        }
    }

    /// Rasterize an NSImage to PNG at an exact pixel size (no @2x doubling).
    private static func pngData(forIcon image: NSImage, pixels px: Int) -> Data? {
        guard let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
        ) else { return nil }
        rep.size = NSSize(width: px, height: px)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        image.draw(in: NSRect(x: 0, y: 0, width: px, height: px))
        NSGraphicsContext.restoreGraphicsState()
        return rep.representation(using: .png, properties: [:])
    }
}
