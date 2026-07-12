import SwiftUI
import AppKit

// Native side of the shared design system. Parses design/tokens.json (the single
// source of truth shared with the web; copied into the app bundle by build.sh,
// the same pattern the i18n JSON uses) and exposes dynamic SwiftUI colors that
// follow the system light/dark appearance, plus the status/priority semantics
// mirrored from src/lib/labels.ts. There are no hardcoded hex values here: the
// palette lives in tokens.json so web and native never drift.
// `@unchecked Sendable`: every stored property is a `let` parsed once at init from
// the bundled tokens.json and never mutated; the `[String: Any]` holds only
// immutable JSON values. Safe to expose as the global `DS` / `shared` singleton.
struct DesignTokens: @unchecked Sendable {
    static let shared = DesignTokens()

    private let raw: [String: Any]
    private let light: [String: NSColor]
    private let dark: [String: NSColor]

    init(bundle: Bundle = .main) {
        let obj = DesignTokens.loadJSON(bundle: bundle)
        raw = obj
        let color = obj["color"] as? [String: Any] ?? [:]
        light = DesignTokens.parsePalette(color["light"] as? [String: String] ?? [:])
        dark = DesignTokens.parsePalette(color["dark"] as? [String: String] ?? [:])
    }

    // MARK: - Color by token name (dynamic light/dark)

