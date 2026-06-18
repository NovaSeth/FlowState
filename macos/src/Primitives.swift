import SwiftUI

// Shared SwiftUI primitives, translated 1:1 from the web ui.tsx / miller.tsx
// components (exact Tailwind classes -> SwiftUI), all driven by the shared design
// system (DS / tokens.json). Localized strings come from the i18n value injected
// into the environment by DashboardRootView, so these stay decoupled from AppStore.

// MARK: - Localization in the environment

private struct I18nKey: EnvironmentKey {
    static let defaultValue = Localization(locale: "en", tables: [:])
}

extension EnvironmentValues {
    var i18n: Localization {
        get { self[I18nKey.self] }
        set { self[I18nKey.self] = newValue }
    }
}

// MARK: - Icon mapping (web icon names -> SF Symbols)

enum Glyph {
    static func symbol(_ web: String) -> String {
        switch web {
        case "home": return "house"
        case "columns": return "rectangle.split.3x1"
        case "users": return "person.2"
        case "settings": return "gearshape"
        case "solution": return "globe"
        case "project": return "folder"
        case "milestone": return "checklist"
        case "comment": return "bubble.left"
        case "plus": return "plus"
        case "close": return "xmark"
        case "chevron": return "chevron.right"
        case "alert": return "exclamationmark.triangle"
        case "clock": return "clock"
        case "check": return "checkmark"
        case "trash": return "trash"
        case "block": return "nosign"
        case "overview": return "square.grid.2x2"
        default: return "circle"
        }
    }
}

// MARK: - Tiny pieces

// Web Dot: h-2 w-2 (8px) rounded-full.
struct Dot: View {
    var color: Color
    var size: CGFloat = 8
    var body: some View { Circle().fill(color).frame(width: size, height: size) }
}

// Web CountPill: rounded-full bg-neutral-muted px-1.5 py-0.5 font-mono text-[10px] text-fg-muted.
struct CountPill: View {
    var count: Int
    var body: some View {
        Text("\(count)")
            .font(.system(size: 10, design: .monospaced))
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(DS.neutralMuted)
            .foregroundStyle(DS.fgMuted)
            .clipShape(Capsule())
    }
}

// Web Eyebrow: text-[11px] font-semibold uppercase tracking-[0.5px] text-fg-subtle.
struct Eyebrow: View {
    var text: String
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .semibold))
            .tracking(0.5)
            .foregroundStyle(DS.fgSubtle)
    }
}

// MARK: - Status / priority

// Web StatusPill: inline-flex gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium + dot.
struct StatusPill: View {
    @Environment(\.i18n) private var i18n
    var status: TaskStatus
    var body: some View {
        HStack(spacing: 6) {
            Dot(color: DS.statusDot(status), size: 8)
            Text(i18n.t(DS.statusLabelKey(status)))
        }
        .font(.system(size: 12, weight: .medium))
        .padding(.horizontal, 8).padding(.vertical, 2)
        .background(DS.statusPillBackground(status))
        .foregroundStyle(DS.statusPillForeground(status))
        .clipShape(Capsule())
        .fixedSize()
    }
}

// Web PriorityBadge: font-mono text-[11px] font-medium, colored; hidden for none.
struct PriorityBadge: View {
    @Environment(\.i18n) private var i18n
    var priority: TaskPriority
    var showNone = false
    var body: some View {
        if priority == .none && !showNone {
            EmptyView()
        } else {
            Text(i18n.t(DS.priorityLabelKey(priority)))
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(DS.priorityColor(priority))
                .fixedSize()
        }
    }
}

// Web MetaPill (container statuses/outcome): rounded-full font-medium, xs scale.
struct MetaPill: View {
    @Environment(\.i18n) private var i18n
    var labelKey: String
    var bg: Color
    var fg: Color
    var body: some View {
        Text(i18n.t(labelKey))
            .font(.system(size: 10, weight: .medium))
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(bg)
            .foregroundStyle(fg)
            .clipShape(Capsule())
            .fixedSize()
    }
}

// MARK: - Progress

// Web StatusBar: h-2 (8px) rounded-full bg-neutral-muted; segments todo/in_progress/
// blocked/done (closed excluded from the denominator).
struct StatusBar: View {
    var counts: StatusCounts
    var height: CGFloat = 8

    private var segments: [(TaskStatus, Int)] {
        [(.todo, counts.todo), (.inProgress, counts.inProgress),
         (.blocked, counts.blocked), (.done, counts.done)].filter { $0.1 > 0 }
    }
    private var total: Int { max(1, segments.reduce(0) { $0 + $1.1 }) }

    var body: some View {
        GeometryReader { geo in
            HStack(spacing: 0) {
                ForEach(segments, id: \.0) { seg in
                    Rectangle()
                        .fill(DS.statusBar(seg.0))
                        .frame(width: geo.size.width * CGFloat(seg.1) / CGFloat(total))
                }
            }
        }
        .frame(height: height)
        .background(DS.neutralMuted)
        .clipShape(Capsule())
    }
}

