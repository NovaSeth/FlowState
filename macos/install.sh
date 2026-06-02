#!/bin/bash
# Install the Flow State menu-bar app.
#   1. build FlowState.app (repo + node paths baked in) and copy it to /Applications
#   2. launch it - the app registers itself as a login item (autostart) and
#      starts the server on launch / at login.
#
# Why no launchd agent: the repo lives under ~/Documents, which is TCC-protected.
# A launchd agent is denied access there; a user-launched .app gets the native
# "allow Documents access" prompt and works.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
REPO_DIR="$(cd .. && pwd)"
APP_SRC="build/FlowState.app"
APP_DST="/Applications/Flow State.app"

echo "==> Flow State installer"
echo "    repo: $REPO_DIR"

# Clean up any agent left by an earlier launchd-based install attempt.
launchctl bootout "gui/$(id -u)/com.flowstate.server" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/com.flowstate.server.plist"

./build.sh

echo "==> installing app to: $APP_DST"
# Quit a running copy so we can replace it.
osascript -e 'tell application "Flow State" to quit' 2>/dev/null || true
sleep 1
rm -rf "$APP_DST"
cp -R "$APP_SRC" "$APP_DST"
# Strip quarantine so Gatekeeper does not block the locally built app. This is
# safe because it targets ONLY the bundle we just compiled from this repo by
# build.sh - not a downloaded/third-party binary.
xattr -dr com.apple.quarantine "$APP_DST" 2>/dev/null || true

echo "==> launching menu-bar app"
open "$APP_DST"

cat <<DONE

==> Done.
    - A "Flow State" wave icon should appear in your menu bar.
    - The app starts the server and registers itself to launch at login.
    - Server: http://localhost:3000
    - Logs:   $HOME/Library/Logs/FlowState/server.log

    On first run macOS may ask to let "Flow State" access your Documents
    folder (the repo lives there) - click Allow, then use Restart from the
    menu if the server did not come up.

    To remove everything: macos/uninstall.sh
DONE
