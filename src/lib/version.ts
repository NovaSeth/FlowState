// UI version. Scheme vMAJOR.MINOR: MINOR grows +1 per shipped feature (a
// single-feature commit bumps by 1; a batch commit bumps by the number of
// features it lands), MAJOR jumps when we turn the concept upside down
// (-> 2.00). Bump it on every commit that touches the UI.
// Shared with the native macOS app (CFBundleShortVersionString in
// macos/build.sh) and exposed via /api/settings so a dashboard connected to a
// REMOTE instance can show the version of the source it is actually reading.
export const UI_VERSION = "1.79";
