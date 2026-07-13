#!/bin/bash
# Compile the Flow State menu-bar app into macos/build/FlowState.app using swiftc.
# No Xcode project required.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

APP="build/FlowState.app"
MACOS_DIR="$APP/Contents/MacOS"
RES_DIR="$APP/Contents/Resources"
BIN="$MACOS_DIR/FlowState"

# UI version, shared scheme with the web (vMAJOR.MINOR, +1 MINOR per UI commit;
# kept in lockstep with UI_VERSION in src/components/NavRail.tsx). The native rail
# shows this via CFBundleShortVersionString.
VERSION="1.78"
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
    <key>CFBundleIconFile</key>        <string>AppIcon</string>
    <key>CFBundlePackageType</key>     <string>APPL</string>
    <key>CFBundleShortVersionString</key> <string>${VERSION}</string>
    <key>CFBundleVersion</key>         <string>${VERSION}</string>
    <key>LSMinimumSystemVersion</key>  <string>${MIN_MACOS}</string>
    <!-- No LSUIElement: main.swift sets .accessory at launch (menu-bar only), but
         WITHOUT the static agent flag the app becomes a full, normal app when the
         dashboard window opens (reliable menu bar + Cmd+Q). LSUIElement=true would
         keep it a half-agent and break Cmd+Q / make it feel unlike other apps. -->
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

echo "[build] compiling Swift sources (${ARCH}, macOS ${MIN_MACOS}+, Swift 6 mode)"
# -swift-version 6: build the shipping binary under the SAME strict actor-isolation
# / Sendable checking as the unit-tested FlowStateKit package (swift-tools-version
# 6.0), so concurrency mistakes are compile-time errors here too, not silent races.
swiftc \
    -O \
    -swift-version 6 \
    -target "${ARCH}-apple-macos${MIN_MACOS}" \
    -framework AppKit \
    -framework ServiceManagement \
    -framework Network \
    -framework WebKit \
    -framework SwiftUI \
    -o "$BIN" \
    src/*.swift Sources/FlowStateKit/*.swift

chmod +x "$BIN"

echo "[build] copying shared resources (i18n + design tokens)"
cp ../src/i18n/en.json ../src/i18n/pl.json "$RES_DIR/"
cp ../src/design/tokens.json "$RES_DIR/"

echo "[build] generating app icon (AppIcon.icns) from the Flow wave"
ICONSET="$(mktemp -d)/AppIcon.iconset"
"$BIN" --export-iconset "$ICONSET"
if command -v iconutil >/dev/null 2>&1 && [ -f "$ICONSET/icon_512x512.png" ]; then
    iconutil -c icns -o "$RES_DIR/AppIcon.icns" "$ICONSET"
    echo "[build] wrote $RES_DIR/AppIcon.icns"
else
    echo "[build] (icon generation skipped - iconutil missing or export failed)"
fi
rm -rf "$(dirname "$ICONSET")"

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
