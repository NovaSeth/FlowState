import SwiftUI

// Observable hub for the native dashboard. Mirrors the web client's data flow:
// seed from /api/dashboard + /api/solutions, lazily fetch the visible slice as
// the user drills in (solution -> project -> milestone -> task), and refetch the
// visible slice on every SSE change signal (debounced).
//
// The whole store is @MainActor: it is built and driven from the AppKit main thread
// and every @Published mutation must land on the main thread anyway. Being a
// main-actor (hence Sendable) type also lets EventStream's @Sendable callbacks
// capture a weak reference and hop back onto the main actor.
//
// Note: FlowStateKit defines a `Task` model that shadows Swift Concurrency's
// `Task`, so concurrency uses the fully-qualified `_Concurrency.Task`.
@MainActor
final class AppStore: ObservableObject {
    enum Section: String, CaseIterable { case overview, explore, users, settings }
    enum TaskViewMode: String, CaseIterable { case list, kanban }

    // Navigation (top-level section, mirrors the web NavRail).
    @Published var section: Section = .overview

    // Live data.
    @Published private(set) var dashboard: DashboardPayload?
    @Published private(set) var solutions: [SolutionRollup] = []
    @Published private(set) var projects: [ProjectRollup] = []
    @Published private(set) var milestones: [MilestoneRollup] = []
    @Published private(set) var tasks: [TaskListItem] = []
    @Published private(set) var taskDetail: TaskDetail?

    // Selection (the cascading drill state).
    @Published private(set) var selectedSolutionId: String?
    @Published private(set) var selectedProjectId: String?
    @Published private(set) var selectedMilestoneId: String?
    @Published private(set) var selectedTaskId: String?

    // View preferences (persist across navigation, like the web).
    @Published var taskViewMode: TaskViewMode = .list
    @Published var showClosed = false

    // Users (actors / keys / activity).
    @Published private(set) var actors: [Actor] = []
    @Published private(set) var apiKeys: [ApiKey] = []
    @Published private(set) var keyActivity: [Activity] = []
    @Published private(set) var selectedActorId: String?
    @Published private(set) var selectedKeyId: String?

    // Connection + error surfaces.
    @Published private(set) var isOnline = true
    @Published var errorMessage: String?

    // Gamification: a pop counter the scoreboard animates on when today's totals
    // grow, and a "YOU WIN" banner when a project or solution completes.
    enum WinKind { case project, solution }
    @Published private(set) var scorePop = 0
    @Published private(set) var winBanner: WinKind?

    // Localization (switchable at runtime from Settings).
    @Published private(set) var i18n: Localization

    private let api: FlowStateAPI
    private let events: EventStream
    private var refetchHandle: _Concurrency.Task<Void, Never>?
    private var winDismissHandle: _Concurrency.Task<Void, Never>?
    private var started = false