// Web ProgressMeter: StatusBar (flex-1) + percent (w-12 right, mono xs muted).
struct ProgressMeter: View {
    var progress: Progress
    var counts: StatusCounts
    var body: some View {
        HStack(spacing: 12) {
            StatusBar(counts: counts)
            Text("\(progress.percent)%")
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(DS.fgMuted)
                .frame(width: 40, alignment: .trailing)
        }
    }
}

// Web TaskMeta: blocker (icon + count), subtask (check + done/total), labels.
struct TaskMeta: View {
    @Environment(\.i18n) private var i18n
    var labels: [String]
    var childCount: Int
    var childDoneCount: Int
    var openBlockerCount: Int

    var hasContent: Bool { openBlockerCount > 0 || childCount > 0 || !labels.isEmpty }

    var body: some View {
        if hasContent {
            HStack(spacing: 4) {
                if openBlockerCount > 0 {
                    pill(bg: DS.dangerMuted, fg: DS.danger) {
                        Image(systemName: Glyph.symbol("block")).font(.system(size: 9))
                        Text("\(openBlockerCount)").font(.system(size: 10, weight: .medium))
                    }
                }
                if childCount > 0 {
                    pill(bg: DS.neutralMuted, fg: DS.fgMuted) {
                        Image(systemName: Glyph.symbol("check")).font(.system(size: 9))
                        Text("\(childDoneCount)/\(childCount)").font(.system(size: 10, design: .monospaced))
                    }
                }
                ForEach(labels, id: \.self) { label in
                    Text(label)
                        .font(.system(size: 10))
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(DS.canvasSubtle)
                        .overlay(Capsule().stroke(DS.border, lineWidth: 1))
                        .foregroundStyle(DS.fgMuted)
                        .clipShape(Capsule())
                }
            }
        }
    }

    private func pill<C: View>(bg: Color, fg: Color, @ViewBuilder _ content: () -> C) -> some View {
        HStack(spacing: 4) { content() }
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(bg).foregroundStyle(fg).clipShape(Capsule())
    }
}

// MARK: - Containers

// Web Card: rounded-md border border-edge bg-canvas shadow-resting. Padding is the
// caller's job (matches the web, where Card takes a p-* className).
struct Card<Content: View>: View {
    var padding: CGFloat? = 12
    @ViewBuilder var content: () -> Content
    var body: some View {
        Group {
            if let padding { content().padding(padding) } else { content() }
        }
        .background(DS.canvas)
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(DS.border, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .shadow(color: .black.opacity(0.05), radius: 1, y: 0.5)
    }
}

// Web TaskCard: rounded-md border px-3 py-2.5 shadow-resting; active -> accent border.
struct TaskCardShell<Content: View>: View {
    var active: Bool
    var action: () -> Void
    @ViewBuilder var content: () -> Content
    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 8) { content() }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12).padding(.vertical, 10)
                .background(DS.canvas)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(active ? DS.accent : DS.border, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .shadow(color: .black.opacity(active ? 0.10 : 0.05), radius: active ? 3 : 1, y: active ? 2 : 0.5)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct EmptyStateView: View {
    var title: String
    var hint: String?
    var body: some View {
        VStack(spacing: 8) {
            Text(title).font(.system(size: 14, weight: .medium)).foregroundStyle(DS.fg)
            if let hint {
                Text(hint).font(.system(size: 12)).foregroundStyle(DS.fgMuted)
                    .multilineTextAlignment(.center).frame(maxWidth: 320)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
    }
}

// MARK: - Brand mark (the Flow wave + connection dot), matching BrandMark.tsx
// (20x16 viewBox, ~1.5-period sine stroke 1.7, status dot at (17,13) r3).

struct WaveMark: Shape {
    func path(in rect: CGRect) -> Path {
        // Scale a 20x16 logical field to the rect (aspect preserved by the caller).
        let sx = rect.width / 20, sy = rect.height / 16
        var p = Path()
        let steps = 64
        for i in 0...steps {
            let x = 1.5 + (17.0 * Double(i) / Double(steps))            // x in [1.5, 18.5]
            let phase = (x - 1.5) / 17.0 * Double.pi * 2 * 1.5          // 1.5 periods
            let y = 7.68 - 4.15 * sin(phase)                            // mid 7.68, amp 4.15
            let pt = CGPoint(x: CGFloat(x) * sx, y: CGFloat(y) * sy)
            if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
        }
        return p
    }
}

struct BrandMark: View {
    var dotColor: Color
    var size: CGFloat = 18
    private var width: CGFloat { size * 20 / 16 }
    private var scale: CGFloat { size / 16 }
    var body: some View {
        ZStack(alignment: .topLeading) {
            WaveMark().stroke(DS.fg, style: StrokeStyle(lineWidth: 1.7 * scale, lineCap: .round, lineJoin: .round))
            Circle()
                .fill(dotColor)
                .frame(width: 6 * scale, height: 6 * scale)
                .offset(x: 14 * scale, y: 10 * scale)   // center (17,13) - r(3)
        }
        .frame(width: width, height: size)
    }
}
