# Native macOS dashboard - design

Status: draft for review
Date: 2026-06-04

## Problem

The macOS app (`macos/`) is an AppKit menu-bar app that runs the Next.js server
as a child process and shows the dashboard in a `WKWebView` (`DashboardWindow.swift`).
We want the dashboard to be native: real SwiftUI, not a wrapped web page.

## Guiding decision: native CLIENT, unchanged SERVER

We replace the WKWebView with native SwiftUI views. We do NOT rewrite the server.
The Next.js app keeps owning the REST API, SSE, the SQLite store, and the MCP
server, because:

- Agents talk to it over HTTP; that contract must not move.
- The web dashboard stays available in a browser and on iOS/LAN.
- The menu-bar app already launches and supervises the server as a child process.

So the macOS app keeps its AppKit shell (`AppDelegate`, `ServerController`, menu
bar, server lifecycle) and swaps the WKWebView dashboard for a SwiftUI one hosted
via `NSHostingController`.

## Architecture

Five units with clear boundaries; each is understandable and testable alone.

### `FlowStateAPI` - REST client
- async/await, `Codable` models mirroring `src/lib/types.ts`.
- Sends `x-fs-dashboard: 1` on every request. This is the same keyless local
  trust the web dashboard uses (`src/lib/http.ts:170-179`): GETs are allowed, and
  mutations are allowed too when the local server has no `FS_API_KEY` /
  `FS_AUTH=strict` (the keys live in the MCP client config, not the server
  process; the web dashboard already mutates this way: status, comments, deletes).
- Base URL comes from `ServerController` (the app owns the port; do not hardcode
  3000 vs 5138).
- Surface needed for Phase 1: `GET /api/dashboard`, `GET /api/solutions/:id`,
  `GET /api/projects?solutionId`, `GET /api/milestones?projectId`,
  `GET /api/tasks?milestoneId`, `GET /api/tasks/:id?expand=comments`,
  `PATCH /api/tasks/:id` (status/priority, optional `reason`/`reasonAuthor`),
  `POST /api/tasks/:id/comments`.

### `EventStream` - SSE consumer + liveness
- Reads `GET /api/events` via `URLSession.bytes`, parses SSE frames.
- Mirrors the web model exactly (`src/app/api/events/route.ts`,
  `src/lib/events.ts`): a `data:` frame is only a signal (`{type, at}`), not the
  entity, so on it we refetch. A named `event: ping` arrives every 5s.
- Liveness: treat a gap in pings (> ~12s) as offline rather than trusting
  connection errors (`onerror` is unreliable against a killed localhost server).
  Auto-reconnect with backoff; surface an `isOnline` flag.

### `AppStore` - observable state
- `ObservableObject` holding solutions / projects / milestones / tasks / current
  selection / dashboard rollup / scoreboard counters / `isOnline`.
- Subscribes to `EventStream`; on a change signal, refetches the visible slice
  (and the dashboard rollup). Coalesce bursts (debounce ~150ms).
- Exposes mutations (task status, priority, add comment) that call `FlowStateAPI`
  optimistically, then reconcile on the next SSE refetch.

### SwiftUI views
- `DashboardRootView` in a `NavigationSplitView`:
  - Sidebar: Solutions, expandable to their Projects (the web Explorer's first
    Miller columns).
  - Content: selected Project's Milestones with their Tasks (grouped by
    milestone), or a Solution overview.
  - Detail (inspector): selected Task - title, status, priority, labels,
    blockers, artifacts, and comments (read + add).
- `OverviewView`: totals, status breakdown, progress, attention (blocked/urgent),
  recent, straight from `DashboardPayload`.
- `ScoreboardView`: today's done counts from `dashboard.completedToday`
  (server-authoritative).
- `OfflineOverlayView`: shown when `AppStore.isOnline == false`; mirrors the web
  OfflineOverlay copy. The existing native `ReconnectOverlay` in
  `DashboardWindow.swift` covers the load-time gap; with a native client there is
  no page load, so liveness is purely `EventStream`-driven.

