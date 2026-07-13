# Flow State

A living, shared source of truth for AI-agent + human project state. Instead of
scattered markdown (TODO.md, roadmaps) that drift out of date, Flow State keeps
the *current* state of work in one place that both people and Claude Code agents
read and write live.

Use it three ways, all backed by one local server: a live **web dashboard**, a
**native macOS menu-bar app** (SwiftUI, 1:1 with the web UI), and straight from
**Claude Code** via the `fs_` MCP tools.

## Screenshots

![Flow State dashboard](docs/screenshot-dashboard.png)

<!-- Maintainer/CI: add the real screenshot at docs/screenshot-dashboard.png (the
orchestrator captures one). -->

## What it is

- **Hierarchy:** Solution > Project > Milestone > Task > Comment.
- **Live dashboard:** a server-rendered UI that updates in real time over SSE -
  every mutation (from an agent or the UI) refreshes connected views. The SSR
  HTML is correct even without hydration (important for iOS Safari).
- **MCP tools:** agents use the `fs_` MCP tools (`fs_dashboard`,
  `fs_create_task`, `fs_list_tasks`, `fs_update_task`, `fs_changes_since`,
  `fs_whoami`, `fs_mint_agent_key`, ...) to track work instead of markdown files.
- **Gamified stats:** per-day completion counters (tasks / milestones / projects
  closed today) with a full-screen celebration on project/solution completion.
- **Local-first:** data lives in a local SQLite file via `node:sqlite`
  (synchronous). No external services required.

## Get started

**Requirements:** [Node](https://nodejs.org) **24+** (the store uses `node:sqlite`,
which is stable in Node 24) and **git**. On Node 22.12-23 it still works, but you
must enable the SQLite module with a flag (see the note below).

```bash
# 1. Get the source from GitHub
git clone https://github.com/NovaSeth/FlowState.git
cd FlowState

# 2. Install dependencies
npm install

# 3. Run it (the database data/fs.db is created automatically on first run)
npm run dev                       # dev server at http://localhost:3000
```

Then open <http://localhost:3000>. Want demo data to look around? Run
`npm run seed` first.

For phones / LAN (the dev server may not hydrate on iOS Safari) serve a
production build instead:

```bash
npm run build && npm run start
```

> **On Node 22.12-23**, prefix the run commands so `node:sqlite` is enabled, e.g.
> `NODE_OPTIONS=--experimental-sqlite npm run dev` (Node 24+ needs no flag).

### Environment

All configuration is via environment variables (none are required for a local
run - the defaults give you an open localhost server):

| Variable | Default | What it does |
| --- | --- | --- |
| `FS_DB_PATH` | `data/fs.db` | Path to the SQLite database file. It is created automatically on first run (the parent directory must be writable). |
| `FS_API_KEY` | _(unset)_ | Admin / bootstrap token. When set, a request whose `x-api-key` equals it is treated as admin, and mutations then require a valid key. Also read by the MCP server and used to mint the first agent key. |
| `FS_AUTH` | _(unset)_ | Set to `strict` to require a key for every mutation (`POST`/`PATCH`/`PUT`/`DELETE`), including from the local dashboard. |
| `FS_REQUIRE_KEY` | _(unset)_ | Set to `1` (or `true`/`yes`) to force "require key" mode from the environment. EVERY client must then present a valid key on the data routes (401 otherwise), AND the management endpoints (`/api/settings`, `/api/connections`) are NOT exempt - so an anonymous visitor can neither read data nor turn the protection off. This is the setting to use for a public / hosted deployment. (There is also a revertible Settings toggle for the same "require key" mode, meant for local use; when the env var forces it, that toggle cannot switch it off.) |

The scheme a remote client uses to reach a self-hosted server is derived from the
port: port `443` is treated as `https`, anything else as plain `http` (see
`remoteBase()` in `src/lib/connections.ts`).

### MCP and skill

The MCP server lives in this repo at `mcp/fs-mcp.mjs` (server id `flow-state`,
`fs_` tools, reads `FS_API_KEY`/`FS_BASE_URL`). See
[docs/MCP.md](docs/MCP.md) for how to register it with your Claude Code client.

To make Claude Code track work in Flow State instead of markdown:

```bash
claude mcp add flow-state -s user \
  -e FS_BASE_URL=http://localhost:3000 \
  -- node /ABSOLUTE/PATH/mcp/fs-mcp.mjs
```

