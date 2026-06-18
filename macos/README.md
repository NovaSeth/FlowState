# Flow State - macOS menu-bar app + autostart

A native (Swift / AppKit + SwiftUI) menu-bar app that runs the Flow State server
for you and shows a **native dashboard**: it starts the server at login, shows live
status, lets you Start / Stop / Restart it from a menu, and opens the full dashboard
as native SwiftUI (not a web view).

![menu bar icon](../docs/superpowers/specs/.assets/menubar-icon.png)

## Install

```bash
macos/install.sh
```

This compiles `FlowState.app`, copies it to `/Applications`, and launches it. The
app then:

- registers itself as a **login item** (so it - and the server - come back after
  you log in / reboot), and
- starts the server (`npm run start`) on launch.

Look for the **wave icon** in your menu bar. A small dot shows the state:

- green - running
- gray - stopped
- amber - starting / stopping

## Menu

- **Open Dashboard** - opens the dashboard in a **native SwiftUI window** (not a
  web view): the same UI as the web dashboard, rendered natively from the live REST
  + SSE API via `FlowStateKit`. A native offline overlay shows while the server is
  unreachable and clears automatically once it is back. The Dock icon (the Flow
  wave) appears while the window is open and goes away when you close it; reopening
  it preserves the view you were on (state lives in the app, nothing reloads).
- **Open in Browser** - opens http://localhost:3000 in your default browser (handy
  for DevTools or sharing the LAN URL). Enabled only while the server is serving.
- **Start / Stop / Restart** - control the server (enabled per current state)
- **View Logs** - opens `~/Library/Logs/FlowState/server.log`
- **Open at Login** - toggle autostart (the app's login-item registration)
- **Quit Flow State (stops server)** - quits the app and stops the server (also
  Cmd+Q from the "Flow State" app menu in the menu bar when the window is focused)

> Tip: launch with `--open-dashboard` to open straight to the dashboard window (a
> normal login launch stays menu-bar only). Add `--section overview|explore|users|settings`
> to deep-link to a section.

## Native dashboard

The dashboard is native SwiftUI hosted in the window via `NSHostingController` - no
web view. It talks to the same local server the web UI uses (REST + SSE), so agents,
the web dashboard and the native app all share one source of truth.

- **`FlowStateKit`** (SPM, unit-tested) is the pure core: Codable models mirroring
  `src/lib/types.ts`, the REST client, the SSE consumer with ping-based liveness,
  and the nested-key i18n.
- The **design system is shared with the web**: `src/design/tokens.json` is the
  single source of truth for colors (light/dark) and status/priority semantics. The
  web generates its CSS variables from it (`scripts/gen-tokens.mjs`); the native app
  copies the same JSON into its bundle and parses it at runtime, so the two never drift.
- The UI version (shown bottom of the rail) follows the web scheme `vMAJOR.MINOR`,
  bumped on every UI commit - kept in lockstep with the web (`CFBundleShortVersionString`
  in `build.sh` and `UI_VERSION` in `src/components/NavRail.tsx`).
- Screens mirror the web 1:1: Overview (stats, daily chart, attention/recent feeds,
  solutions), Explorer (collapsible Miller columns + kanban/list + task detail with
  status/priority/comment editing), Users (actors/keys/activity, read-only), Settings.

## Uninstall

```bash
macos/uninstall.sh
```

Removes the app and the login item. Your data (`data/fs.db`) and logs are left
intact.

## How it works (and why no launchd agent)

The obvious approach - a launchd user agent that runs the server at login - does
**not** work here, because the repo lives under `~/Documents`, which is
TCC-protected. launchd-spawned processes are denied access to `~/Documents`
(`Operation not permitted`) unless you grant Full Disk Access to `node` (broad and
fragile).

A user-launched `.app` runs in the GUI (Aqua) session and gets the normal
Documents access a foreground app has, so the menu-bar app **owns the server as a
child process** instead. It is still a login item, so autostart at login is
preserved.

Repo path, node bin and port are baked into the app's `Info.plist` at build time
(`FSRepoDir`, `FSNodeBin`, `FSPort`). If you move the repo, just re-run
`install.sh`.

## Files

| File | Purpose |
| --- | --- |
| `src/main.swift` | NSApplication bootstrap (accessory / no Dock icon) |
| `src/AppDelegate.swift` | status item, menu, NSMainMenu (Cmd+Q), polling, login item |
| `src/ServerController.swift` | spawns/stops the server child, HTTP probe |
| `src/DashboardWindow.swift` | native window hosting the SwiftUI dashboard (`NSHostingController`) |
| `src/AppStore.swift` | observable state: drill selection, live SSE refetch, mutations, locale |
| `src/DashboardRootView.swift` + `src/*View.swift` | SwiftUI screens (Overview, Explorer, Users, Settings, task detail) |
| `src/Primitives.swift` / `src/DesignTokens.swift` | shared UI primitives + design tokens (`../src/design/tokens.json`) |
| `Sources/FlowStateKit/*` | testable core: Codable models, REST client, SSE, i18n (XCTest) |
| `src/FlowIcon.swift` | the programmatic "Flow" wave (menu-bar icon + app icon) |
| `src/IconExport.swift` | build-time app-icon (`.icns`) generator from the wave |
| `build.sh` | compiles `FlowState.app` with `swiftc` (no Xcode project) |
| `install.sh` / `uninstall.sh` | install / remove app + autostart |

## Notes

- The app is **ad-hoc signed** (local single-user tool, not notarized). If
  Gatekeeper blocks it, `install.sh` strips the quarantine attribute; you can also
  right-click the app in `/Applications` and choose **Open** once.
- Rebuilding (re-running `install.sh`) changes the ad-hoc signature, which can ask
  macOS to re-confirm the login item / Documents access. That is expected.
