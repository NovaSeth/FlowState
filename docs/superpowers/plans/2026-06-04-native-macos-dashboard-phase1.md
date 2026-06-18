# Native macOS dashboard (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the macOS app's WKWebView dashboard with a native SwiftUI client that browses the Flow State hierarchy live over the existing localhost REST + SSE API, with core mutations and EN/PL.

**Architecture:** Pure, testable logic (models, REST client, SSE consumer, localization) lives in a `FlowStateKit` SPM library with XCTest coverage. The AppKit shell (`macos/src/`) keeps owning the menu bar, server lifecycle, and window, but hosts a SwiftUI `DashboardRootView` via `NSHostingController` instead of a `WKWebView`. `build.sh` compiles the Kit sources into the app bundle alongside the app sources.

**Tech Stack:** Swift 6, SwiftUI, AppKit interop (`NSHostingController`), Foundation `URLSession` (`.bytes` for SSE), SwiftPM + XCTest.

---

## File structure

New library (pure, no AppKit/SwiftUI; Foundation only) - testable:
- `macos/Sources/FlowStateKit/Models.swift` - Codable mirrors of `src/lib/types.ts` (Solution, Project, Milestone, Task, TaskDetail, Comment, Actor, DashboardPayload, rollups, enums).
- `macos/Sources/FlowStateKit/FlowStateAPI.swift` - async REST client; injects base URL + `x-fs-dashboard: 1`.
- `macos/Sources/FlowStateKit/EventStream.swift` - SSE consumer over `URLSession.bytes`; emits change signal + `isOnline` from ping liveness.
- `macos/Sources/FlowStateKit/Localization.swift` - loads bundled en/pl JSON; `t(_:_: )` nested lookup + `{var}` interpolation.

App (AppKit + SwiftUI), in `macos/src/`:
- `macos/src/AppStore.swift` - `@MainActor ObservableObject`; holds state, subscribes to EventStream, exposes mutations.
- `macos/src/DashboardRootView.swift` - `NavigationSplitView` root.
- `macos/src/SidebarView.swift` - solutions -> projects.
- `macos/src/ContentView.swift` - milestones + tasks of the selected project.
- `macos/src/TaskDetailView.swift` - selected task + comments + mutations.
- `macos/src/OverviewView.swift` - totals/progress/attention/scoreboard from DashboardPayload.
- `macos/src/OfflineOverlayView.swift` - shown when offline.
- Modify `macos/src/DashboardWindow.swift` - host `NSHostingController(rootView:)`, drop WKWebView + load-time ReconnectOverlay.

Build/test:
- `macos/Package.swift` - library `FlowStateKit` + test target `FlowStateKitTests`.
- `macos/Tests/FlowStateKitTests/*.swift` + `fixtures/*.json` (captured from the live API).
- Modify `macos/build.sh` - also compile `Sources/FlowStateKit/*.swift` into the bundle; copy `src/i18n/en.json` + `pl.json` into Resources.

Conventions: comments in English, no em-dash, no emoji. Keep files focused.

---

## Task 0: SPM + test scaffolding

**Files:**
- Create: `macos/Package.swift`
- Create: `macos/Sources/FlowStateKit/Version.swift` (a trivial symbol so the target compiles)
- Create: `macos/Tests/FlowStateKitTests/SmokeTests.swift`

- [ ] **Step 1: Write Package.swift**

```swift
// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "FlowStateKit",
    platforms: [.macOS(.v13)],
    targets: [
        .target(name: "FlowStateKit", path: "Sources/FlowStateKit"),
        .testTarget(
            name: "FlowStateKitTests",
            dependencies: ["FlowStateKit"],
            path: "Tests/FlowStateKitTests",
            resources: [.copy("fixtures")]
        ),
    ]
)
```

- [ ] **Step 2: Trivial source + smoke test**

`Version.swift`: `public enum FlowStateKit { public static let version = "0.1.0" }`
`SmokeTests.swift`: assert `FlowStateKit.version == "0.1.0"`.

