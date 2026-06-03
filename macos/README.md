# Flow State - macOS menu-bar app + autostart

A tiny native (Swift / AppKit) menu-bar app that runs the Flow State server for
you: it starts the server at login, shows live status, and lets you Start / Stop /
Restart it from a menu.

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

- **Open Dashboard** - opens the dashboard in a native window (a thin `WKWebView`
  hosting the web UI). The window shows a branded "Starting / Server offline" splash
  if the server is not serving yet, then loads automatically once it is up - so you
  never see the browser's `ERR_CONNECTION_REFUSED`. The Dock icon (the Flow wave)
  appears while the window is open and goes away when you close it.
- **Open in Browser** - opens http://localhost:3000 in your default browser (handy
  for DevTools or sharing the LAN URL). Enabled only while the server is serving.
- **Start / Stop / Restart** - control the server (enabled per current state)
- **View Logs** - opens `~/Library/Logs/FlowState/server.log`
- **Open at Login** - toggle autostart (the app's login-item registration)
- **Quit Flow State (stops server)** - quits the app and stops the server

> Tip: launch with `--open-dashboard` (e.g. a Spotlight/Dock launcher) to open
> straight to the dashboard window. A normal login launch stays menu-bar only.

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
| `src/AppDelegate.swift` | status item, menu, polling, transitions, login item |
| `src/ServerController.swift` | spawns/stops the server child, HTTP probe |
| `src/DashboardWindow.swift` | native WKWebView window + "reconnect" splash |
| `src/FlowIcon.swift` | the programmatic "Flow" wave (menu-bar icon + splash mark) |
| `src/IconExport.swift` | build-time app-icon (`.icns`) generator from the wave |
| `build.sh` | compiles `FlowState.app` with `swiftc` (no Xcode project) |
| `install.sh` / `uninstall.sh` | install / remove app + autostart |

## Notes

- The app is **ad-hoc signed** (local single-user tool, not notarized). If
  Gatekeeper blocks it, `install.sh` strips the quarantine attribute; you can also
  right-click the app in `/Applications` and choose **Open** once.
- Rebuilding (re-running `install.sh`) changes the ad-hoc signature, which can ask
  macOS to re-confirm the login item / Documents access. That is expected.
