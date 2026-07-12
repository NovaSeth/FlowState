import SwiftUI

// The home / overview, translated 1:1 from the web Overview + dashboard.tsx:
// a 5-up stats row, the daily status-changes chart (title above its own card),
// attention + recent feeds side by side, and a grid of solution blocks. Centered
// in a max-w-6xl (1152) column with px-5 py-6 and space-y-6.
struct OverviewView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.i18n) private var i18n

    var body: some View {
        ScrollView {
            if let d = store.dashboard {
                VStack(alignment: .leading, spacing: 24) {
                    statsRow(d)

                    VStack(alignment: .leading, spacing: 12) {
                        Eyebrow(text: i18n.t("overview.dailyChartTitle"))
                        DailyChart(data: d.dailyByStatus)
                    }

                    HStack(alignment: .top, spacing: 16) {
                        AttentionFeed(tasks: d.attention, open: open)
                        RecentFeed(tasks: d.recent, open: open)
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        Eyebrow(text: i18n.t("overview.solutions"))
                        LazyVGrid(columns: [GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16)],
                                  alignment: .leading, spacing: 16) {
                            ForEach(d.solutions) { SolutionBlockView(solution: $0) }
                        }
                    }
                }
                .padding(.horizontal, 20).padding(.vertical, 24)
                .frame(maxWidth: 1152, alignment: .leading)
                .frame(maxWidth: .infinity)
            } else {
                ProgressView().frame(maxWidth: .infinity, minHeight: 320)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DS.canvasSubtle)
    }

    private func statsRow(_ d: DashboardPayload) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 5), spacing: 12) {
            StatTile(label: i18n.t("overview.solutions"), value: "\(d.totals.solutions)",
                     trend: trend(d.totals.solutions, d.totalsPrev?.solutions),
                     deltaPct: deltaPct(d.totals.solutions, d.totalsPrev?.solutions))
            StatTile(label: i18n.t("overview.projects"), value: "\(d.totals.projects)",
                     trend: trend(d.totals.projects, d.totalsPrev?.projects),
                     deltaPct: deltaPct(d.totals.projects, d.totalsPrev?.projects))
            StatTile(label: i18n.t("overview.milestones"), value: "\(d.totals.milestones)",
                     trend: trend(d.totals.milestones, d.totalsPrev?.milestones),
                     deltaPct: deltaPct(d.totals.milestones, d.totalsPrev?.milestones))
            StatTile(label: i18n.t("overview.tasks"), value: "\(d.totals.tasks)",
                     trend: trend(d.totals.tasks, d.totalsPrev?.tasks),
                     deltaPct: deltaPct(d.totals.tasks, d.totalsPrev?.tasks))
            StatTile(label: i18n.t("overview.completed"), value: "\(d.progress.percent)%",
                     trend: trend(d.progress.percent, d.totalsPrev?.percent),
                     deltaPct: deltaPct(d.progress.percent, d.totalsPrev?.percent))
        }
    }

    /// Day-over-day direction for a stat tile (nil prev = older server, no marker).
    private func trend(_ now: Int, _ prev: Int?) -> StatTile.Trend? {
        guard let prev else { return nil }
        return now > prev ? .up : now < prev ? .down : .flat
    }

    /// Relative day-over-day change in percent; nil when prev is 0 or missing.
    private func deltaPct(_ now: Int, _ prev: Int?) -> Double? {
        guard let prev, prev != 0 else { return nil }
        return Double(now - prev) / Double(prev) * 100
    }

    private func open(_ ctx: TaskContext, _ taskId: String) {
        _Concurrency.Task {
            store.section = .explore
            await store.selectSolution(ctx.solutionId)
            await store.selectProject(ctx.projectId)
            await store.selectMilestone(ctx.milestoneId)
            await store.selectTask(taskId)
        }
    }
}

// Web StatTile: rounded-lg border-edge bg-canvas-subtle px-4 py-3, mono 2xl value.
struct StatTile: View {
    enum Trend { case up, down, flat }

    var label: String
    var value: String
    /// Day-over-day direction vs yesterday's closing value (nil = no marker).
    var trend: Trend? = nil
    /// Relative change in percent shown next to the triangle (nil = hidden).
    var deltaPct: Double? = nil

