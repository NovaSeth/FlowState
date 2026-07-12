"use client";

import { ReactNode } from "react";
import { useFirstVisit } from "@/lib/route-visit";

/* Wraps server-rendered page content so it fades in ONLY on the first visit to
 * the route; a revisit renders instantly with no animation (and no loading
 * boundary, so the previous page stays until the new one is ready - no lag).
 * For client pages, call useFirstVisit() directly instead. */
export function Reveal({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const reveal = useFirstVisit();
  return <div className={`${reveal} ${className}`.trim()}>{children}</div>;
}
