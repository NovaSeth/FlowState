// Single source of truth for phone (not iPad/desktop) detection from a User-Agent.
// Used by the SSR layout (to render the mobile layout before/without hydration on
// iOS Safari) and by the settings page (to display the actual mode). iPad
// deliberately is NOT matched: its UA is usually Mac, so it gets the desktop layout.
//
// The original two greedy `.*` segments are tightened to lazy quantifiers to reduce
// catastrophic backtracking while matching the exact same set of UAs (`.*?` and `.*`
// accept identical strings; only the matching effort differs):
//  - `android.*?mobile`         (was `android.*mobile`)
//  - `mobile safari\/.*?; .*?android` (was `mobile safari\/.*; .*android`)
// The `.` here does not match newlines (no `s` flag), exactly as before.
export const PHONE_UA =
  /iphone|ipod|android.*?mobile|windows phone|mobile safari\/.*?; .*?android/i;

/** True when the User-Agent looks like a phone (not iPad/desktop). */
export function isPhoneUA(ua: string): boolean {
  return PHONE_UA.test(ua);
}