    // One decimal below 10% so small movements do not read as "0%".
    private var marker: String {
        guard let trend, trend != .flat else { return "" }
        let symbol = trend == .up ? "▲" : "▼"
        guard let deltaPct else { return symbol }
        let a = abs(deltaPct)
        let label = a < 0.1 ? "<0.1" : a >= 10 ? "\(Int(a.rounded()))" : String(format: "%.1f", a)
        return "\(symbol) \(label)%"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(value)
                    .font(.system(size: 24, weight: .semibold, design: .monospaced))
                    .foregroundStyle(DS.fg)
                // Flat days show nothing - the marker only appears on a change.
                if let trend, trend != .flat {
                    Text(marker)
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .foregroundStyle(trend == .up ? DS.success : DS.danger)
                }
            }
            Text(label).font(.system(size: 12)).foregroundStyle(DS.fgMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(DS.canvasSubtle)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(DS.border, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: - Feeds

struct AttentionFeed: View {
    @Environment(\.i18n) private var i18n
    let tasks: [TaskWithContext]
    let open: (TaskContext, String) -> Void

    var body: some View {
        Card(padding: nil) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Image(systemName: Glyph.symbol("alert")).font(.system(size: 16)).foregroundStyle(DS.danger)
                    Text(i18n.t("overview.needsAttention")).font(.system(size: 14, weight: .semibold)).foregroundStyle(DS.fg)
                    Text("(\(tasks.count))").font(.system(size: 12, design: .monospaced)).foregroundStyle(DS.fgSubtle)
                }
                Text(i18n.t("overview.needsAttentionHint")).font(.system(size: 12)).foregroundStyle(DS.fgMuted)
                if tasks.isEmpty {
                    Text(i18n.t("overview.nothingBlocking")).font(.system(size: 13)).foregroundStyle(DS.fgSubtle)
                        .frame(maxWidth: .infinity).padding(.vertical, 24)
                } else {
                    ScrollView {
                        VStack(spacing: 0) {
                            ForEach(tasks) { OverviewTaskRow(task: $0, showTime: false, open: open) }
                        }
                    }
                }
            }
            .padding(16)
        }
        .frame(maxWidth: .infinity)
        .frame(maxHeight: 416)
    }
}

struct RecentFeed: View {
    @Environment(\.i18n) private var i18n
    let tasks: [TaskWithContext]
    let open: (TaskContext, String) -> Void

    var body: some View {
        Card(padding: nil) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Image(systemName: Glyph.symbol("clock")).font(.system(size: 16)).foregroundStyle(DS.fgSubtle)
                    Text(i18n.t("overview.recentActivity")).font(.system(size: 14, weight: .semibold)).foregroundStyle(DS.fg)
                }
                if tasks.isEmpty {
                    Text(i18n.t("overview.noActivity")).font(.system(size: 13)).foregroundStyle(DS.fgSubtle)
                        .frame(maxWidth: .infinity).padding(.vertical, 24)
                } else {
                    ScrollView {
                        VStack(spacing: 0) {
                            ForEach(tasks) { OverviewTaskRow(task: $0, showTime: true, open: open) }
                        }
                    }
                }
            }
            .padding(16)
        }
        .frame(maxWidth: .infinity)
        .frame(maxHeight: 416)
    }
}

struct OverviewTaskRow: View {
    @Environment(\.i18n) private var i18n
    let task: TaskWithContext
    let showTime: Bool
    let open: (TaskContext, String) -> Void

    var body: some View {
        Button { open(task.context, task.base.id) } label: {
            HStack(alignment: .top, spacing: 12) {
                StatusPill(status: task.base.status)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 8) {
                        Text(task.base.title).font(.system(size: 13)).foregroundStyle(DS.fg).lineLimit(1)
                        PriorityBadge(priority: task.base.priority)
                    }
                    HStack(spacing: 5) {
                        Text(task.context.solutionName)
                        chevron
                        Text(task.context.projectName)
                        chevron
                        Text(task.context.milestoneTitle)
                    }
                    .font(.system(size: 11, design: .monospaced)).foregroundStyle(DS.fgSubtle).lineLimit(1)
                    if let note = task.note, task.base.status == .blocked {
                        HStack(alignment: .top, spacing: 4) {
                            Image(systemName: Glyph.symbol("block")).font(.system(size: 9))
                            Text(note).lineLimit(2)
                        }
                        .font(.system(size: 11)).foregroundStyle(DS.danger)
                        .padding(.horizontal, 6).padding(.vertical, 4)
                        .background(DS.dangerMuted).clipShape(RoundedRectangle(cornerRadius: 4))
                        .padding(.top, 2)
                    }
                }
                Spacer(minLength: 0)
                if showTime {
                    Text(timeAgo(task.base.updatedAt, i18n))
                        .font(.system(size: 11, design: .monospaced)).foregroundStyle(DS.fgSubtle)
                }
            }
            .padding(.horizontal, 8).padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var chevron: some View {
        Image(systemName: "chevron.right").font(.system(size: 8)).foregroundStyle(DS.fgSubtle)
    }
}

