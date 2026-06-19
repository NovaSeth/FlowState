#!/bin/bash
# Remove the Flow State menu-bar app + autostart (leaves data/ and logs intact).
set -euo pipefail

UID_NUM="$(id -u)"
APP_DST="/Applications/Flow State.app"

# The server port is configurable and baked into the bundle's Info.plist (FSPort)
# by build.sh. Read it from the installed app so we sweep the right port; fall
# back to 3000 if the app is gone or the key is missing.
PORT="$(defaults read "$APP_DST/Contents/Info" FSPort 2>/dev/null || echo 3000)"
case "$PORT" in (''|*[!0-9]*) PORT=3000 ;; esac

echo "==> quitting the menu-bar client app"
osascript -e 'tell application "Flow State" to quit' 2>/dev/null || true
sleep 1
pkill -f "Flow State.app/Contents/MacOS/FlowState" 2>/dev/null || true

echo "==> unregistering app login item"
launchctl bootout "gui/${UID_NUM}/com.flowstate.menubar" 2>/dev/null || true

echo "==> stopping + removing the server LaunchAgent"
launchctl bootout "gui/${UID_NUM}/com.flowstate.server" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/com.flowstate.server.plist"

echo "==> killing any server still on port $PORT"
lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null | xargs kill -9 2>/dev/null || true

echo "==> removing app"
rm -rf "$APP_DST"

cat <<DONE
==> Done. Removed the menu-bar app and autostart.
    Your data (data/fs.db) and logs (~/Library/Logs/FlowState) were left intact.
    If "Flow State" still shows under System Settings > General > Login Items,
    remove it there (a leftover registration entry).
DONE
