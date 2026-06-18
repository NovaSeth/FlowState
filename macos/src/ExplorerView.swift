import SwiftUI

// The cascading Miller-column explorer, translated 1:1 from the web Explorer:
// Solutions -> Projects -> Milestones columns, a task pane (ViewTabs + list/kanban
// + show-closed), and a task detail inspector on the trailing edge. Columns are
// collapsible to a narrow strip (persisted in UserDefaults) - the native mirror of
// the web fs.miller.collapsed behavior.
struct ExplorerView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.i18n) private var i18n

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            solutionsColumn
            if store.selectedSolutionId != nil { projectsColumn }
            if store.selectedProjectId != nil { milestonesColumn }
            if store.selectedMilestoneId != nil {
                TaskPaneView().frame(minWidth: 360, maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ColumnPlaceholder(text: placeholderText)
            }
            if store.selectedTaskId != nil {
                TaskDetailPanel()
                    .frame(width: 380)
                    .overlay(Rectangle().frame(width: 1).foregroundStyle(DS.border), alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DS.canvas)
    }

    // MARK: - Columns

    private var solutionsColumn: some View {
        MillerColumn(title: i18n.t("explorer.solutions"), count: store.solutions.count, collapseId: "solutions") {
            if store.solutions.isEmpty {
                ColumnHint(text: i18n.t("explorer.noSolutions"))
            } else {
                ForEach(store.solutions) { sol in
                    DrillRow(
                        title: sol.base.name, counts: sol.statusCounts, percent: sol.progress.percent,
                        sub: i18n.t("units.projShort", ["n": "\(sol.projectCount)"]),
                        pillKey: sol.base.status == .archived ? DS.solutionStatusLabelKey(.archived) : nil,
                        pill: DS.solutionStatusPill(.archived),
                        blocked: 0, active: store.selectedSolutionId == sol.id
                    ) { _Concurrency.Task { await store.selectSolution(sol.id) } }
                }
            }
        }
    }

    private var projectsColumn: some View {
        MillerColumn(title: i18n.t("explorer.projects"), count: store.projects.count, collapseId: "projects") {
            if store.projects.isEmpty {
                ColumnHint(text: i18n.t("explorer.noProjects"))
            } else {
                ForEach(store.projects) { proj in
                    DrillRow(
                        title: proj.base.name, counts: proj.statusCounts, percent: proj.progress.percent,
                        sub: i18n.t("units.milestoneShort", ["n": "\(proj.milestoneCount)"]),
                        pillKey: DS.projectStatusLabelKey(proj.base.status),
                        pill: DS.projectStatusPill(proj.base.status),
                        blocked: 0, active: store.selectedProjectId == proj.id
                    ) { _Concurrency.Task { await store.selectProject(proj.id) } }
                }
            }
        }
    }

    private var milestonesColumn: some View {
        MillerColumn(title: i18n.t("explorer.milestones"), count: store.milestones.count, collapseId: "milestones") {
            if store.milestones.isEmpty {
                ColumnHint(text: i18n.t("explorer.noMilestones"))
            } else {
                ForEach(store.milestones) { ms in
                    DrillRow(
                        title: ms.base.title, counts: ms.statusCounts, percent: ms.progress.percent,
                        sub: i18n.t("units.taskShort", ["n": "\(ms.progress.total)"]),
                        pillKey: DS.projectStatusLabelKey(ms.base.status),
                        pill: DS.projectStatusPill(ms.base.status),
                        blocked: ms.statusCounts.blocked, active: store.selectedMilestoneId == ms.id
                    ) { _Concurrency.Task { await store.selectMilestone(ms.id) } }
                }
            }
        }
    }

    private var placeholderText: String {
        if store.selectedSolutionId == nil { return i18n.t("explorer.pickSolution") }
        if store.selectedProjectId == nil { return i18n.t("explorer.pickProject") }
        return i18n.t("explorer.pickMilestone")
    }
}

// MARK: - Miller column (collapsible)

struct MillerColumn<Content: View>: View {
    @Environment(\.i18n) private var i18n
    let title: String
    let count: Int
    let collapseId: String?
    private let content: Content
    @State private var collapsed: Bool

    init(title: String, count: Int, collapseId: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.count = count
        self.collapseId = collapseId
        self.content = content()
        let initial = collapseId.map { UserDefaults.standard.bool(forKey: "fs.miller.collapsed.\($0)") } ?? false
        _collapsed = State(initialValue: initial)
    }