// Web SolutionBlock: header (icon + name + projShort + ProgressMeter) over a
// recent-tasks list. The chevron collapses the details; the choice persists in
// UserDefaults so the next visit keeps it (web localStorage parity).
struct SolutionBlockView: View {
    @Environment(\.i18n) private var i18n
    let solution: DashboardSolution

    @State private var collapsed: Bool

    init(solution: DashboardSolution) {
        self.solution = solution
        _collapsed = State(initialValue: UserDefaults.standard.bool(forKey: "fs.overview.collapsed.\(solution.id)"))
    }

    var body: some View {
        Card(padding: nil) {
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    Button { toggle() } label: {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(DS.fgSubtle)
                            .rotationEffect(.degrees(collapsed ? 0 : 90))
                            .frame(width: 20, height: 20)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help(i18n.t(collapsed ? "common.expand" : "common.collapse"))
                    Image(systemName: Glyph.symbol("solution")).font(.system(size: 16))
                        .foregroundStyle(solutionColor(solution.id))
                    Text(solution.base.base.name).font(.system(size: 14, weight: .semibold)).foregroundStyle(DS.fg).lineLimit(1)
                    Text(i18n.t("units.projShort", ["n": "\(solution.base.projectCount)"]))
                        .font(.system(size: 11, design: .monospaced)).foregroundStyle(DS.fgSubtle)
                    Spacer(minLength: 12)
                    ProgressMeter(progress: solution.base.progress, counts: solution.base.statusCounts)
                        .frame(maxWidth: 260)
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
                .background(DS.canvasSubtle)
                .overlay(
                    Rectangle().frame(height: 1).foregroundStyle(DS.borderMuted)
                        .opacity(collapsed ? 0 : 1),
                    alignment: .bottom
                )

                if !collapsed && !solution.recentTasks.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Image(systemName: Glyph.symbol("clock")).font(.system(size: 12))
                            Text(i18n.t("overview.recent").uppercased())
                                .font(.system(size: 11, weight: .semibold)).tracking(0.5)
                        }
                        .foregroundStyle(DS.fgSubtle).padding(.horizontal, 4).padding(.bottom, 2)
                        ForEach(Array(solution.recentTasks.prefix(5))) { t in
                            HStack(spacing: 8) {
                                StatusPill(status: t.base.status)
                                Text(t.base.title).font(.system(size: 13)).foregroundStyle(DS.fg).lineLimit(1)
                                Spacer(minLength: 0)
                                Text(timeAgo(t.base.updatedAt, i18n))
                                    .font(.system(size: 10, design: .monospaced)).foregroundStyle(DS.fgSubtle)
                            }
                            .padding(.horizontal, 8).padding(.vertical, 4)
                        }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 8)
                }
            }
        }
    }

    private func toggle() {
        collapsed.toggle()
        UserDefaults.standard.set(collapsed, forKey: "fs.overview.collapsed.\(solution.id)")
    }
}

// MARK: - Daily chart (multi-line, axes + markers + legend), mirroring DailyChart.tsx

struct DailyChart: View {
    @Environment(\.i18n) private var i18n
    let data: DailyByStatus

    // Day under the cursor: vertical guide + per-status summary tooltip
    // (hovering anywhere in the plot snaps to the nearest day, like the web).
    @State private var hoverIndex: Int?

    private var yMax: Int { max(1, data.counts.flatMap { $0 }.max() ?? 1) }
    private var hasData: Bool {
        !data.days.isEmpty && !data.statuses.isEmpty && data.counts.contains { $0.contains { $0 > 0 } }
    }

    var body: some View {
        if !hasData {
            Text(i18n.t("overview.dailyChartEmpty"))
                .font(.system(size: 13)).foregroundStyle(DS.fgMuted)
                .frame(maxWidth: .infinity).padding(.vertical, 40)
                .background(DS.canvasSubtle)
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(DS.border, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 8))
        } else {
            VStack(alignment: .leading, spacing: 12) {
                plot.frame(height: 176)
                legend
            }
            .padding(16)
            .background(DS.canvas)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(DS.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .shadow(color: .black.opacity(0.05), radius: 1, y: 0.5)
        }
    }

    private var plot: some View {
        GeometryReader { geo in chartBody(geo.size) }
    }

