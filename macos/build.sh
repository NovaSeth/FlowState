#!/bin/bash
# Compile the Flow State menu-bar app into macos/build/FlowState.app using swiftc.
# No Xcode project required.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

APP="build/FlowState.app"
MACOS_DIR="$APP/Contents/MacOS"
RES_DIR="$APP/Contents/Resources"
BIN="$MACOS_DIR/FlowState"

VERSION="0.1.0"
ARCH="$(uname -m)"          # arm64 or x86_64
MIN_MACOS="13.0"

# Bake the repo + node locations into the bundle so the app can launch the
# server. The repo is the parent of this macos/ dir.
REPO_DIR="$(cd .. && pwd)"
NODE_BIN="$(dirname "$(command -v node || echo /opt/homebrew/bin/node)")"
PORT="3000"

echo "[build] cleaning previous bundle"
rm -rf "$APP"
mkdir -p "$MACOS_DIR" "$RES_DIR"

echo "[build] writing Info.plist"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>            <string>Flow State</string>
    <key>CFBundleDisplayName</key>     <string>Flow State</string>
    <key>CFBundleIdentifier</key>      <string>com.flowstate.menubar</string>
    <key>CFBundleExecutable</key>      <string>FlowState</string>
    <key>CFBundlePackageType</key>     <string>APPL</string>
    <key>CFBundleShortVersionString</key> <string>${VERSION}</string>
    <key>CFBundleVersion</key>         <string>${VERSION}</string>
    <key>LSMinimumSystemVersion</key>  <string>${MIN_MACOS}</string>
    <key>LSUIElement</key>             <true/>
    <key>NSHighResolutionCapable</key> <true/>
    <key>NSAppTransportSecurity</key>
    <dict>
        <key>NSAllowsLocalNetworking</key> <true/>
    </dict>
    <key>FSRepoDir</key>  <string>${REPO_DIR}</string>
    <key>FSNodeBin</key>  <string>${NODE_BIN}</string>
    <key>FSPort</key>     <string>${PORT}</string>
</dict>
</plist>
PLIST

echo "[build] compiling Swift sources (${ARCH}, macOS ${MIN_MACOS}+)"
swiftc \
    -O \
    -target "${ARCH}-apple-macos${MIN_MACOS}" \
    -framework AppKit \
    -framework ServiceManagement \
    -framework Network \
    -o "$BIN" \
    src/main.swift src/AppDelegate.swift src/ServerController.swift src/FlowIcon.swift src/ControlServer.swift

chmod +x "$BIN"

# Ad-hoc sign so the bundle has a stable identity (needed for SMAppService /
# login-item registration). Harmless if codesign is unavailable.
# Note: --deep is deprecated (Apple guidance: sign nested code separately). This
# bundle has no nested code, so a plain sign of the bundle is correct.
if command -v codesign >/dev/null 2>&1; then
    echo "[build] ad-hoc code signing"
    codesign --force --sign - "$APP" >/dev/null 2>&1 || \
        echo "[build] (codesign skipped/failed - app still runs locally)"
fi

echo "[build] done -> $APP"
