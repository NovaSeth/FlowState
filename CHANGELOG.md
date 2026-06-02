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
