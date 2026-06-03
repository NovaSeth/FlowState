# macOS dashboard window (thin WKWebView) - design

**Date:** 2026-06-04
**Status:** approved (full autonomy granted)

## Problem

When the Flow State server is down and the user reloads (or first opens) the
dashboard in a browser, they see Chrome's native `ERR_CONNECTION_REFUSED` page -
nothing serves the page, so the web app cannot intercept it. The in-web
`OfflineOverlay` (shipped 2026-06-03) only covers "server died while the page was
already open". The load-time case stays ugly.

The existing macOS menu-bar app already **owns the server as a child process** and
**polls its state** (`running | starting | stopped`). A thin native window hosting
the same web UI in a `WKWebView` can therefore intercept load failures and show a
branded splash instead of the browser error - closing the one gap the web overlay
cannot.

## Decisions (from brainstorming)

1. **"Open Dashboard" opens the native window** (default). A separate **"Open in
   Browser"** item keeps the browser path (DevTools, sharing the LAN URL). The
   Dock icon appears while the window is open and disappears when it closes
   (`.accessory` <-> `.regular`).
2. **Window does NOT auto-open at login.** Login still autostarts the *server* in
   the menu bar only; the window opens on demand.
3. **Splash is a native AppKit overlay** (not bundled HTML, not WKWebView's default
   error), reusing the `FlowIcon` wave for brand consistency.

## Division of labor (no duplication)

- **Native overlay** = the page cannot *load* (server not up at navigation time, or
  a hard reload against a dead server). This is the original bug.
- **Web `OfflineOverlay`** = server dies while the page is already loaded
  (mid-session), with the heartbeat watchdog + self-healing reconnect.
- Both use the same visual language (wave glyph + status dot).

## Components

### `DashboardWindowController` (new - `macos/src/DashboardWindow.swift`)
- Owns one `NSWindow` titled "Flow State" (standard window, min size ~900x600,
  frame persisted via `setFrameAutosaveName`).
- Content: `WKWebView` filling the window + a `ReconnectOverlay` `NSView` layered
  on top (hidden while the page is live).
- Loads `controller.dashboardURL`.
- `WKNavigationDelegate`:
  - `didFailProvisionalNavigation` / `didFail` -> show overlay + start a retry timer
    that reloads every ~2s until a load succeeds.
  - `didFinish` -> hide overlay, stop the retry timer.
- `serverStateChanged(_:)` - called by `AppDelegate` so that when the server flips
  to `.running` we reload immediately (snappier than waiting for the next retry
  tick). The retry timer is the self-contained backstop.

### `ReconnectOverlay` (new `NSView`, same file)
- Opaque dark background (~app canvas). Centered: large `FlowIcon` wave with a
  status dot, a title, a subtitle, and an `NSProgressIndicator` (spinner).
- Two states, driven by the server state:
  - `.starting` -> amber dot, "Starting Flow State..."
  - `.stopped` / unreachable -> red dot, "Server offline - reconnecting..."

### `FlowIcon` (refactor - `macos/src/FlowIcon.swift`)
- Extract the wave+dot drawing into a reusable core that draws into an arbitrary
  rect, so the menu-bar `image(for:)` (20x16) and the overlay's large mark share
  one implementation.

### `AppDelegate` (edit - `macos/src/AppDelegate.swift`)
- `openDashboard()` -> create/show the window (lazily), `setActivationPolicy(.regular)`,
  activate the app. (Was: open the URL in the browser.)
- New menu item **"Open in Browser"** -> the old `NSWorkspace.shared.open(url)`.
- On window close (no remaining windows) -> `setActivationPolicy(.accessory)`.
- Forward server-state changes to the window controller (`serverStateChanged`).

### Build (edit - `macos/build.sh`)
- Add `src/DashboardWindow.swift` to the `swiftc` source list.
- Add `-framework WebKit`.
- `main.swift` stays `.accessory` at launch (window-on-demand); the policy flips to
  `.regular` only when the window opens.

## Error handling / edge cases

- Server `.starting` at window open -> WKWebView load fails -> splash "Starting...",
  retries, then loads when serving. (The key win.)
- Server killed mid-session -> page stays loaded -> the *web* overlay + self-healing
  reconnect handle it; the native overlay stays hidden.
- Window closed while overlay showing -> retry timer invalidated on close.
- Crash-loop: the server controller already guards relaunch; the window just keeps
  retrying its load and shows the splash meanwhile.

## Testing

Native AppKit - no unit tests. Manual plan:
1. Server stopped -> "Open Dashboard" -> splash "Server offline", then auto-loads
   once the server is started from the menu.
2. Server running -> window loads the dashboard directly.
3. Kill the server child mid-session -> the *web* overlay appears (not the native
   one); restart -> both recover.
4. Close the window -> Dock icon disappears; menu bar + server stay.
5. "Open in Browser" -> opens `localhost:3000` in the default browser.

## Out of scope

- Phone/LAN access (unchanged - still the browser + prod build over LAN).
- Multiple windows / tabs.
- Notarization / distribution changes (still ad-hoc signed local tool).
