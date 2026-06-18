// Generates the CSS custom-property block in src/app/globals.css from the shared
// design tokens in src/design/tokens.json - the single source of truth shared
// with the native macOS app (which parses the same JSON at runtime). The block
// between the GENERATED markers is owned by this script; everything else in
// globals.css (the @theme mapping, base styles, keyframes) is hand-written.
//
// Usage:
//   node scripts/gen-tokens.mjs           regenerate the block in place
//   node scripts/gen-tokens.mjs --check   fail (exit 1) if the block is stale
//
// It runs automatically before `dev` and `build` (predev / prebuild hooks).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKENS_PATH = join(ROOT, "src/design/tokens.json");
const CSS_PATH = join(ROOT, "src/app/globals.css");

export const START_MARKER =
  "/* GENERATED FROM src/design/tokens.json by scripts/gen-tokens.mjs - do not edit by hand. */";
export const END_MARKER = "/* END generated tokens */";

/** Build the :root (light) + dark @media block from the tokens JSON. */
export function buildBlock(tokens) {
  const decl = (name, value) => `  --${name}: ${value};`;
  const light = [
    ...Object.entries(tokens.color.light).map(([k, v]) => decl(k, v)),
    ...Object.entries(tokens.shadow.light).map(([k, v]) => decl(`shadow-${k}`, v)),
    ...Object.entries(tokens.font).map(([k, v]) => decl(k, v)),
  ].join("\n");
  const dark = [
    ...Object.entries(tokens.color.dark).map(([k, v]) => `  ${decl(k, v)}`),
    ...Object.entries(tokens.shadow.dark).map(([k, v]) => `  ${decl(`shadow-${k}`, v)}`),
  ].join("\n");
  return `:root {\n${light}\n}\n\n@media (prefers-color-scheme: dark) {\n  :root {\n${dark}\n  }\n}`;
}

/** Replace the content between the markers in `css` with a fresh block. */
export function regenerate(css, block) {
  const start = css.indexOf(START_MARKER);
  const end = css.indexOf(END_MARKER);
  if (start === -1 || end === -1) {
    throw new Error("gen-tokens: START/END markers not found in globals.css");
  }
  return css.slice(0, start) + START_MARKER + "\n" + block + "\n" + END_MARKER + css.slice(end + END_MARKER.length);
}

export function currentAndExpected() {
  const tokens = JSON.parse(readFileSync(TOKENS_PATH, "utf8"));
  const css = readFileSync(CSS_PATH, "utf8");
  return { css, expected: regenerate(css, buildBlock(tokens)) };
}

function main() {
  const check = process.argv.includes("--check");
  const { css, expected } = currentAndExpected();
  if (check) {
    if (css !== expected) {
      console.error("globals.css design tokens are stale. Run: npm run gen:tokens");
      process.exit(1);
    }
    console.log("design tokens in sync");
    return;
  }
  if (css === expected) {
    console.log("design tokens already in sync");
  } else {
    writeFileSync(CSS_PATH, expected);
    console.log("regenerated globals.css design tokens from tokens.json");
  }
}

// Only run when invoked directly (not when imported by the parity test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
