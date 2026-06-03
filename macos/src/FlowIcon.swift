import AppKit

/// The "Flow" mark: a single smooth flowing wave (a sine-like current stroke),
/// drawn programmatically so it adapts to light/dark menu bars. A small status
/// dot rides the wave to convey the server state.
enum FlowIcon {
    /// Build a fresh menu-bar image for the given server state.
    ///
    /// We use the drawing-handler form of NSImage so the wave is re-rendered in
    /// the *current* appearance every time AppKit paints it - that makes the
    /// stroke follow `labelColor` (black in light mode, white in dark) for free.
    /// The image is not a template because the status dot must keep its color.
    static func image(for state: ServerState) -> NSImage {
        let size = NSSize(width: 20, height: 16)
        let dotColor = dotColor(for: state)

        let image = NSImage(size: size, flipped: false) { rect in
            // The menu-bar mark: tuned constants for the 20x16 status item.
            drawMark(in: rect, stroke: .labelColor, dotColor: dotColor,
                     lineWidth: 1.7, dotRadius: 3.0, inset: 1.5)
            return true
        }
        image.isTemplate = false
        image.accessibilityDescription = "Flow State - \(state.label)"
        return image
    }

    /// A large standalone mark (wave + colored dot) for the dashboard window's
    /// reconnect overlay. `stroke` is the wave color (white on the dark splash);
    /// `dotColor` conveys the splash state (amber = starting, red = offline). The
    /// stroke/dot sizes scale with `size` so it stays proportional to the icon.
    static func largeImage(stroke: NSColor, dotColor: NSColor, size: NSSize) -> NSImage {
        let image = NSImage(size: size, flipped: false) { rect in
            let h = rect.height
            drawMark(in: rect, stroke: stroke, dotColor: dotColor,
                     lineWidth: max(2, h * 0.075), dotRadius: h * 0.13, inset: h * 0.12)
            return true
        }
        image.isTemplate = false
        return image
    }

    /// Shared wave+dot drawing. `inset` is the horizontal margin; the dot rides
    /// the bottom-right. Used by both the menu-bar icon and the overlay mark.
    private static func drawMark(in rect: NSRect, stroke: NSColor, dotColor: NSColor,
                                 lineWidth: CGFloat, dotRadius: CGFloat, inset: CGFloat) {
        let h = rect.height

        // --- the flowing wave ---------------------------------------
        let wave = NSBezierPath()
        wave.lineWidth = lineWidth
        wave.lineCapStyle = .round
        wave.lineJoinStyle = .round

        let midY = rect.minY + h * 0.52
        let amp = h * 0.26
        let left = rect.minX + inset
        let right = rect.maxX - inset
        let span = right - left

        wave.move(to: NSPoint(x: left, y: midY))
        let steps = 48
        for i in 1...steps {
            let t = CGFloat(i) / CGFloat(steps)
            let x = left + span * t
            // 1.5 periods of a sine wave = a calm, readable "current".
            let y = midY + sin(t * .pi * 3.0) * amp
            wave.line(to: NSPoint(x: x, y: y))
        }

        stroke.setStroke()
        wave.stroke()

        // --- status dot (bottom-right) ------------------------------
        let dotRect = NSRect(x: rect.maxX - dotRadius * 2, y: rect.minY,
                             width: dotRadius * 2, height: dotRadius * 2)
        dotColor.setFill()
        NSBezierPath(ovalIn: dotRect).fill()
    }

    /// The status-dot color for a state (reused by the menu header dot).
    static func dotColor(for state: ServerState) -> NSColor {
        switch state {
        case .running:            return .systemGreen
        case .stopped:            return .systemGray
        case .starting, .stopping: return .systemOrange
        case .unknown:            return NSColor.systemGray.withAlphaComponent(0.5)
        }
    }
}