### `Localization` - i18n
- Bundle copies of `src/i18n/en.json` and `src/i18n/pl.json` (single source of
  truth stays the web files; a build step copies them in).
- A small `T(_ key:, _ vars:)` doing nested-key lookup + `{var}` interpolation,
  fallback locale -> en -> key. Locale default `en`, switchable (Phase 1 can read
  a stored preference; cookie parity is a Phase 2 nicety).

## AppKit glue

`DashboardWindowController.show()` builds the window once and sets its content to
`NSHostingController(rootView: DashboardRootView(...))` instead of a WKWebView.
The activation-policy dance (Dock icon on open, `.accessory` on close) and window
reuse stay as they are. The WKWebView, `ReconnectOverlay` load-time logic, and its
retry timer are removed (liveness now lives in `EventStream`).

## Data flow

1. App launches the server (unchanged), then on first dashboard open: `AppStore`
   does `GET /api/dashboard` to seed, and `EventStream` opens `/api/events`.
2. User navigates; `AppStore` lazily fetches the visible slice (projects of a
   solution, milestones of a project, tasks of a milestone, a task's detail).
3. Any change (by this user, another agent, or an MCP call) emits an SSE signal;
   `AppStore` refetches the visible slice + dashboard rollup; views update.
4. Ping gap -> `isOnline=false` -> overlay; pings resume -> refetch + hide overlay.

## Mutations and authorship

- Status/priority: `PATCH /api/tasks/:id`. A status change may carry
  `reason`/`reasonAuthor` (auto-posts a comment), used when moving to `blocked`.
- Comment: `POST /api/tasks/:id/comments` with `{body, author}`. Author defaults
  to a stable dashboard label (e.g. `"dashboard"`), matching how the web UI
  attributes human comments (keyless requests carry no actor id).

## Error handling

- REST: non-2xx -> typed error surfaced as a non-blocking banner; the optimistic
  mutation rolls back on failure.
- SSE: drop -> reconnect with backoff; ping-gap -> offline overlay; never crash
  the window on transport errors.

## Testing

- `FlowStateAPI`: decode fixtures captured from the live endpoints (dashboard,
  task detail, lists) into the Swift `Codable` models; guards drift from
  `types.ts`. Encode/round-trip the mutation bodies.
- `EventStream`: feed canned SSE byte streams (data frame, ping, gap) and assert
  signal emission + `isOnline` transitions.
- `Localization`: every key present in both en/pl; interpolation correctness.
- `AppStore`: with a stubbed API + a fake EventStream, assert that a change signal
  triggers a refetch of exactly the visible slice and updates published state.

## Scope / phasing

Phase 1 (this spec's deliverable): NavigationSplitView browse
Solution -> Project -> Milestone -> Task -> detail + comments; Overview; live SSE
refresh; offline overlay; core mutations (task status/priority, add comment);
EN+PL.

Phase 2 (later): Users/keys explorer, global search, activity feed, create/edit of
structure (solutions/projects/milestones/tasks).

Phase 3 (later): Gamification - the "+1" fly-in (pure geometry -> Core Animation),
scoreboard pop, "YOU WIN" banner. The three.js/WebGL confetti shower is descoped:
a native Metal/SpriteKit equivalent is high cost for low value; the banner +
fly-in carry the feel.

## Non-goals

- Rewriting the server, MCP, or store in Swift.
- Removing the web dashboard (it stays for browser + iOS/LAN).
- 3D confetti parity.
- Editing identity/keys from native in Phase 1 (that is the web `/users` page and
  Phase 2 here).

## Risks / open points

- Codable drift: `types.ts` is the source of truth; fixture-decode tests are the
  guard. A generator is out of scope.
- Mutation auth on a locked-down server: if a user runs the local server with
  `FS_API_KEY` set, keyless mutations are rejected. Phase 1 assumes the default
  local (no server key); a Phase 2 setting can hold a write key for that case.
- Build: keep compiling via `macos/build.sh` (no `.xcodeproj`) if the SwiftUI +
  NSHostingController setup allows; otherwise introduce a minimal SPM/Xcode build
  and document it.
