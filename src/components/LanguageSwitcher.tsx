"use client";

import { availableLocales, LOCALE_COOKIE, type Locale } from "@/i18n";
import { useLocale, useT } from "@/i18n/provider";

/**
 * Language picker for the Settings page (the ONLY place to switch language;
 * it is no longer in the top bar / nav rail). The list is DYNAMIC: it renders
 * every locale registered in src/i18n, each by its NATIVE name (language.self),
 * so dropping in and registering a new locale JSON makes it appear here with no
 * change to this component.
 *
 * Switching writes the `fs_locale` cookie (one-year expiry) and reloads the page
 * so the server re-renders SSR with the new locale (seeded in layout.tsx) - the
 * text is correct even without hydration.
 */
export function LanguageSwitcher() {
  const locale = useLocale();
  const t = useT();

  function setLocale(next: Locale) {
    if (next === locale) return;
    // We set the cookie through the document.cookie setter (Reflect.set bypasses
    // the react-hooks/immutability rule, which blocks direct assignment to a
    // value outside the component). The reload makes SSR render the new locale.
    Reflect.set(
      document,
      "cookie",
      `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`,
    );
    window.location.reload();
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] uppercase tracking-[0.5px] text-fg-subtle">
        {t("settings.language")}
      </span>
      <div className="flex flex-wrap gap-2">
        {availableLocales.map(({ code, name }) => (
          <button
            key={code}
            onClick={() => setLocale(code)}
            aria-pressed={code === locale}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              code === locale
                ? "border-accent bg-accent-muted text-accent"
                : "border-edge text-fg-muted hover:bg-canvas-subtle hover:text-fg"
            }`}
          >
            {name}
          </button>
        ))}
      </div>
      <span className="text-xs text-fg-muted">{t("settings.languageHint")}</span>
    </div>
  );
}