- [ ] **Step 3: Run** `cd macos && swift test` - Expected: builds, smoke passes.
- [ ] **Step 4: Commit** `feat(macos): FlowStateKit SPM library + test scaffolding`.

---

## Task 1: Codable models + fixture-decode tests

**Files:**
- Create: `macos/Sources/FlowStateKit/Models.swift`
- Create: `macos/Tests/FlowStateKitTests/ModelsTests.swift`
- Fixtures already captured: `fixtures/{dashboard,solutions,projects,milestones,tasks,task-detail,actors}.json`

The guard against drift from `types.ts`: decode each real fixture into the Swift type and assert key fields.

- [ ] **Step 1: Write failing tests** - decode every fixture, assert representative fields:

```swift
func testDecodeDashboard() throws {
    let data = try fixture("dashboard")
    let d = try JSONDecoder().decode(DashboardPayload.self, from: data)
    XCTAssertGreaterThan(d.totals.tasks, 0)
    XCTAssertEqual(d.progress.percent, d.progress.total == 0 ? 0 : Int(round(Double(d.progress.done) / Double(d.progress.total) * 100)))
    XCTAssertFalse(d.solutions.isEmpty)
}
func testDecodeTaskDetail() throws {
    let t = try JSONDecoder().decode(TaskDetail.self, from: try fixture("task-detail"))
    XCTAssertFalse(t.id.isEmpty)
    XCTAssertNotNil(TaskStatus(rawValue: t.status.rawValue))
}
// ...solutions [SolutionRollup], projects [ProjectRollup], milestones [MilestoneRollup],
//    tasks [TaskListItem], actors [Actor]
```

`fixture(_:)` helper: `Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "fixtures")`.

- [ ] **Step 2: Run** `swift test --filter ModelsTests` - Expected: FAIL (types undefined).
- [ ] **Step 3: Implement Models.swift** - enums as `String, Codable` (TaskStatus, TaskPriority, BlockerType, MilestoneOutcome, ProjectStatus, MilestoneStatus, SolutionStatus, ActorKind, KeyScope, ArtifactKind); structs with exact field names matching `src/lib/types.ts` (see report: Task, TaskDetail, Solution/Project/Milestone + Rollups, Comment, Actor, DashboardPayload with totals/statusCounts/progress/completed/completedToday/solutions/attention/recent/dailyByStatus). Use `Decodable`; optional fields as Swift optionals; unknown enum values tolerated via a decoding fallback where the web allows it.
- [ ] **Step 4: Run** `swift test --filter ModelsTests` - Expected: PASS.
- [ ] **Step 5: Commit** `feat(macos): Codable models with live-fixture decode tests`.

---

## Task 2: Localization

**Files:**
- Create: `macos/Sources/FlowStateKit/Localization.swift`
- Create: `macos/Tests/FlowStateKitTests/LocalizationTests.swift`
- Test resource: copy `src/i18n/en.json` + `pl.json` into `Tests/FlowStateKitTests/fixtures/` at build time (Task 0 already copies the fixtures dir; add an i18n copy step in build.sh in Task 10 for the app).

- [ ] **Step 1: Failing tests**

```swift
func testNestedKeyAndInterpolation() {
    let loc = Localization(locale: "en", tables: ["en": ["users": ["keyCount": "{n} keys"]]])
    XCTAssertEqual(loc.t("users.keyCount", ["n": "3"]), "3 keys")
}
func testFallsBackToEnThenKey() {
    let loc = Localization(locale: "pl", tables: ["en": ["a": ["b": "X"]], "pl": [:]])
    XCTAssertEqual(loc.t("a.b"), "X")     // pl missing -> en
    XCTAssertEqual(loc.t("no.such"), "no.such")
}
func testEnAndPlHaveSameKeys() throws {
    let en = try flatKeys(fixtureJSON("en")); let pl = try flatKeys(fixtureJSON("pl"))
    XCTAssertEqual(en, pl)               // parity guard, mirrors src/i18n
}
```

