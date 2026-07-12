# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Note: the npm package `version` (semver, below) tracks the project as a whole.
The in-app nav-rail `UI_VERSION` marker (currently shown as `vMAJOR.MINOR`) is a
separate per-commit UI build counter and is intentionally independent of this version.

## [Unreleased]

### Changed

- Repository-wide cleanup to prepare the codebase for a public open-source release:
  all in-code comments and developer/API-facing strings translated from Polish to
  English (the UI stays bilingual via the `src/i18n` layer).
- Corrected documentation: described the stack as stock Next.js 16 (not a fork),
  while keeping the guidance to read the bundled Next docs before framework changes.

### Added

- **Multi-instance data sources.** Flow State stays local by default but can
  now connect to other Flow State instances: a new white connections rail on
  the far left (the visual inverse of the blue nav rail) lists `local`, every
  saved remote server (initials + host) and a `+` to add one (name, host,
  port, API key). Clicking an entry switches the ACTIVE source on the server:
  the whole `/api` surface becomes a transparent proxy to the remote instance
  (with its stored key), SSE is piped through, and the server-rendered pages
  read over REST - so the web dashboard, the native macOS app and MCP agents
  all see the remote data without any client-side changes. A remote target is
  health-checked before the switch. A `local`/name badge next to the Flow
  State brand shows the active source (web + macOS), and while remote is
  active the server start/stop controls are hidden - a remote instance is not
  ours to control.
- The version marker in the nav rail and the Settings screen now reflect the
  ACTIVE data source: Settings splits into an **Application** section (this
  client's build, view mode, browser key, language) and a **Server (data
  source)** section (source, its version via `/api/settings`, admin key, DB,
  require-key, server controls) - web + macOS.
- **Require API key** switch in Settings (web + macOS): when on, the trusted
  keyless heuristics stop being enough on data routes - every client must
  present a key. The settings/connections endpoints stay reachable keyless so
  the mode can always be turned off (no lockout), and the web Settings gained
  a "this browser's key" field (localStorage) so the dashboard keeps working
  in that mode.
- API keys can be revealed in the Users panel: a **Token / Show** row in the
  key details (web + macOS) returns the full `fsk_...` token. Backed by a new
  plaintext `secret` column (an explicit decision for this local single-user
  tool - authentication still verifies only the sha-256 hash) and
  `GET /api/keys/:id/secret` guarded by the same authorization circle as
  revoke. Keys created before this change report as unavailable.
- The agent/human tag in the Users actor list moved from the left of the name
  to the line under it, next to the key count (web + macOS).
- The Explorer's project kebab menu gained an **Open dashboard** item that opens
  the project dashboard as a right-edge inspector panel (like the task detail
  panel, a third wider): title + status + progress, a KPI row of mini stat
  tiles (milestones, tasks, done-%, in progress, blocked, done), description,
  and stacked milestone cards. On the web the panel links to the full
  `/projects/[id]` page; the native macOS app shows the same panel on the
  Explorer's trailing edge.
- Overview solution blocks can be collapsed to a single header row; the choice
  persists (web localStorage / macOS UserDefaults), so the next visit keeps it.
- The daily status chart shows a hover tooltip: a vertical guide snaps to the
  nearest day and a card lists every status' transition count for that day
  (web + macOS).
- The KPI stat tiles show a day-over-day trend marker (green/red triangle with
  the relative % change, one decimal below 10%; flat days show nothing),
  comparing against yesterday's closing figures. The dashboard API payload
  gained `totalsPrev` (counts + done-% as of the start of today, approximated
  from `createdAt` / `completedAt`).

### Removed

- The **Dashboard | Columns** view toggle (web `/projects/[id]` and the macOS
  Explorer's project region). The Explorer is the one Miller-cascade way to
  browse a project; the dashboard is reachable from the project kebab as an
  inspector panel, and the web project page is dashboard-only.
- The solution color picker in the edit dialog (web + macOS). Solution icon
  colors are now derived deterministically from the solution id (same hash +
  palette on both platforms), so every solution gets a distinct hue with no
  manual upkeep.

### Changed

- The Settings icon moved to the bottom of the navigation rail, right above the
  UI version marker (web + macOS).
- The single-project page (`/projects/[id]`) gained a **Dashboard | Columns**
  view toggle. "Columns" is the Explorer's Miller cascade scoped to the project
  (Milestones → Tasks → detail), reusing the shared column primitives and the
  inline create forms (new milestone / new task pinned at the bottom of each
  column). The existing dashboard layout (milestone cards + status board) stays
  the default. The native macOS app already offers this via its Explorer.
- Kanban task cards now show a short, two-line task description under the title
  (clamped to two lines, cut mid-word if needed), on both the web dashboard and
  the native macOS app. Cards without a description render the title alone.
- Standard community files: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
  issue/PR templates, `.env.example`, and this changelog.
- Prettier tooling (`format` / `format:check` scripts) and an `.nvmrc`.
- CI now runs `next build` across a Node version matrix.

### Fixed

- The daily chart no longer stretches its axis labels into an unreadable smear
  on wide windows: the SVG viewBox now tracks the real container width
  (ResizeObserver), so text renders 1:1 instead of `preserveAspectRatio="none"`
  distorting it.
- Security and correctness hardening from a multi-agent audit (see project history).

### Removed

- A private workspace-import script that contained personal/local data.
- Unused create-next-app starter assets.

## [1.0.0]

- First public version of Flow State: a local-first, live source of truth for
  AI-agent and human project state, with a Next.js dashboard, an MCP server
  exposing `fs_*` tools, and a macOS menu-bar companion app.
