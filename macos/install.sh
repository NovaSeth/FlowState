#!/bin/bash
# Install Flow State:
#   1. the SERVER as an independent launchd LaunchAgent (com.flowstate.server) that
#      starts at login, is kept alive by launchd, and is NOT tied to any app.
#   2. the menu-bar / dashboard app as a CLIENT of that server (it monitors and can
#      start/stop/restart the agent, but never owns or kills the server).
#
# Because the repo lives under ~/Documents (TCC-protected), the launchd agent needs
# Full Disk Access granted to `node` once - this script points you at the setting.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
REPO_DIR="$(cd .. && pwd)"
NODE_BIN="$(dirname "$(command -v node || echo /opt/homebrew/bin/node)")"
PORT="3000"
APP_SRC="build/FlowState.app"
APP_DST="/Applications/Flow State.app"

AGENT_LABEL="com.flowstate.server"
AGENT_PLIST="$HOME/Library/LaunchAgents/$AGENT_LABEL.plist"
LOG_DIR="$HOME/Library/Logs/FlowState"
GUI="gui/$(id -u)"

echo "==> Flow State installer"
echo "    repo:    $REPO_DIR"
echo "    node:    $NODE_BIN"

# --- 1. the independent server LaunchAgent ---------------------------------
echo "==> installing server LaunchAgent ($AGENT_LABEL)"
mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"

# Stop/replace any previous agent (and any app-owned server from the old design).
launchctl bootout "$GUI/$AGENT_LABEL" 2>/dev/null || true
osascript -e 'tell application "Flow State" to quit' 2>/dev/null || true
lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | xargs kill -9 2>/dev/null || true

cat > "$AGENT_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>            <string>$AGENT_LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-lc</string>
        <string>cd '$REPO_DIR' &amp;&amp; export PATH='$NODE_BIN':"\$PATH" &amp;&amp; export PORT=$PORT &amp;&amp; exec npm run start</string>
    </array>
    <key>RunAtLoad</key>         <true/>
    <key>KeepAlive</key>         <true/>
    <key>ProcessType</key>       <string>Background</string>
    <key>ThrottleInterval</key>  <integer>10</integer>
    <key>StandardOutPath</key>   <string>$LOG_DIR/server.log</string>
    <key>StandardErrorPath</key> <string>$LOG_DIR/server.log</string>
</dict>
</plist>
PLIST

echo "==> loading the agent"
launchctl bootstrap "$GUI" "$AGENT_PLIST" 2>/dev/null || launchctl load -w "$AGENT_PLIST" 2>/dev/null || true
launchctl enable "$GUI/$AGENT_LABEL" 2>/dev/null || true
launchctl kickstart "$GUI/$AGENT_LABEL" 2>/dev/null || true

# --- 2. the client app -----------------------------------------------------
echo "==> building + installing the client app"
./build.sh
rm -rf "$APP_DST"
cp -R "$APP_SRC" "$APP_DST"
# Strip quarantine so Gatekeeper does not block the locally built app (ours only).
xattr -dr com.apple.quarantine "$APP_DST" 2>/dev/null || true
open "$APP_DST"

# --- 3. Full Disk Access guidance ------------------------------------------
NODE_REAL="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$(command -v node)" 2>/dev/null || command -v node)"

cat <<DONE

==> Done.
    - SERVER: runs as the launchd agent "$AGENT_LABEL" (starts at login, kept
      alive by launchd, independent of the app). Serves http://localhost:$PORT
    - APP:    "Flow State" menu-bar client - a wave icon shows server status; the
      menu can Start / Stop / Restart the agent and open the dashboard. Quitting
      the app does NOT stop the server.
    - Logs:   $LOG_DIR/server.log

  >>> ONE-TIME SETUP: grant Full Disk Access to node <<<
      The server reads the repo under ~/Documents, which a launchd agent cannot
      access until you allow it. Add node to Full Disk Access:
        1. System Settings > Privacy & Security > Full Disk Access
        2. Click +, press Cmd+Shift+G, paste this path, then enable it:
             $NODE_REAL
        3. Then run:  launchctl kickstart -k $GUI/$AGENT_LABEL

      (Opening that settings pane for you now.)

    To remove everything: macos/uninstall.sh
DONE

open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" 2>/dev/null || true