- [ ] **Step 2: Run** - Expected: FAIL.
- [ ] **Step 3: Implement** - `Localization` with `tables: [String: Any]` nested dicts; `t(key, vars)` splits on `.`, walks the dict, interpolates `{name}`; fallback locale -> en -> key. A static `Localization.load(locale:bundle:)` reads `en.json`/`pl.json`.
- [ ] **Step 4: Run** - Expected: PASS.
- [ ] **Step 5: Commit** `feat(macos): localization with en/pl parity test`.

---

## Task 3: FlowStateAPI (REST client)

**Files:**
- Create: `macos/Sources/FlowStateKit/FlowStateAPI.swift`
- Create: `macos/Tests/FlowStateKitTests/FlowStateAPITests.swift`

Inject `URLSession` (configurable `URLProtocol` stub) + base URL. Every request sets `x-fs-dashboard: 1`.

- [ ] **Step 1: Failing tests** - with a `MockURLProtocol` returning the dashboard fixture, assert `api.dashboard()` decodes and that the sent request carried `x-fs-dashboard: 1` and hit `/api/dashboard`. Same for `tasks(milestoneId:)`, `taskDetail(id:)`. For mutations, assert method/body: `setStatus(taskId:status:reason:)` issues `PATCH /api/tasks/{id}` with JSON `{status,...}`; `addComment(taskId:body:author:)` issues `POST /api/tasks/{id}/comments`.
- [ ] **Step 2: Run** - Expected: FAIL.
- [ ] **Step 3: Implement** - `struct FlowStateAPI` with `init(baseURL:session:)`; private `get<T:Decodable>(_ path:)` and `send<T>(_ method:path:body:)`; methods: `dashboard()`, `solutions()`, `projects(solutionId:)`, `milestones(projectId:)`, `tasks(milestoneId:)`, `taskDetail(id:)`, `setStatus(taskId:status:reason:reasonAuthor:)`, `setPriority(taskId:priority:)`, `addComment(taskId:body:author:)`. Non-2xx -> throws `APIError`.
- [ ] **Step 4: Run** - Expected: PASS.
- [ ] **Step 5: Commit** `feat(macos): FlowStateAPI REST client with mocked tests`.

---

## Task 4: EventStream (SSE + liveness)

**Files:**
- Create: `macos/Sources/FlowStateKit/EventStream.swift`
- Create: `macos/Tests/FlowStateKitTests/EventStreamTests.swift`

Mirror the web model: `data:` frame = change signal; `event: ping` every 5s; ping-gap > 12s = offline.

- [ ] **Step 1: Failing tests** - feed a synthetic line sequence through the frame parser (a pure `func parseSSE(line:) -> SSEEvent?` or a parser struct): assert `data: {"type":"x","at":"..."}` yields `.change`, `event: ping\ndata: 1` yields `.ping`, comments/blank yield nil. Liveness: a `Liveness` helper given timestamps asserts `isOnline` flips false after a > 12s gap and true on a fresh ping.
- [ ] **Step 2: Run** - Expected: FAIL.
- [ ] **Step 3: Implement** - `SSEParser` (line buffer -> events) kept pure/testable; `EventStream` actor wraps `URLSession.bytes(for:)`, parses lines, calls an `onChange` closure and updates `isOnline`, reconnects with backoff. The transport loop is thin; the parser + liveness math are the tested core.
- [ ] **Step 4: Run** - Expected: PASS.
- [ ] **Step 5: Commit** `feat(macos): SSE EventStream with parser + liveness tests`.

---

## Task 5: AppStore

**Files:**
- Create: `macos/src/AppStore.swift`
- Create: `macos/Tests/FlowStateKitTests/` not applicable (AppStore is app-target, MainActor/Combine). Test the refetch decision via a small pure helper if feasible; otherwise rely on integration smoke.

