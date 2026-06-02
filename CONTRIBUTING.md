# Contributing to Flow State

Thanks for your interest in contributing. This guide covers getting a clean
clone running and the conventions we follow.

## Prerequisites

- **Node.js >= 22.5.0.** Flow State stores its data in a local SQLite file via
  `node:sqlite` (`DatabaseSync`), which is only available from Node 22.5. CI
  runs on Node 24.x.
- **npm** (the repo ships a `package-lock.json`).

## Getting started

```bash
npm ci              # install exact, locked dependencies
npm run dev         # development server on http://localhost:3000
npm run seed        # load demo data into the SQLite database (optional)
```

On first run the SQLite database and its schema are created automatically (the
schema and migrations apply on connect), so there is no separate init or migrate
step. The database is not committed (`data/` is gitignored).

`npm run seed` is idempotent: it resets every table before inserting, so you can
re-run it freely. It writes to the same database as the app (`FS_DB_PATH`, or
`data/fs.db` by default).

Copy `.env.example` to `.env.local` if you want to set any environment variables
(see [.env.example](.env.example)). `.env*` files are gitignored.

## Quality gates

Run all of these before opening a pull request:

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint --max-warnings 0
npm run test        # vitest run
npm run build       # next build
```

ESLint runs with `--max-warnings 0`, so warnings fail the check. CI runs
`typecheck`, `lint`, and `test` on every push to `main` and on pull requests;
`build` is not run in CI, so verify it locally.

A Prettier setup is also available (`npm run format` to write, `npm run
format:check` to verify).

## Monorepo layout

This repository contains several apps that share one SQLite-backed data model:

- **`src/`** - the Next.js 16 dashboard (server-rendered UI with live SSE
  updates, REST API under `src/app/api/`).
- **`mcp/`** - the MCP server (`mcp/fs-mcp.mjs`, server id `flow-state`, `fs_*`
  tools) that lets Claude Code agents read and write project state.
- **`macos/`** - the macOS menu-bar app (Swift) that runs the server and shows
  status in the menu bar. It has its own `README`, `build.sh`, `install.sh`, and
  `uninstall.sh`.
- **`scripts/`** - utility scripts (e.g. `seed.ts`).
- **`examples/`** - copy-paste scripts showing how an external agent drives the
  REST API.

**The macOS app and the MCP server are not covered by CI.** Their tests
(`mcp/fs-mcp.test.mjs`) and the Swift build are not run automatically; verify
changes to them locally.

## Branches and pull requests

- Branch off `main`; do not push directly to `main`.
- Use short, descriptive branch names (e.g. `fix/sse-reconnect`,
  `feat/task-labels`).
- Keep pull requests focused. Make sure the quality gates above pass before
  requesting review.
- Write everything (code, comments, commit messages, docs) in English.

## Conventions

- TypeScript runs in strict mode. Tailwind v4 theme tokens live in
  `src/app/globals.css` (`@theme`).
- The UI ships in English by default with a Polish translation; the English
  `src/i18n/en.json` is the source of truth (see the README for how to add a
  language).
- Read the bundled Next.js docs at `node_modules/next/dist/docs/` before making
  framework-level changes (see `AGENTS.md`).
