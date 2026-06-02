"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, IconName } from "./icons";
import { useT } from "@/i18n/provider";

// UI version. Scheme vMAJOR.MINOR: MINOR grows +1 with EVERY commit
// (1.01, 1.02, ...), MAJOR jumps when we turn the concept upside down
// (-> 2.00). Bump it on every commit that touches the UI.
const UI_VERSION = "1.24";

// Main menu (sidebar). Order from the top: Overview, Explorer, Users, Settings.
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
  return (
    <nav
      aria-label={t("nav.menu")}
      className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-black/10 bg-brand pb-3 pt-[7px]"
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
      })}
      <span
        className="mt-auto select-none pt-2 font-mono text-[9px] tracking-tight text-white/70"
        title={`UI ${UI_VERSION}`}
      >
        v{UI_VERSION}
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
      className="flex shrink-0 border-t border-edge bg-canvas pb-[env(safe-area-inset-bottom)]"
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
            className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium tracking-wide transition-colors active:bg-canvas-subtle ${
              on ? "text-accent" : "text-fg-subtle"
            }`}
          >
            <Icon name={item.icon} size={22} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