- [ ] **Step 1: Implement** `@MainActor final class AppStore: ObservableObject` with `@Published` solutions/projects/milestones/tasks/selectedTask/dashboard/isOnline; `init(api:eventStream:)`; `load()` seeds dashboard + solutions; `select*` lazily fetch the visible slice; `onChange` (from EventStream) debounces ~150ms then refetches the visible slice + dashboard; mutation methods delegate to `FlowStateAPI` and refetch.
- [ ] **Step 2: Build** `cd macos && ./build.sh` (after Task 10 wires Kit into build) - Expected: compiles.
- [ ] **Step 3: Commit** `feat(macos): AppStore observable state + live refetch`.

---

## Task 6-9: SwiftUI views

Each: implement the view, build the app, eyeball-smoke, commit. (Views are not unit-tested; the build is the gate, visual check is the user's.)

- [ ] **Task 6 DashboardRootView + Sidebar + Content + TaskDetail** - `NavigationSplitView { SidebarView } content: { ContentView } detail: { TaskDetailView }`. Sidebar lists solutions, disclosure to projects; selecting a project drives ContentView (milestones grouped with their tasks); selecting a task drives TaskDetailView. Status/priority shown with small pills mirroring the web. Commit.
- [ ] **Task 7 OverviewView + Scoreboard** - totals, status breakdown, progress bar, attention list, today counters from `dashboard.completedToday`. A tab or top section of the root. Commit.
- [ ] **Task 8 OfflineOverlayView** - overlay bound to `store.isOnline`; copy mirrors web OfflineOverlay (use localization keys `conn.*`). Commit.
- [ ] **Task 9 Mutations** - in TaskDetailView: a status Picker and priority Picker calling `store.setStatus/ setPriority`; a comment field calling `store.addComment(author: "dashboard")`. Optimistic update, reconcile on next refetch. Commit.

---

## Task 10: AppKit integration + build wiring

**Files:**
- Modify: `macos/build.sh` (compile `Sources/FlowStateKit/*.swift` with the app; copy `../src/i18n/en.json` + `pl.json` into `Resources`)
- Modify: `macos/src/DashboardWindow.swift`

- [ ] **Step 1: build.sh** - add `Sources/FlowStateKit/*.swift` to the swiftc source glob; `cp ../src/i18n/en.json ../src/i18n/pl.json "$RES_DIR/"`.
- [ ] **Step 2: DashboardWindow** - replace WKWebView with `let host = NSHostingController(rootView: DashboardRootView().environmentObject(store))`; set `window.contentViewController = host`. Build the `AppStore` once (base URL from `controller.dashboardURL`), load on first show. Remove WKWebView, `ReconnectOverlay` load-time logic, and the retry timer (liveness now lives in `EventStream`/`AppStore`).
- [ ] **Step 3: Build** `./build.sh` - Expected: bundle builds.
- [ ] **Step 4: Smoke** - launch `build/FlowState.app`, open the dashboard window from the menu bar, confirm it renders the hierarchy and does not crash; toggle a task status and see it persist (verify via `curl /api/tasks/{id}`).
- [ ] **Step 5: Commit** `feat(macos): native SwiftUI dashboard replaces WKWebView`.

---

## Task 11: Verify + finalize

- [ ] `cd macos && swift test` green; `./build.sh` clean; app launches and the dashboard is live (SSE updates when an MCP/other client mutates).
- [ ] Update `macos/README.md` to describe the native dashboard.
- [ ] Commit + push.

---

## Notes / risks

- Codable drift is guarded by fixture-decode tests; if `types.ts` changes, re-capture fixtures and re-run.
- Mutation auth assumes the default local server (no `FS_API_KEY`); keyless dashboard writes are allowed (same as the web UI).
- Visual correctness of the SwiftUI views is the one thing the build gate cannot prove; the user eyeballs it at Task 10 smoke.
- The WKWebView removal is the irreversible step; keep it as the LAST app change (Task 10) so everything else is in place and tested first.
