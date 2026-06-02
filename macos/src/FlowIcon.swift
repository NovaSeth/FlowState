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
            let h = rect.height

            // --- the flowing wave ---------------------------------------
            let wave = NSBezierPath()
            wave.lineWidth = 1.7
            wave.lineCapStyle = .round
            wave.lineJoinStyle = .round

            let midY = h * 0.52
            let amp = h * 0.26
            let left = rect.minX + 1.5
            let right = rect.maxX - 1.5
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

            NSColor.labelColor.setStroke()
            wave.stroke()

            // --- status dot (bottom-right) ------------------------------
            let r: CGFloat = 3.0
            let dotRect = NSRect(x: rect.maxX - r * 2, y: rect.minY, width: r * 2, height: r * 2)
            dotColor.setFill()
            NSBezierPath(ovalIn: dotRect).fill()

            return true
        }
        image.isTemplate = false
        image.accessibilityDescription = "Flow State - \(state.label)"
        return image
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