    /// The dynamic NSColor for a token (used for AppKit surfaces like the window
    /// background, so the transparent title bar blends with the SwiftUI canvas).
    func nsColor(_ token: String) -> NSColor {
        let l = light[token] ?? .clear
        let d = dark[token] ?? l
        return NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? d : l
        }
    }

    /// A dynamic color that resolves per the view's effective appearance. Unknown
    /// tokens resolve to clear so a typo is visible (missing) rather than crashing.
    func color(_ token: String) -> Color {
        let l = light[token] ?? .clear
        let d = dark[token] ?? l
        return Color(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? d : l
        })
    }

    // Common primitives (named to match the CSS variables / Tailwind colors).
    var canvas: Color { color("canvas") }
    var canvasSubtle: Color { color("canvas-subtle") }
    var canvasInset: Color { color("canvas-inset") }
    var fg: Color { color("fg") }
    var fgMuted: Color { color("fg-muted") }
    var fgSubtle: Color { color("fg-subtle") }
    var border: Color { color("border") }
    var borderMuted: Color { color("border-muted") }
    var accent: Color { color("accent") }
    var accentMuted: Color { color("accent-muted") }
    var accentDim: Color { color("accent-dim") }
    var success: Color { color("success") }
    var successMuted: Color { color("success-muted") }
    var attention: Color { color("attention") }
    var attentionMuted: Color { color("attention-muted") }
    var danger: Color { color("danger") }
    var dangerMuted: Color { color("danger-muted") }
    var done: Color { color("done") }
    var doneMuted: Color { color("done-muted") }
    var neutralMuted: Color { color("neutral-muted") }
    var brand: Color { color("brand") }

    // MARK: - Status semantics

    var statusOrder: [TaskStatus] {
        (raw["statusOrder"] as? [String] ?? ["todo", "in_progress", "blocked", "done", "closed"])
            .compactMap { TaskStatus(rawValue: $0) }
    }

    func statusDot(_ s: TaskStatus) -> Color { color(statusMeta(s)["dot"] ?? "fg-subtle") }
    func statusBar(_ s: TaskStatus) -> Color { color(statusMeta(s)["bar"] ?? "fg-subtle") }
    func statusPillBackground(_ s: TaskStatus) -> Color { color(statusMeta(s)["pillBg"] ?? "neutral-muted") }
    func statusPillForeground(_ s: TaskStatus) -> Color { color(statusMeta(s)["pillFg"] ?? "fg-muted") }
    func statusLabelKey(_ s: TaskStatus) -> String { statusMeta(s)["labelKey"] ?? "status.\(s.rawValue)" }

    // MARK: - Priority semantics

    func priorityColor(_ p: TaskPriority) -> Color { color(priorityMeta(p)["fg"] ?? "fg-subtle") }
    func priorityLabelKey(_ p: TaskPriority) -> String { priorityMeta(p)["labelKey"] ?? "priority.\(p.rawValue)" }

    // MARK: - Lifecycle (project/milestone share), solution, outcome pills

    func projectStatusPill(_ s: ProjectStatus) -> (bg: Color, fg: Color) { pill(lifecycleMeta(s.rawValue), "neutral-muted", "fg-muted") }
    func projectStatusLabelKey(_ s: ProjectStatus) -> String { lifecycleMeta(s.rawValue)["labelKey"] ?? "projectStatus.\(s.rawValue)" }

    func solutionStatusPill(_ s: SolutionStatus) -> (bg: Color, fg: Color) { pill(metaDict("solutionStatus", s.rawValue), "neutral-muted", "fg-muted") }
    func solutionStatusLabelKey(_ s: SolutionStatus) -> String { metaDict("solutionStatus", s.rawValue)["labelKey"] ?? "solutionStatus.\(s.rawValue)" }

    func outcomePill(_ o: MilestoneOutcome) -> (bg: Color, fg: Color) { pill(metaDict("milestoneOutcome", o.rawValue), "neutral-muted", "fg-muted") }
    func outcomeLabelKey(_ o: MilestoneOutcome) -> String { metaDict("milestoneOutcome", o.rawValue)["labelKey"] ?? "milestoneOutcome.\(o.rawValue)" }

    func blockerTypeLabelKey(_ b: BlockerType) -> String {
        (raw["blockerType"] as? [String: String])?[b.rawValue] ?? "blockerType.\(b.rawValue)"
    }

    // MARK: - Internals

    private func statusMeta(_ s: TaskStatus) -> [String: String] { metaDict("status", s.rawValue) }
    private func priorityMeta(_ p: TaskPriority) -> [String: String] { metaDict("priority", p.rawValue) }
    private func lifecycleMeta(_ key: String) -> [String: String] { metaDict("lifecycleStatus", key) }

    private func metaDict(_ group: String, _ key: String) -> [String: String] {
        ((raw[group] as? [String: Any])?[key] as? [String: String]) ?? [:]
    }

    private func pill(_ meta: [String: String], _ bgFallback: String, _ fgFallback: String) -> (bg: Color, fg: Color) {
        (color(meta["pillBg"] ?? bgFallback), color(meta["pillFg"] ?? fgFallback))
    }

    private static func loadJSON(bundle: Bundle) -> [String: Any] {
        let url = bundle.url(forResource: "tokens", withExtension: "json")
            ?? bundle.url(forResource: "tokens", withExtension: "json", subdirectory: "design")
        guard let url, let data = try? Data(contentsOf: url),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { return [:] }
        return obj
    }

    private static func parsePalette(_ map: [String: String]) -> [String: NSColor] {
        var out: [String: NSColor] = [:]
        for (key, value) in map { if let c = parseColor(value) { out[key] = c } }
        return out
    }

    /// Accepts `#rrggbb`, `#rrggbbaa`, and `rgba(r, g, b, a)` / `rgb(r, g, b)`.
    static func parseColor(_ string: String) -> NSColor? {
        let s = string.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { return hexColor(s) }
        if s.hasPrefix("rgb") { return rgbaColor(s) }
        return nil
    }

    private static func hexColor(_ hex: String) -> NSColor? {
        var s = hex
        s.removeFirst() // drop '#'
        guard s.count == 6 || s.count == 8 else { return nil }
        var value: UInt64 = 0
        guard Scanner(string: s).scanHexInt64(&value) else { return nil }
        let r, g, b, a: CGFloat
        if s.count == 8 {
            r = CGFloat((value >> 24) & 0xff) / 255
            g = CGFloat((value >> 16) & 0xff) / 255
            b = CGFloat((value >> 8) & 0xff) / 255
            a = CGFloat(value & 0xff) / 255
        } else {
            r = CGFloat((value >> 16) & 0xff) / 255
            g = CGFloat((value >> 8) & 0xff) / 255
            b = CGFloat(value & 0xff) / 255
            a = 1
        }
        return NSColor(srgbRed: r, green: g, blue: b, alpha: a)
    }

    private static func rgbaColor(_ string: String) -> NSColor? {
        guard let open = string.firstIndex(of: "("), let close = string.firstIndex(of: ")") else { return nil }
        let parts = string[string.index(after: open)..<close]
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
        guard parts.count >= 3 else { return nil }
        let r = (Double(parts[0]) ?? 0) / 255
        let g = (Double(parts[1]) ?? 0) / 255
        let b = (Double(parts[2]) ?? 0) / 255
        let a = parts.count >= 4 ? (Double(parts[3]) ?? 1) : 1
        return NSColor(srgbRed: r, green: g, blue: b, alpha: a)
    }
}

/// Short global handle used throughout the SwiftUI views (Design System).
let DS = DesignTokens.shared

extension Color {
    /// Build a SwiftUI color from a `#rrggbb` / `rgba(...)` string (e.g. a
    /// solution's stored color), reusing the shared token parser.
    init?(hex: String) {
        guard let ns = DesignTokens.parseColor(hex) else { return nil }
        self.init(nsColor: ns)
    }
}

/// Deterministic per-solution accent color: same hash + palette as the web
/// (src/lib/solution-color.ts) - keep them in lockstep. The manual color picker
/// was removed, so the hue is derived from the solution id.
private let SOLUTION_PALETTE = [
    "#3b82f6", "#22c55e", "#f59e0b", "#a855f7",
    "#ef4444", "#14b8a6", "#ec4899", "#84cc16",
]

func solutionColor(_ id: String) -> Color {
    let sum = id.unicodeScalars.reduce(0) { $0 + Int($1.value) }
    return Color(hex: SOLUTION_PALETTE[sum % SOLUTION_PALETTE.count]) ?? DS.accent
}
