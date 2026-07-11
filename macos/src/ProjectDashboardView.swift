import SwiftUI

// Native mirror of the web ProjectView dashboard mode (src/components/
// ProjectView.tsx): a scrollable screen for the selected project with a header
// (name + status pill + done/total + description), a milestone-cards grid, and a
// status board with milestone filter chips. Lives to the right of the Projects
// column in the Explorer, switched by the Dashboard | Columns toggle.

// MARK: - Segmented Dashboard | Columns toggle (web ViewToggle)

struct ProjectViewToggle: View {
    @Environment(\.i18n) private var i18n
    @Binding var mode: AppStore.ProjectViewMode

    var body: some View {
        HStack(spacing: 2) {
            segment(.dashboard, i18n.t("project.viewDashboard"))
            segment(.columns, i18n.t("project.viewColumns"))
        }
        .padding(2)
        .background(DS.canvasSubtle)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(DS.border, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    // Web: active = bg-canvas text-fg shadow-resting, inactive = text-fg-muted.
    private func segment(_ value: AppStore.ProjectViewMode, _ label: String) -> some View {
        let on = mode == value
        return Button { mode = value } label: {
            Text(label)
                .font(.system(size: 12, weight: .medium))
                .padding(.horizontal, 10).padding(.vertical, 4)
                .background(on ? DS.canvas : Color.clear)
                .foregroundStyle(on ? DS.fg : DS.fgMuted)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .shadow(color: .black.opacity(on ? 0.05 : 0), radius: 1, y: 0.5)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Project dashboard

struct ProjectDashboardView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.i18n) private var i18n
    let project: ProjectRollup

    /// Board filter: "all" or a milestone id (web: useState filter).
    @State private var filter = "all"

    private var tasks: [TaskListItem] { store.projectTasks }
    private var visibleTasks: [TaskListItem] {
        filter == "all" ? tasks : tasks.filter { $0.base.milestoneId == filter }
    }
    /// Status columns in DS order; 'closed' only when such tasks are on the board.
    private var boardStatuses: [TaskStatus] {
        DS.statusOrder.filter { status in
            status == .closed ? visibleTasks.contains { $0.base.status == .closed } : true
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header
                milestonesSection
                boardSection
            }
            .padding(24)
            .frame(maxWidth: 1152, alignment: .leading)  // web max-w-6xl
            .frame(maxWidth: .infinity)                  // web mx-auto
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DS.canvas)
    }

    // MARK: Header (name + status pill + done/total - percent% + description)

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 12) {
                Text(project.base.name)
                    .font(.system(size: 20, weight: .semibold)).foregroundStyle(DS.fg)
                    .lineLimit(1)
                let pill = DS.projectStatusPill(project.base.status)
                MetaPill(labelKey: DS.projectStatusLabelKey(project.base.status), bg: pill.bg, fg: pill.fg)
                Text("\(project.progress.done)/\(project.progress.total) \(i18n.t("project.tasks").lowercased()) - \(project.progress.percent)%")
                    .font(.system(size: 12, design: .monospaced)).foregroundStyle(DS.fgSubtle)
            }
            if !project.base.description.isEmpty {
                Text(project.base.description)
                    .font(.system(size: 13)).foregroundStyle(DS.fgMuted)
                    .frame(maxWidth: 672, alignment: .leading)  // web max-w-2xl
            }
        }
    }

    // MARK: Milestone cards (web: grid sm:grid-cols-2 lg:grid-cols-3)

    private var milestonesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Eyebrow(text: i18n.t("project.milestones"))
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 260), spacing: 12)],
                alignment: .leading, spacing: 12
            ) {
                ForEach(store.milestones) { milestoneCard($0) }
            }
        }
    }

    private func milestoneCard(_ m: MilestoneRollup) -> some View {
        Card(padding: 16) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 8) {
                    HStack(spacing: 8) {
                        Image(systemName: Glyph.symbol("milestone"))
                            .font(.system(size: 13)).foregroundStyle(DS.fgMuted)
                        Text(m.base.title)
                            .font(.system(size: 13, weight: .medium)).foregroundStyle(DS.fg)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    HStack(spacing: 6) {
                        if let outcome = m.base.outcome {
                            let pill = DS.outcomePill(outcome)
                            MetaPill(labelKey: DS.outcomeLabelKey(outcome), bg: pill.bg, fg: pill.fg)
                        }
                        Text("\(m.progress.done)/\(m.progress.total)")
                            .font(.system(size: 11, design: .monospaced)).foregroundStyle(DS.fgSubtle)
                    }
                }
                ProgressMeter(progress: m.progress, counts: m.statusCounts)
                // "show tasks" scrolls attention to the board scoped to this milestone.
                Button { filter = m.id } label: {
                    Text(i18n.t("project.showTasks"))
                        .font(.system(size: 11)).foregroundStyle(DS.fgSubtle)
                }
                .buttonStyle(.plain)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: Task board (filter chips + status columns)

    private var boardSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            filterChips
            HStack(alignment: .top, spacing: 12) {
                ForEach(boardStatuses, id: \.self) { boardColumn($0) }
            }
        }
    }

    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                chip("all", "\(i18n.t("project.all")) (\(tasks.count))")
                ForEach(store.milestones) { m in
                    // Count = tasks actually rendered on the board for this
                    // milestone (all statuses, incl. closed), consistent with All.
                    chip(m.id, "\(m.base.title) (\(tasks.filter { $0.base.milestoneId == m.id }.count))")
                }
            }
        }
    }

    // Web FilterChip: rounded-full; active = bg-accent-muted text-accent.
    private func chip(_ id: String, _ label: String) -> some View {
        let on = filter == id
        return Button { filter = id } label: {
            Text(label)
                .font(.system(size: 12))
                .padding(.horizontal, 10).padding(.vertical, 4)
                .background(on ? DS.accentMuted : Color.clear)
                .foregroundStyle(on ? DS.accent : DS.fgMuted)
                .clipShape(Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private func boardColumn(_ status: TaskStatus) -> some View {
        let items = visibleTasks.filter { $0.base.status == status }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Dot(color: DS.statusDot(status), size: 8)
                Text(i18n.t(DS.statusLabelKey(status)))
                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(DS.fg)
                Text("\(items.count)")
                    .font(.system(size: 11, design: .monospaced)).foregroundStyle(DS.fgSubtle)
            }
            .padding(.horizontal, 4)
            VStack(spacing: 8) {
                if items.isEmpty {
                    Text("-")
                        .font(.system(size: 11)).foregroundStyle(DS.fgSubtle)
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                } else {
                    ForEach(items) { boardCard($0) }
                }
            }
            .frame(maxWidth: .infinity)
            .frame(minHeight: 60, alignment: .top)
            .padding(8)
            .background(DS.canvasInset.opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    // Web board TaskCard: 2-line title, milestone name when filter=All, priority.
    private func boardCard(_ item: TaskListItem) -> some View {
        TaskCardShell(active: store.selectedTaskId == item.id, action: {
            _Concurrency.Task { await store.selectTask(item.id) }
        }) {
            Text(item.base.title)
                .font(.system(size: 13)).foregroundStyle(DS.fg)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 8) {
                if filter == "all",
                   let ms = store.milestones.first(where: { $0.id == item.base.milestoneId }) {
                    Text(ms.base.title)
                        .font(.system(size: 10, design: .monospaced)).foregroundStyle(DS.fgSubtle)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                PriorityBadge(priority: item.base.priority)
            }
        }
    }
}