Install the bundled skill (teaches the agent to use the `fs_` tools):

```bash
mkdir -p ~/.claude/skills/using-flow-state
cp skills/using-flow-state/SKILL.md ~/.claude/skills/using-flow-state/
```

## macOS menu-bar app

A native (Swift / AppKit + SwiftUI) menu-bar app (`macos/`) runs the server for
you and shows the dashboard as a **native SwiftUI window** - 1:1 with the web UI,
talking to the same local REST + SSE API (no web view). It starts the server at
login, shows live status via a wave icon (green running / gray stopped / amber
transitioning), and offers Start / Stop / Restart and Open Dashboard from its menu.

```bash
macos/build.sh     # compiles macos/build/FlowState.app with swiftc (no Xcode project)
macos/install.sh   # installs the app to /Applications and the server as a launchd agent
```

`macos/install.sh` registers the server as an independent launchd LaunchAgent
(`com.flowstate.server`) that starts at login and is kept alive by launchd, then
installs the menu-bar app as a **client** of that server (it monitors and can
Start / Stop / Restart the agent, but never owns or kills it). Because the repo
lives under `~/Documents` (TCC-protected), the agent needs Full Disk Access
granted to `node` once - the installer points you at the setting.

See [macos/README.md](macos/README.md) for details.

> The macOS app is **optional**. The server is a normal Next.js app you can run on
> its own with `npm run start` (or `npm run dev`) - the menu-bar app just supervises
> that same server for you, and can attach to an already-running one with `--no-server`.

## Self-hosting (running the server on a remote host)

Flow State is a plain Next.js server, so you can run it standalone on any host or
VPS and let other people point their dashboard at it over the connections rail.

**Requirements**

- Node **22+** (24+ recommended - `node:sqlite` is flagless there; on 22.12-23
  add `NODE_OPTIONS=--experimental-sqlite`).
- A persistent, writable path for the database (`FS_DB_PATH`); back it up like any
  SQLite file.
- A port to listen on (bind it to loopback and put a reverse proxy in front).
- **A key.** Set `FS_REQUIRE_KEY=1` and a strong `FS_API_KEY` so the instance is
  token-gated and not publicly readable. Without this, anyone who can reach the
  host can read (and, with an admin key unset, write) everything. This is the one
  step you must not skip for a public host.

**Build and run**

```bash
git clone https://github.com/NovaSeth/FlowState.git
cd FlowState
npm ci
npm run build
# Bind to loopback; the reverse proxy terminates TLS and forwards to it.
FS_REQUIRE_KEY=1 FS_API_KEY='a-long-random-secret' FS_DB_PATH=/var/lib/flowstate/fs.db \
  npx next start -H 127.0.0.1 -p 3000
```

**systemd service** (`/etc/systemd/system/flowstate.service`)

```ini
[Unit]
Description=Flow State
After=network.target

[Service]
Type=simple
User=flowstate
WorkingDirectory=/opt/flowstate
Environment=NODE_ENV=production
Environment=FS_REQUIRE_KEY=1
Environment=FS_API_KEY=replace-with-a-long-random-secret
Environment=FS_DB_PATH=/var/lib/flowstate/fs.db
ExecStart=/usr/bin/npm run start -- -H 127.0.0.1 -p 3000
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Then `sudo systemctl enable --now flowstate` (adjust the `npm`/`node` path to your
install).

**Apache reverse proxy with TLS** (needs `mod_proxy`, `mod_proxy_http`, `mod_ssl`)

The live dashboard streams over Server-Sent Events on `/api/events`, so that route
must NOT be buffered - forward it with `flushpackets=on` so events reach the client
immediately.

```apache
<VirtualHost *:443>
    ServerName fs.example.com

    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/fs.example.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/fs.example.com/privkey.pem

    ProxyPreserveHost On

    # SSE: flush each event, no buffering.
    <Location /api/events>
        ProxyPass        http://127.0.0.1:3000/api/events flushpackets=on
        ProxyPassReverse http://127.0.0.1:3000/api/events
    </Location>

    # Everything else.
    ProxyPass        / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/
