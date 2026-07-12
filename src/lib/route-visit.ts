"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/* Tracks which routes have already loaded this session (module scope, so it
 * survives client navigations for the tab's lifetime). The page content
 * (useFirstVisit) reads AND marks it: it fades in gently on the FIRST visit to
 * a route and renders with no animation on every revisit. There is no route
 * loading boundary, so a revisit keeps the previous page until the new one is
 * ready (instant swap, no blank-gap lag). */

const visited = new Set<string>();

export function hasVisited(pathname: string): boolean {
  return visited.has(pathname);
}

/** Page-content hook: returns an enter-animation class on the FIRST visit to a
 *  route (and marks it visited), or "" on every revisit. Right after a source
 *  switch it returns the stronger zoom-in "settle" instead, once - so the fresh
 *  interface rushes toward the user out of the wormhole and locks in place. */
export function useFirstVisit(): string {
  const pathname = usePathname();
  const [cls] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        if (window.sessionStorage.getItem("fs.justSwitched")) {
          window.sessionStorage.removeItem("fs.justSwitched");
          return "fs-arrive";
        }
      } catch {
        /* storage unavailable - fall through to the normal reveal */
      }
    }
    return visited.has(pathname) ? "" : "fs-content-in";
  });
  useEffect(() => {
    visited.add(pathname);
  }, [pathname]);
  return cls;
}
