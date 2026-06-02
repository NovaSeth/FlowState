"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_LOCALE, t, type Locale } from ".";

/**
 * Client-side locale context. The initial value comes from the SERVER (the
 * `fs_locale` cookie read in layout.tsx) - exactly like NarrowProvider for
 * mobile mode - so UI text is already correct in the SSR HTML, EVEN when iOS
 * Safari fails to hydrate the page. One LocaleProvider at the top of the tree.
 */
const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** Translation hook for client components: const t = useT(). */
export function useT(): (
  key: string,
  vars?: Record<string, string | number>,
) => string {
  const locale = useContext(LocaleContext);
  return (key, vars) => t(locale, key, vars);
}