</VirtualHost>
```

(On nginx the equivalent is `proxy_buffering off;` on the `/api/events` location.)

A real deployment of this exists at <https://fs.monokoda.com> as an example.

**Connect to it from another machine.** In that machine's dashboard, open the left
connections rail, click `+`, and enter the domain as the host (e.g.
`fs.monokoda.com`), `443` as the port (which selects `https`), an optional name,
and paste the API key. Click the new entry to switch to it - the whole `/api`
surface of your local server then proxies to the remote instance.

## Multi-instance (connections rail)

The slim strip on the far left is the **connections rail**: it lists the data
sources this dashboard can show - `local` on top, then any remote Flow State
instances you have added (host + a reachability dot), and a `+` to add one.

- **Status dots:** green = reachable, red = down; each saved remote is pinged
  periodically so a dot flips when a server goes up or down.
- **Switching:** clicking an entry activates that source server-side (a short
  "wormhole" transition plays, then the page reloads). From then on every `/api`
  route, the SSE stream, and the server-rendered pages read from that source; the
  header shows which one is active.
- **Local stays in control:** the connections/settings management endpoints always
  run against your own server, so you can always switch back. A remote source is
  **not process-controllable** from the client - the app hides the server
  Start / Stop / Restart controls while a remote is active (you are a guest on it).

## Internationalization

The UI ships in English by default with a Polish translation. To add a language,
drop a JSON file in `src/i18n/` (mirror `en.json`, the source of truth, and
include a `language.self` key with the language's own native name) and register
it by adding one line to the `MESSAGES` registry in `src/i18n/index.ts`. The
Settings page then lists it automatically, by its native name. The active locale
is stored in the `fs_locale` cookie and seeded server-side so SSR text is correct
without hydration. Language is switched on the Settings page only.

## Security

By default the app runs in **open mode**: no API key is required, intended for a
trusted localhost / single-user setup. The dev and start servers bind all
interfaces (`0.0.0.0`), so the app is reachable on your LAN - this is
intentional so you can open the dashboard from your phone.

Auth is resolved per request (see `resolveContext` in `src/lib/http.ts`):

- **Open mode (default):** mutations are allowed without a key unless an admin
  key is set or strict mode is on. GET endpoints are **not** authenticated in
  open mode.
- **Require auth on mutations:** set an admin key via `FS_API_KEY` and/or
  `FS_AUTH=strict`. Mutations then require an `x-api-key` header. Mint per-agent
  keys (format `fsk_<prefix>.<secret>`, where the secret is shown only once at
  creation) via the `fs_mint_agent_key` MCP tool or `POST /api/keys`, and manage
  them in the `/users` UI.
- **Grants:** a key carries a list of grants chosen at creation - each grant
  targets one project (`{"projectId": ...}`), one whole solution
  (`{"solutionId": ...}`) or everything (neither id), with `read` or `write`
  rights per grant. Reads and lists are filtered to the covered places;
  mutations need a covering `write` grant. One key = one user - each
  `fs_mint_agent_key` call creates its own agent actor with its own key (there is
  no sub-key hierarchy or "parent" key); a non-admin key simply cannot grant
  access it does not itself hold. Legacy single `solutionId`+`scope` keys keep
  working as a one-grant key.
- **Require a key from everyone (public hosting):** set `FS_REQUIRE_KEY=1`. Then
  every client must present a valid key on the data routes AND the management
  endpoints are not exempt, so an anonymous visitor can neither read data nor
  disable the protection. This is the right control when the server is exposed
  beyond a trusted localhost - see [Self-hosting](#self-hosting-running-the-server-on-a-remote-host).

Because GET endpoints are unauthenticated in open mode, **do not expose the
open-mode server to untrusted networks**. For LAN or shared hosting, set an admin
key and/or `FS_AUTH=strict`; for a public / internet-facing deployment use
`FS_REQUIRE_KEY=1` with a strong `FS_API_KEY`.

## License

MIT, see [LICENSE](LICENSE).

## Notes

This runs on **stock Next.js 16** from npm (not a fork or a patched build). Next
16 is a recent major that may be newer than your tools' training data, and it
ships its own docs at `node_modules/next/dist/docs/`. Read the relevant guide
there before making framework-level changes, and heed deprecation notices (see
`AGENTS.md`).

Stack: Next.js 16, React 19, TypeScript, Tailwind v4 (`@theme` in
`src/app/globals.css`), `node:sqlite`, Vitest, ESLint (`--max-warnings 0`).
