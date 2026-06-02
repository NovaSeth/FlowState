import en from "./en.json";
import pl from "./pl.json";

/**
 * Lightweight, dependency-free i18n (no next-intl). en.json is the SOURCE OF
 * TRUTH - every UI string as a (possibly nested) key; pl.json is the translation
 * of those same keys. Locale is resolved via the `fs_locale` cookie (defaults to
 * 'en'); seeded from the server in layout.tsx so text is correct in SSR even
 * without hydration (important for iOS Safari).
 */

type Messages = Record<string, unknown>;

/**
 * Locale registry - the SINGLE SOURCE OF TRUTH for which languages exist.
 * To add a language: drop a `<code>.json` next to en.json (mirror its keys,
 * including `language.self` with the language's NATIVE name) and add ONE line
 * here mapping the code to the import. Everything else (the Locale type, the
 * available-locales list shown in Settings, isLocale, native names) is derived
 * from this object - there is no separate hardcoded en/pl list to keep in sync.
 *
 * A directory glob (require.context) was evaluated but does not build cleanly
 * under `next build` (Next 16) and would also break the static imports the i18n
 * parity test relies on; the explicit registry keeps `npm run build` green and
 * is still dynamic: Settings lists ALL registered locales, not a fixed en/pl.
 */
export const MESSAGES = {
  en,
  pl,
} satisfies Record<string, Messages>;

export type Locale = keyof typeof MESSAGES;

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_COOKIE = "fs_locale";

/** All registered locale codes (derived from the registry, never hardcoded). */
export const AVAILABLE_LOCALES = Object.keys(MESSAGES) as Locale[];

/**
 * Locales for the Settings picker: each with its own NATIVE display name, taken
 * from that locale's `language.self` key (so a new locale self-describes and
 * needs no central edit). Falls back to the code if the key is missing.
 */
export const availableLocales: { code: Locale; name: string }[] =
  AVAILABLE_LOCALES.map((code) => ({
    code,
    name: lookup(MESSAGES[code], "language.self") ?? code,
  }));

export function isLocale(value: string | undefined | null): value is Locale {
  return value != null && Object.prototype.hasOwnProperty.call(MESSAGES, value);
}

/** Reads a nested key by dot-path (e.g. "task.status"). */
function lookup(messages: Messages, key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (node && typeof node === "object" && part in (node as object)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === "string" ? node : undefined;
}

/** Substitutes {var} variables in a string. */
function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/**
 * Translation: looks up the key in the given locale, then in en (fallback), and
 * finally returns the key itself when it is found nowhere. Supports dot-path and {var}.
 */
export function t(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const value =
    lookup(MESSAGES[locale] ?? {}, key) ??
    lookup(MESSAGES[DEFAULT_LOCALE], key) ??
    key;
  return interpolate(value, vars);
}
