import { cookies } from "next/headers";
import { DEFAULT_LOCALE, isLocale, t, LOCALE_COOKIE, type Locale } from ".";

/**
 * Reads the locale on the server from the `fs_locale` cookie (App Router:
 * cookies() is async in this version of Next). Used in layout.tsx to seed
 * LocaleProvider and in server components via serverT().
 */
export async function getServerLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** Translator for SERVER components: const tr = await serverT(); tr("nav.overview"). */
export async function serverT(): Promise<
  (key: string, vars?: Record<string, string | number>) => string
> {
  const locale = await getServerLocale();
  return (key, vars) => t(locale, key, vars);
}
