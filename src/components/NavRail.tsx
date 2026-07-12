"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { UI_VERSION } from "@/lib/version";
import { Icon, IconName } from "./icons";
import { useT } from "@/i18n/provider";

// Main menu (sidebar). Order from the top: Overview, Explorer, Users; Settings
// is pinned to the bottom of the rail, right above the version marker.
// labelKey is resolved through i18n at render time (not a literal, so it stays multilingual).
const ITEMS: {
  href: string;
  icon: IconName;
  labelKey: string;
  match: (p: string) => boolean;
}[] = [
  {
    href: "/",
    icon: "home",
    labelKey: "nav.overview",
    match: (p) => p === "/",
  },
  {
    href: "/explore",
    icon: "columns",
    labelKey: "nav.explorer",
    match: (p) =>
      p.startsWith("/explore") ||
      p.startsWith("/solutions") ||
      p.startsWith("/projects"),
  },
  {
    href: "/users",
    icon: "users",
    labelKey: "nav.users",
    match: (p) => p.startsWith("/users"),
  },
  {
    href: "/settings",
    icon: "settings",
    labelKey: "nav.settings",
    match: (p) => p.startsWith("/settings"),
  },
];

export function NavRail() {
  const pathname = usePathname();
  const t = useT();
  // The version marker reflects the ACTIVE data source: the remote instance's
  // version when connected, this build's otherwise.
  const [version, setVersion] = useState(UI_VERSION);
  useEffect(() => {
    api
      .getAppSettings()
      .then((s) => setVersion(s.sourceVersion ?? UI_VERSION))
      .catch(() => {});
  }, []);

  const railItem = (item: (typeof ITEMS)[number]) => {
    const on = item.match(pathname);
    const label = t(item.labelKey);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-label={label}
        aria-current={on ? "page" : undefined}
        title={label}
        className={`flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
          on
            ? "bg-white text-brand"
            : "text-white/70 hover:bg-white/15 hover:text-white"
        }`}
      >
        <Icon name={item.icon} />
      </Link>
    );
  };

  const settings = ITEMS.find((i) => i.href === "/settings")!;
  return (
    <nav
      aria-label={t("nav.menu")}
      className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-black/10 bg-brand pb-3 pt-[7px]"
    >
      {ITEMS.filter((i) => i !== settings).map(railItem)}
      {/* Settings lives at the bottom, right above the version marker. */}
      <span className="mt-auto">{railItem(settings)}</span>
      <span
        className="select-none pt-2 font-mono text-[9px] tracking-tight text-white/70"
        title={`UI ${version}`}
      >
        v{version}
      </span>
    </nav>
  );
}

/** Mobile navigation: bottom tab-bar (native iOS pattern) instead of the left rail.
 *  Same items as NavRail; respects the safe area at the bottom (home indicator). */
export function MobileTabBar() {
  const pathname = usePathname();
  const t = useT();
  return (
    <nav
      aria-label={t("nav.menu")}
      className="flex shrink-0 border-t border-black/10 bg-brand pb-[env(safe-area-inset-bottom)]"
    >
      {ITEMS.map((item) => {
        const on = item.match(pathname);
        const label = t(item.labelKey);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-label={label}
            aria-current={on ? "page" : undefined}
            // Same palette as the desktop rail: brand bg, white icons, and a
            // white pill on the active icon (brand-colored glyph inside).
            className={`flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-medium tracking-wide transition-colors ${
              on ? "text-white" : "text-white/70 active:text-white"
            }`}
          >
            <span
              className={`flex h-8 w-10 items-center justify-center rounded-md ${
                on ? "bg-white text-brand" : ""
              }`}
            >
              <Icon name={item.icon} size={20} />
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
