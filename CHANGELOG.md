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
- The KPI stat tiles show a day-over-day trend arrow (up / down / dash) next to
  each value, comparing against yesterday's closing figures. The dashboard API
  payload gained `totalsPrev` (counts + done-% as of the start of today,
  approximated from `createdAt` / `completedAt`).

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

- Security and correctness hardening from a multi-agent audit (see project history).

### Removed

- A private workspace-import script that contained personal/local data.
- Unused create-next-app starter assets.

## [1.0.0]

- First public version of Flow State: a local-first, live source of truth for
  AI-agent and human project state, with a Next.js dashboard, an MCP server
  exposing `fs_*` tools, and a macOS menu-bar companion app.