    init(api: FlowStateAPI, events: EventStream, locale: String = AppStore.preferredLocale()) {
        self.api = api
        self.events = events
        self.i18n = Localization.load(locale: locale, bundle: .main)
        // Launch hook (deep-link / screenshots): `--section <name>` opens a section.
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "--section"), i + 1 < args.count, let sec = Section(rawValue: args[i + 1]) {
            section = sec
        }
    }

    /// Convenience wrapper so views can call `store.t("key")`.
    func t(_ key: String, _ vars: [String: String] = [:]) -> String { i18n.t(key, vars) }

    var localeCode: String { i18n.locale }

    // MARK: - Lifecycle

    /// Seed the overview + solutions, then start the live SSE stream once.
    @MainActor
    func bootstrap() async {
        await reloadOverview()
        await startEvents()
    }

    /// Start the SSE stream if it is not already running. Idempotent: `started` is
    /// flipped before the first `await`, so concurrent callers (initial bootstrap +
    /// resumeLive on window show) never double-subscribe.
    @MainActor
    private func startEvents() async {
        guard !started else { return }
        started = true
        events.start(
            onChange: { [weak self] in
                _Concurrency.Task { @MainActor in self?.scheduleRefetch() }
            },
            onOnline: { [weak self] online in
                _Concurrency.Task { @MainActor in self?.isOnline = online }
            }
        )
    }

    /// Tear down the live SSE connection + watchdog (called when the dashboard
    /// window closes) so they do not keep running invisibly for the app's lifetime.
    @MainActor
    func suspendLive() {
        events.stop()
        started = false
    }

    /// Resume the live stream when the window reopens and catch up on anything that
    /// changed while it was suspended.
    @MainActor
    func resumeLive() async {
        await startEvents()
        await refetchVisible()
    }

    /// Debounce a burst of SSE signals into a single visible-slice refetch.
    @MainActor
    private func scheduleRefetch() {
        refetchHandle?.cancel()
        refetchHandle = _Concurrency.Task { @MainActor [weak self] in
            try? await _Concurrency.Task.sleep(nanoseconds: 150_000_000)
            guard let self, !_Concurrency.Task.isCancelled else { return }
            await self.refetchVisible()
        }
    }

    // MARK: - Loading

    @MainActor
    func reloadOverview() async {
        do {
            let fresh = try await api.dashboard()
            detectCelebrations(previous: dashboard, fresh: fresh)
            dashboard = fresh
        } catch { capture(error) }
        do { solutions = try await api.solutions() } catch { capture(error) }
    }

    /// Refetch exactly what is on screen (plus the overview rollup), preserving
    /// the current selection - the native equivalent of the web live refresh.
    @MainActor
    func refetchVisible() async {
        await reloadOverview()
        if let id = selectedSolutionId { await loadProjects(id) }
        if let id = selectedProjectId { await loadMilestones(id) }
        if let id = selectedMilestoneId { await loadTasks(id) }
        if let id = selectedTaskId { await loadTaskDetail(id) }
        if section == .users {
            await loadUsers()
            if let k = selectedKeyId { await selectKey(k) }
        }
    }

    @MainActor
    private func loadProjects(_ solutionId: String) async {
        do { projects = try await api.projects(solutionId: solutionId) } catch { capture(error) }
    }
    @MainActor
    private func loadMilestones(_ projectId: String) async {
        do { milestones = try await api.milestones(projectId: projectId) } catch { capture(error) }
    }
    @MainActor
    private func loadTasks(_ milestoneId: String) async {
        do { tasks = try await api.tasks(milestoneId: milestoneId) } catch { capture(error) }
    }
    @MainActor
    private func loadTaskDetail(_ id: String) async {
        do { taskDetail = try await api.taskDetail(id: id) }
        catch {
            // The selected task was deleted/pruned (e.g. by another agent): drop the
            // stale selection + detail instead of leaving the inspector open on a
            // task that no longer exists.
            if (error as? APIError)?.status == 404 {
                if selectedTaskId == id { selectedTaskId = nil }
                taskDetail = nil
                errorMessage = nil
            } else {
                capture(error)
            }
        }
    }

    // MARK: - Selection (drill). Each level resets the deeper ones, like the web.

    @MainActor
    func selectSolution(_ id: String) async {
        selectedSolutionId = id
        selectedProjectId = nil; selectedMilestoneId = nil; selectedTaskId = nil
        projects = []; milestones = []; tasks = []; taskDetail = nil
        await loadProjects(id)
    }

    @MainActor
    func selectProject(_ id: String) async {
        selectedProjectId = id
        selectedMilestoneId = nil; selectedTaskId = nil
        milestones = []; tasks = []; taskDetail = nil
        await loadMilestones(id)
    }

    @MainActor
    func selectMilestone(_ id: String) async {
        selectedMilestoneId = id
        selectedTaskId = nil; taskDetail = nil
        tasks = []
        await loadTasks(id)
    }

    @MainActor
    func selectTask(_ id: String?) async {
        selectedTaskId = id
        taskDetail = nil
        if let id { await loadTaskDetail(id) }
    }

    @MainActor
    func closeTask() { selectedTaskId = nil; taskDetail = nil }

    // MARK: - Gamification (scoreboard pop + "YOU WIN" banner)

    @MainActor
    private func detectCelebrations(previous: DashboardPayload?, fresh: DashboardPayload) {
        guard let prev = previous else { return }  // never celebrate the initial load
        let before = prev.completedToday, after = fresh.completedToday
        if after.tasks > before.tasks || after.milestones > before.milestones || after.projects > before.projects {
            scorePop &+= 1
        }
        if after.projects > before.projects {
            triggerWin(.project)
        } else if fresh.completed.solutionsDone > prev.completed.solutionsDone {
            triggerWin(.solution)
        }
    }

    @MainActor
    private func triggerWin(_ kind: WinKind) {
        winBanner = kind
        winDismissHandle?.cancel()
        winDismissHandle = _Concurrency.Task { @MainActor [weak self] in
            try? await _Concurrency.Task.sleep(nanoseconds: 3_200_000_000)
            if !_Concurrency.Task.isCancelled { self?.winBanner = nil }
        }
    }

    @MainActor
    func dismissWin() {
        winDismissHandle?.cancel()
        winBanner = nil
    }

    // MARK: - Users (read-only: actors / keys / activity)

    @MainActor
    func loadUsers() async {
        do { actors = try await api.actors() } catch { capture(error) }
        do { apiKeys = try await api.keys() } catch { capture(error) }
    }

    @MainActor
    func selectActor(_ id: String) {
        selectedActorId = id
        selectedKeyId = nil
        keyActivity = []
    }

    @MainActor
    func selectKey(_ id: String) async {
        selectedKeyId = id
        do { keyActivity = try await api.activity(entityId: id, limit: 100) } catch { capture(error) }
    }

    // MARK: - Mutations (apply the server result, then refetch the slice).

    @MainActor
    func setStatus(_ taskId: String, _ status: TaskStatus, reason: String? = nil) async {
        do {
            taskDetail = try await api.setStatus(
                taskId: taskId, status: status,
                reason: reason, reasonAuthor: reason == nil ? nil : "dashboard"
            )
            await refetchVisible()
        } catch { capture(error) }
    }

    @MainActor
    func setPriority(_ taskId: String, _ priority: TaskPriority) async {
        do {
            taskDetail = try await api.setPriority(taskId: taskId, priority: priority)
            await refetchVisible()
        } catch { capture(error) }
    }

    /// Returns true only if the comment was accepted by the server, so the view can
    /// keep the user's draft on failure rather than discarding it.
    @MainActor
    @discardableResult
    func addComment(_ taskId: String, _ body: String) async -> Bool {
        let text = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return false }
        do {
            _ = try await api.addComment(taskId: taskId, body: text)
            await loadTaskDetail(taskId)
            return true
        } catch { capture(error); return false }
    }

    // MARK: - Locale

    @MainActor
    func setLocale(_ code: String) {
        i18n = Localization.load(locale: code, bundle: .main)
        UserDefaults.standard.set(code, forKey: "fs.locale")
    }

    static func preferredLocale() -> String {
        if let saved = UserDefaults.standard.string(forKey: "fs.locale") { return saved }
        let system = Locale.preferredLanguages.first ?? "en"
        return system.hasPrefix("pl") ? "pl" : "en"
    }

    @MainActor
    private func capture(_ error: Error) {
        errorMessage = String(describing: error)
    }
}