    private func chartBody(_ size: CGSize) -> some View {
        let padL: CGFloat = 28, padR: CGFloat = 8, padT: CGFloat = 10, padB: CGFloat = 22
        let plotW = max(1, size.width - padL - padR)
        let plotH = max(1, size.height - padT - padB)
        let n = data.days.count
        let step = max(1, Int(ceil(Double(n) / 12)))
        func xFor(_ i: Int) -> CGFloat { n <= 1 ? padL + plotW / 2 : padL + plotW * CGFloat(i) / CGFloat(n - 1) }
        func yFor(_ v: Int) -> CGFloat { padT + plotH - plotH * CGFloat(v) / CGFloat(yMax) }
        return ZStack(alignment: .topLeading) {
                // Baseline.
                Path { p in
                    p.move(to: CGPoint(x: padL, y: padT + plotH))
                    p.addLine(to: CGPoint(x: padL + plotW, y: padT + plotH))
                }.stroke(DS.border, lineWidth: 1)

                // Y labels (max + 0).
                Text("\(yMax)").chartAxisLabel().position(x: padL - 10, y: padT + 4)
                Text("0").chartAxisLabel().position(x: padL - 10, y: padT + plotH)

                // X labels (thinned).
                ForEach(Array(data.days.enumerated()), id: \.offset) { i, day in
                    if i % step == 0 || i == n - 1 {
                        Text(shortDay(day)).chartAxisLabel().position(x: xFor(i), y: padT + plotH + 12)
                    }
                }

                // One line per status + point markers.
                ForEach(Array(data.statuses.enumerated()), id: \.offset) { si, status in
                    Path { p in
                        for i in data.days.indices {
                            let v = (i < data.counts.count && si < data.counts[i].count) ? data.counts[i][si] : 0
                            let pt = CGPoint(x: xFor(i), y: yFor(v))
                            if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
                        }
                    }
                    .stroke(DS.statusBar(status), style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
                    ForEach(data.days.indices, id: \.self) { i in
                        let v = (i < data.counts.count && si < data.counts[i].count) ? data.counts[i][si] : 0
                        Circle().fill(DS.statusBar(status)).frame(width: 4.4, height: 4.4)
                            .position(x: xFor(i), y: yFor(v))
                    }
                }

                // Hover: vertical guide on the nearest day + the day's summary.
                if let hi = hoverIndex, hi < n {
                    Path { p in
                        p.move(to: CGPoint(x: xFor(hi), y: padT))
                        p.addLine(to: CGPoint(x: xFor(hi), y: padT + plotH))
                    }
                    .stroke(DS.fgMuted, lineWidth: 2)

                    tooltip(hi)
                        .frame(width: 168)
                        .offset(x: hi > (n - 1) / 2 ? xFor(hi) - 178 : xFor(hi) + 10, y: padT)
                }
            }
            .contentShape(Rectangle())
            .onContinuousHover { phase in
                switch phase {
                case .active(let pt):
                    let i = n <= 1 ? 0 : Int(round((pt.x - padL) / plotW * CGFloat(n - 1)))
                    hoverIndex = min(max(0, i), n - 1)
                case .ended:
                    hoverIndex = nil
                }
            }
        }

    private var legend: some View {
        HStack(spacing: 16) {
            ForEach(Array(data.statuses.enumerated()), id: \.offset) { _, status in
                HStack(spacing: 6) {
                    RoundedRectangle(cornerRadius: 2).fill(DS.statusBar(status)).frame(width: 10, height: 10)
                    Text(i18n.t(DS.statusLabelKey(status))).font(.system(size: 12)).foregroundStyle(DS.fgMuted)
                }
            }
        }
    }

    /// Day summary card: the date + every status' transition count that day.
    private func tooltip(_ i: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(data.days[i])
                .font(.system(size: 10, design: .monospaced)).foregroundStyle(DS.fgSubtle)
            ForEach(Array(data.statuses.enumerated()), id: \.offset) { si, status in
                HStack(spacing: 6) {
                    RoundedRectangle(cornerRadius: 2).fill(DS.statusBar(status)).frame(width: 8, height: 8)
                    Text(i18n.t(DS.statusLabelKey(status))).font(.system(size: 11)).foregroundStyle(DS.fgMuted)
                    Spacer(minLength: 12)
                    Text("\((i < data.counts.count && si < data.counts[i].count) ? data.counts[i][si] : 0)")
                        .font(.system(size: 11, design: .monospaced)).foregroundStyle(DS.fg)
                }
            }
        }
        .padding(10)
        .background(DS.canvas)
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(DS.border, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .shadow(color: .black.opacity(0.10), radius: 3, y: 2)
        .allowsHitTesting(false)
    }

    private func shortDay(_ day: String) -> String { day.count >= 10 ? String(day.dropFirst(5)) : day }
}

private extension Text {
    func chartAxisLabel() -> some View {
        self.font(.system(size: 9, design: .monospaced)).foregroundStyle(DS.fgSubtle)
    }
}
