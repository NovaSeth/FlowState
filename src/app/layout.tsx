import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { NarrowProvider } from "@/lib/use-is-narrow";
import { LiveProvider } from "@/lib/use-live-refresh";
import { LocaleProvider } from "@/i18n/provider";
import { getServerLocale } from "@/i18n/server";
import { t } from "@/i18n";
import { isPhoneUA } from "@/lib/phone-ua";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  return {
    title: t(locale, "app.name"),
    description: t(locale, "app.description"),
  };
}

// viewport-fit=cover lets content extend into the notch / home-indicator areas;
// Shell and bars inset themselves via env(safe-area-inset-*).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// We detect a phone (not iPad/desktop) on the server from the User-Agent, so the
// mobile layout is in the SSR - it works even when iOS Safari fails to hydrate
// the page (next dev/Turbopack). iPad deliberately gets desktop (its UA is usually
// Mac). The detection regex lives in @/lib/phone-ua (single source of truth, also
// used by the settings page).

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const ua = (await headers()).get("user-agent") ?? "";
  const initialNarrow = isPhoneUA(ua);
  // Locale from the `fs_locale` cookie (defaults to 'en'), read on the server and
  // seeded into LocaleProvider - UI text is correct in SSR even without hydration (iOS).
  const locale = await getServerLocale();

  // System fonts (zero web fonts) - defined in globals.css via --sans.
  return (
    <html lang={locale} className="h-full">
      <body className="h-full">
        <LocaleProvider locale={locale}>
          <NarrowProvider initial={initialNarrow}>
            <LiveProvider>
              <Shell>{children}</Shell>
            </LiveProvider>
          </NarrowProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