    var body: some View {
        Group {
            if collapseId != nil && collapsed {
                collapsedStrip
            } else {
                VStack(spacing: 0) {
                    header
                    ScrollView { LazyVStack(spacing: 0) { content } }
                }
                .frame(width: 288)
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .background(DS.canvas)
        .overlay(Rectangle().frame(width: 1).foregroundStyle(DS.border), alignment: .trailing)
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text(title.uppercased()).font(.system(size: 11, weight: .semibold)).tracking(0.5).foregroundStyle(DS.fgSubtle)
            CountPill(count: count)
            Spacer()
            Button { toggle() } label: {
                Image(systemName: "chevron.left").font(.system(size: 12)).foregroundStyle(DS.fgSubtle)
            }
            .buttonStyle(.plain)
            .help(i18n.t("common.collapse"))
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .overlay(Rectangle().frame(height: 1).foregroundStyle(DS.borderMuted), alignment: .bottom)
    }

    private var collapsedStrip: some View {
        Button { toggle() } label: {
            VStack(spacing: 8) {
                Image(systemName: "chevron.right").font(.system(size: 12))
                Text(String(title.prefix(1)).uppercased()).font(.system(size: 11, weight: .semibold)).tracking(0.5)
                CountPill(count: count)
                Spacer()
            }
            .padding(.vertical, 10)
            .frame(width: 36, alignment: .top)
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(DS.fgSubtle)
        .help(i18n.t("common.expand"))
    }

    private func toggle() {
        collapsed.toggle()
        if let id = collapseId { UserDefaults.standard.set(collapsed, forKey: "fs.miller.collapsed.\(id)") }
    }
}

// MARK: - Drill row (web: title row -> StatusBar -> [sub | percent], active accent-muted)

struct DrillRow: View {
    @Environment(\.i18n) private var i18n
    let title: String
    let counts: StatusCounts
    let percent: Int
    let sub: String
    let pillKey: String?
    let pill: (bg: Color, fg: Color)
    let blocked: Int
    let active: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.system(size: 13)).foregroundStyle(DS.fg).lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.trailing, 20)
                StatusBar(counts: counts)
                HStack(spacing: 6) {
                    Text(sub).font(.system(size: 11)).foregroundStyle(DS.fgSubtle)
                    if blocked > 0 { blockedBadge }
                    if let pillKey { MetaPill(labelKey: pillKey, bg: pill.bg, fg: pill.fg) }
                    Spacer(minLength: 4)
                    Text("\(percent)%").font(.system(size: 11, design: .monospaced)).foregroundStyle(DS.fgMuted)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(active ? DS.accentMuted : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var blockedBadge: some View {
        HStack(spacing: 2) {
            Image(systemName: Glyph.symbol("block")).font(.system(size: 9))
            Text(i18n.t("explorer.blockedCount", ["n": "\(blocked)"]))
        }
        .font(.system(size: 10, weight: .medium))
        .padding(.horizontal, 6).padding(.vertical, 2)
        .background(DS.dangerMuted).foregroundStyle(DS.danger).clipShape(Capsule())
    }
}

// MARK: - Task pane (ViewTabs + list / kanban)

struct TaskPaneView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.i18n) private var i18n

    private var visible: [TaskListItem] {
        store.tasks.filter { store.showClosed || $0.base.status != .closed }
    }
    private var closedCount: Int { store.tasks.filter { $0.base.status == .closed }.count }

    var body: some View {
        VStack(spacing: 0) {
            viewTabs
            if store.tasks.isEmpty {
                ColumnHint(text: i18n.t("explorer.noTasks"))
                Spacer()
            } else if store.taskViewMode == .list {
                listView
            } else {
                kanbanView
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DS.canvas)
    }

    private var viewTabs: some View {
        HStack(spacing: 16) {
            HStack(spacing: 8) {
                Text(i18n.t("explorer.tasks").uppercased())
                    .font(.system(size: 11, weight: .semibold)).tracking(0.5).foregroundStyle(DS.fgSubtle)
                CountPill(count: visible.count)
            }
            tabButton(.list, i18n.t("explorer.list"))
            tabButton(.kanban, i18n.t("explorer.kanban"))
            Spacer()
            if closedCount > 0 {
                Button { store.showClosed.toggle() } label: {
                    Text("\(i18n.t("explorer.closed")) \(closedCount)")
                        .font(.system(size: 10, weight: .medium))
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(store.showClosed ? DS.neutralMuted : Color.clear)
                        .foregroundStyle(store.showClosed ? DS.fg : DS.fgSubtle)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
                .help(i18n.t("explorer.toggleClosed"))
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 40)
        .overlay(Rectangle().frame(height: 1).foregroundStyle(DS.borderMuted), alignment: .bottom)
    }

    private func tabButton(_ mode: AppStore.TaskViewMode, _ label: String) -> some View {
        let on = store.taskViewMode == mode
        return Button { store.taskViewMode = mode } label: {
            Text(label.uppercased())
                .font(.system(size: 11, weight: .semibold)).tracking(0.5)
                .foregroundStyle(on ? DS.fg : DS.fgSubtle)
                .padding(.vertical, 10)
                .overlay(Rectangle().frame(height: 2).foregroundStyle(on ? DS.accent : .clear), alignment: .bottom)
        }
        .buttonStyle(.plain)
    }

    private var listView: some View {
        ScrollView {
            LazyVStack(spacing: 6) {
                ForEach(sortedList) { item in
                    TaskRowView(item: item, active: store.selectedTaskId == item.id) {
                        _Concurrency.Task { await store.selectTask(item.id) }
                    }
                }
            }
            .padding(12)
        }
    }

    private var kanbanView: some View {
        ScrollView(.horizontal) {
            HStack(alignment: .top, spacing: 12) {
                ForEach(kanbanColumns, id: \.self) { status in
                    kanbanColumn(status)
                }
            }
            .padding(12)
        }
    }

    private var sortedList: [TaskListItem] {
        visible.sorted {
            $0.base.status.listRank != $1.base.status.listRank
                ? $0.base.status.listRank < $1.base.status.listRank
                : $0.base.priority.rank < $1.base.priority.rank
        }
    }

    private var kanbanColumns: [TaskStatus] {
        DS.statusOrder.filter { s in
            s == .closed ? store.tasks.contains { $0.base.status == .closed } : true
        }
    }

    private func sortedKanban(_ status: TaskStatus) -> [TaskListItem] {
        visible.filter { $0.base.status == status }
            .sorted {
                $0.base.updatedAt != $1.base.updatedAt
                    ? $0.base.updatedAt > $1.base.updatedAt
                    : $0.base.priority.rank < $1.base.priority.rank
            }
    }

    private func kanbanColumn(_ status: TaskStatus) -> some View {
        let items = sortedKanban(status)
        return VStack(spacing: 0) {
            HStack(spacing: 8) {
                Dot(color: DS.statusDot(status), size: 8)
                Text(i18n.t(DS.statusLabelKey(status))).font(.system(size: 12, weight: .semibold)).foregroundStyle(DS.fg)
                Spacer()
                CountPill(count: items.count)
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .overlay(Rectangle().frame(height: 1).foregroundStyle(DS.borderMuted), alignment: .bottom)
            if items.isEmpty {
                Text(i18n.t("explorer.emptyKanbanColumn"))
                    .font(.system(size: 11)).foregroundStyle(DS.fgSubtle)
                    .frame(maxWidth: .infinity).padding(.vertical, 24)
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(items) { item in
                            TaskCardView(item: item, active: store.selectedTaskId == item.id) {
                                _Concurrency.Task { await store.selectTask(item.id) }
                            }
                        }
                    }
                    .padding(8)
                }
            }
        }
        .frame(width: 248)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(DS.canvas)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(DS.borderMuted, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: - Task cards (list row + kanban card), web: rounded-md border px-3 py-2.5

struct TaskRowView: View {
    let item: TaskListItem
    let active: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 10) {
                    StatusPill(status: item.base.status)
                    Text(item.base.title).font(.system(size: 13)).foregroundStyle(DS.fg).lineLimit(1)
                    Spacer(minLength: 0)
                    PriorityBadge(priority: item.base.priority)
                }
                TaskMeta(labels: item.base.labels, childCount: item.childCount,
                         childDoneCount: item.childDoneCount, openBlockerCount: item.openBlockerCount)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(DS.canvas)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(active ? DS.accent : DS.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .shadow(color: .black.opacity(active ? 0.10 : 0), radius: active ? 3 : 0, y: active ? 2 : 0)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct TaskCardView: View {
    let item: TaskListItem
    let active: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 8) {
                Text(item.base.title).font(.system(size: 13)).foregroundStyle(DS.fg)
                    .lineLimit(3).frame(maxWidth: .infinity, alignment: .leading)
                TaskMeta(labels: item.base.labels, childCount: item.childCount,
                         childDoneCount: item.childDoneCount, openBlockerCount: item.openBlockerCount)
                if item.base.priority != .none {
                    HStack { Spacer(); PriorityBadge(priority: item.base.priority) }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(DS.canvasSubtle)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(active ? DS.accent : DS.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .shadow(color: .black.opacity(active ? 0.10 : 0), radius: active ? 3 : 0, y: active ? 2 : 0)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Small column helpers

struct ColumnHint: View {
    let text: String
    var body: some View {
        Text(text).font(.system(size: 12)).foregroundStyle(DS.fgSubtle)
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct ColumnPlaceholder: View {
    let text: String
    var body: some View {
        Text(text).font(.system(size: 13)).foregroundStyle(DS.fgSubtle).multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, maxHeight: .infinity).padding(24).background(DS.canvasSubtle)
    }
}
