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
            if store.selectedProjectId != nil {
                projectRegion
            } else {
                ColumnPlaceholder(text: placeholderText)
            }
            // The trailing inspector edge: the project dashboard panel (kebab
            // "Open dashboard") or the task detail - mutually exclusive, the
            // store closes one when the other opens (web drawer parity).
            if let dashProject = store.projects.first(where: { $0.id == store.dashboardProjectId }) {
                ProjectPanel(project: dashProject)
                    // Remount per project so transient panel state never carries over.
                    .id(dashProject.id)
                    // A third wider than the task inspector - it is a dashboard.
                    .frame(width: 500)
                    .overlay(Rectangle().frame(width: 1).foregroundStyle(DS.border), alignment: .leading)
            } else if store.selectedTaskId != nil {
                TaskDetailPanel()
                    // Remount per task so the panel's editing @State (comment draft,
                    // pending-block reason) starts fresh and never carries over onto
                    // a different task.
                    .id(store.selectedTaskId)
                    .frame(width: 380)
                    .overlay(Rectangle().frame(width: 1).foregroundStyle(DS.border), alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DS.canvas)
    }

    // MARK: - Project region (Miller cascade: Milestones column -> task pane)

    private var projectRegion: some View {
        HStack(alignment: .top, spacing: 0) {
            milestonesColumn
            if store.selectedMilestoneId != nil {
                TaskPaneView().frame(minWidth: 360, maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ColumnPlaceholder(text: i18n.t("explorer.pickMilestone"))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DS.canvas)
    }

    // MARK: - Columns

    // Each column: live rows, then a collapsible "Archived" section (mirrors the
    // web withArchivedDivider), and a create form pinned at the bottom (footer:).

    private var solutionsColumn: some View {
        MillerColumn(title: i18n.t("explorer.solutions"), count: store.solutions.count, collapseId: "solutions") {
            if store.solutions.isEmpty {
                ColumnHint(text: i18n.t("explorer.noSolutions"))
            } else {
                ArchivedDivider(
                    archivedCount: store.solutions.filter { $0.base.status == .archived }.count,
                    live: { ForEach(store.solutions.filter { $0.base.status != .archived }) { solutionRow($0) } },
                    archived: { ForEach(store.solutions.filter { $0.base.status == .archived }) { solutionRow($0) } }
                )
            }
        } footer: {
            InlineCreateForm(
                triggerLabel: i18n.t("forms.newSolution"),
                placeholder: i18n.t("forms.solutionNamePlaceholder")
            ) { await store.createSolution($0) }
        }
    }

    @ViewBuilder
    private func solutionRow(_ sol: SolutionRollup) -> some View {
        DrillRow(
            title: sol.base.name, counts: sol.statusCounts, percent: sol.progress.percent,
            sub: i18n.t("units.projShort", ["n": "\(sol.projectCount)"]),
            pillKey: sol.base.status == .archived ? DS.solutionStatusLabelKey(.archived) : nil,
            pill: DS.solutionStatusPill(.archived),
            blocked: 0, dimmed: sol.base.status == .archived,
            menu: solutionMenu(sol),
            active: store.selectedSolutionId == sol.id
        ) { _Concurrency.Task { await store.selectSolution(sol.id) } }
    }

    private func solutionMenu(_ sol: SolutionRollup) -> EntityMenuModel {
        let store = self.store
        return EntityMenuModel(
            editTitle: i18n.t("entity.editSolution"),
            name: sol.base.name,
            description: sol.base.description,
            status: sol.base.status.rawValue,
            statusOptions: SolutionStatus.allCases.map {
                EntityOption(value: $0.rawValue, labelKey: DS.solutionStatusLabelKey($0))
            },
            outcome: nil, outcomeOptions: nil,
            saveDetails: { name, description in
                try await store.updateSolution(sol.id, name: name, description: description)
            },
            setStatus: { raw in
                try await store.updateSolution(sol.id, status: SolutionStatus(rawValue: raw))
            },
            setOutcome: nil,
            delete: { try await store.deleteSolution(sol.id) }
        )
    }

    private var projectsColumn: some View {
        MillerColumn(title: i18n.t("explorer.projects"), count: store.projects.count, collapseId: "projects") {
            if store.projects.isEmpty {
                ColumnHint(text: i18n.t("explorer.noProjects"))
            } else {
                ArchivedDivider(
                    archivedCount: store.projects.filter { $0.base.status == .archived }.count,
                    live: { ForEach(store.projects.filter { $0.base.status != .archived }) { projectRow($0) } },
                    archived: { ForEach(store.projects.filter { $0.base.status == .archived }) { projectRow($0) } }
                )
            }
        } footer: {
            InlineCreateForm(
                triggerLabel: i18n.t("forms.newProject"),
                placeholder: i18n.t("forms.projectNamePlaceholder")
            ) { await store.createProject($0) }
        }
    }

    @ViewBuilder
    private func projectRow(_ proj: ProjectRollup) -> some View {
        DrillRow(
            title: proj.base.name, counts: proj.statusCounts, percent: proj.progress.percent,
            sub: i18n.t("units.milestoneShort", ["n": "\(proj.milestoneCount)"]),
            pillKey: DS.projectStatusLabelKey(proj.base.status),
            pill: DS.projectStatusPill(proj.base.status),
            blocked: 0, dimmed: proj.base.status == .archived,
            menu: projectMenu(proj),
            active: store.selectedProjectId == proj.id
        ) { _Concurrency.Task { await store.selectProject(proj.id) } }
    }

    private func projectMenu(_ proj: ProjectRollup) -> EntityMenuModel {
        let store = self.store
        return EntityMenuModel(
            editTitle: i18n.t("entity.editProject"),
            name: proj.base.name,
            description: proj.base.description,
            status: proj.base.status.rawValue,
            statusOptions: ProjectStatus.allCases.map {
                EntityOption(value: $0.rawValue, labelKey: DS.projectStatusLabelKey($0))
            },
            outcome: nil, outcomeOptions: nil,
            saveDetails: { name, description in
                try await store.updateProject(proj.id, name: name, description: description)
            },
            setStatus: { raw in
                try await store.updateProject(proj.id, status: ProjectStatus(rawValue: raw))
            },
            setOutcome: nil,
            delete: { try await store.deleteProject(proj.id) },
            openLabel: i18n.t("entity.openDashboard"),
            open: { _Concurrency.Task { await store.openProjectDashboard(proj.id) } }
        )
    }

    private var milestonesColumn: some View {
        MillerColumn(title: i18n.t("explorer.milestones"), count: store.milestones.count, collapseId: "milestones") {
            if store.milestones.isEmpty {
                ColumnHint(text: i18n.t("explorer.noMilestones"))
            } else {
                ArchivedDivider(
                    archivedCount: store.milestones.filter { $0.base.status == .archived }.count,
                    live: { ForEach(store.milestones.filter { $0.base.status != .archived }) { milestoneRow($0) } },
                    archived: { ForEach(store.milestones.filter { $0.base.status == .archived }) { milestoneRow($0) } }
                )
            }
        } footer: {
            InlineCreateForm(
                triggerLabel: i18n.t("forms.newMilestone"),
                placeholder: i18n.t("forms.milestoneTitlePlaceholder")
            ) { await store.createMilestone($0) }
        }
    }

    @ViewBuilder
    private func milestoneRow(_ ms: MilestoneRollup) -> some View {
        DrillRow(
            title: ms.base.title, counts: ms.statusCounts, percent: ms.progress.percent,
            sub: i18n.t("units.taskShort", ["n": "\(ms.progress.total)"]),
            pillKey: DS.projectStatusLabelKey(ms.base.status),
            pill: DS.projectStatusPill(ms.base.status),
            blocked: ms.statusCounts.blocked, dimmed: ms.base.status == .archived,
            menu: milestoneMenu(ms),
            active: store.selectedMilestoneId == ms.id
        ) { _Concurrency.Task { await store.selectMilestone(ms.id) } }
    }

    private func milestoneMenu(_ ms: MilestoneRollup) -> EntityMenuModel {
        let store = self.store
        return EntityMenuModel(
            editTitle: i18n.t("entity.editMilestone"),
            name: ms.base.title,
            description: ms.base.description,
            status: ms.base.status.rawValue,
            statusOptions: MilestoneStatus.allCases.map {
                EntityOption(value: $0.rawValue, labelKey: DS.projectStatusLabelKey($0))
            },
            outcome: ms.base.outcome?.rawValue,
            outcomeOptions: MilestoneOutcome.allCases.map {
                EntityOption(value: $0.rawValue, labelKey: DS.outcomeLabelKey($0))
            },
            saveDetails: { name, description in
                // The edit form's "name" is the milestone's title on the API.
                try await store.updateMilestone(ms.id, title: name, description: description)
            },
            setStatus: { raw in
                try await store.updateMilestone(ms.id, status: MilestoneStatus(rawValue: raw))
            },
            setOutcome: { raw in
                // nil clears the outcome (PATCH outcome: null), like the web "None".
                try await store.updateMilestone(ms.id, outcome: .some(raw.flatMap(MilestoneOutcome.init(rawValue:))))
            },
            delete: { try await store.deleteMilestone(ms.id) }
        )
    }

    private var placeholderText: String {
        if store.selectedSolutionId == nil { return i18n.t("explorer.pickSolution") }
        return i18n.t("explorer.pickProject")
    }
}

// MARK: - Miller column (collapsible)

struct MillerColumn<Content: View, Footer: View>: View {
    @Environment(\.i18n) private var i18n
    let title: String
    let count: Int
    let collapseId: String?
    private let content: Content
    // Pinned below the scrollable body (e.g. a create form), full-width. Defaults
    // to EmptyView via the convenience init for footer-less columns (UsersView).
    private let footer: Footer
    @State private var collapsed: Bool

    init(
        title: String, count: Int, collapseId: String? = nil,
        @ViewBuilder content: () -> Content,
        @ViewBuilder footer: () -> Footer
    ) {
        self.title = title
        self.count = count
        self.collapseId = collapseId
        self.content = content()
        self.footer = footer()
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
                    footer
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

// Footer-less columns (e.g. UsersView) keep the original call shape.
extension MillerColumn where Footer == EmptyView {
    init(title: String, count: Int, collapseId: String? = nil, @ViewBuilder content: () -> Content) {
        self.init(title: title, count: count, collapseId: collapseId, content: content, footer: { EmptyView() })
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
    // Archived rows render at half opacity, full on hover (web: opacity-50 hover:opacity-100).
    var dimmed: Bool = false
    // Row actions (edit / status / delete): hover-revealed kebab + context menu.
    var menu: EntityMenuModel? = nil
    let active: Bool
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        rowButton
            .entityMenu(menu, revealed: hovering)
            .opacity(dimmed && !hovering ? 0.5 : 1)
            .onHover { hovering = $0 }
    }

    private var rowButton: some View {
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
            if visible.isEmpty {
                ColumnHint(text: i18n.t("explorer.noTasks"))
                Spacer()
            } else if store.taskViewMode == .list {
                listView
            } else {
                kanbanView
            }
            // Create form pinned at the bottom; files into the open milestone.
            InlineCreateForm(
                triggerLabel: i18n.t("forms.newTask"),
                placeholder: i18n.t("forms.taskTitlePlaceholder")
            ) { await store.createTask($0) }
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
            // Gate the closed column on the VISIBLE set (matches the web): with
            // show-closed off, `visible` has no closed tasks, so the column does not
            // appear as an empty phantom.
            s == .closed ? visible.contains { $0.base.status == .closed } : true
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
                    .lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
                // Short context under the title: clamped to two lines (tail-truncated)
                // so every card keeps the same shape, mirroring the web line-clamp-2.
                if !item.base.description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text(item.base.description).font(.system(size: 12)).foregroundStyle(DS.fgMuted)
                        .lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
                }
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

// MARK: - Inline create form (web forms.tsx: AddTrigger -> text field + Add/Cancel)

/// Collapsed: a dashed "+ New X" trigger pinned at the bottom of a column.
/// Expanded: a text field with Add / Cancel. `submit` returns whether the create
/// succeeded; on success the field clears and collapses, on failure the text is
/// kept (same contract as the comment composer / the web useCreate hook).
struct InlineCreateForm: View {
    @Environment(\.i18n) private var i18n
    let triggerLabel: String
    let placeholder: String
    let submit: (String) async -> Bool

    @State private var open = false
    @State private var text = ""
    @State private var busy = false

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(spacing: 0) {
            Rectangle().frame(height: 1).foregroundStyle(DS.border)
            content.padding(8)
        }
        .background(DS.canvas)
    }

    @ViewBuilder private var content: some View {
        if open {
            VStack(alignment: .leading, spacing: 8) {
                TextField(placeholder, text: $text)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { trigger() }
                HStack(spacing: 8) {
                    Button(i18n.t("forms.add")) { trigger() }
                        .buttonStyle(.borderedProminent)
                        .disabled(busy || trimmed.isEmpty)
                    Button(i18n.t("forms.cancel")) { reset() }
                        .buttonStyle(.bordered)
                        .disabled(busy)
                }
            }
        } else {
            Button { open = true } label: {
                HStack(spacing: 6) {
                    Image(systemName: "plus").font(.system(size: 12))
                    Text(triggerLabel).font(.system(size: 13))
                    Spacer(minLength: 0)
                }
                .foregroundStyle(DS.fgMuted)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .frame(maxWidth: .infinity)
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .strokeBorder(DS.border, style: StrokeStyle(lineWidth: 1, dash: [4]))
                )
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    // Mirrors the comment-send pattern: state mutated inside a Task that inherits
    // the main actor (SwiftUI View bodies are @MainActor under Swift 6).
    private func trigger() {
        guard !trimmed.isEmpty, !busy else { return }
        let value = trimmed
        busy = true
        _Concurrency.Task {
            let ok = await submit(value)
            busy = false
            if ok { reset() }
        }
    }

    private func reset() {
        text = ""
        open = false
    }
}

// MARK: - Archived divider (web miller.tsx withArchivedDivider)

/// Renders live rows, then - when there are archived items - a collapsible
/// "Archived" header (collapsed by default) with a count, revealing the archived
/// rows when expanded.
struct ArchivedDivider<Live: View, Archived: View>: View {
    @Environment(\.i18n) private var i18n
    let archivedCount: Int
    @ViewBuilder let live: () -> Live
    @ViewBuilder let archived: () -> Archived

    @State private var open = false

    var body: some View {
        live()
        if archivedCount > 0 {
            Button { open.toggle() } label: {
                HStack(spacing: 8) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11)).foregroundStyle(DS.fgSubtle)
                        .rotationEffect(.degrees(open ? 90 : 0))
                    Eyebrow(text: i18n.t("common.archived"))
                    CountPill(count: archivedCount)
                    Rectangle().frame(height: 1).foregroundStyle(DS.border)
                }
                .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 4)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open { archived() }
        }
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
