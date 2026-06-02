"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/**
 * Whether we use the mobile layout (drill-down / bottom tab-bar / bottom-sheet).
 *
 * KEY POINT: the initial value comes from the SERVER (based on the User-Agent in
 * layout.tsx), so a phone gets the mobile layout already in SSR - it works EVEN if
 * hydration never kicks in. This matters because iOS Safari on `next dev` (Turbopack)
 * can fail to hydrate the page; if the decision were made only in useEffect (as
 * before), the phone would get stuck on the default desktop layout.
 *
 * After mount (when hydration does work) the value is tuned by the real signal:
 * a wide/narrow viewport OR a touch device. We do not rely on the media query alone,
 * because iOS in "Request Desktop Website" mode reports a wide viewport and pretends
 * to be a desktop (hover/pointer) - the only unfalsified signal is touch
 * (navigator.maxTouchPoints / ontouchstart).
 *
 * Shared by Shell, Explorer and TaskPanel - one NarrowProvider at the top of the
 * tree, so they all switch together.
 */
const NarrowContext = createContext(false);

export function NarrowProvider({
  initial,
  children,
}: {
  initial: boolean;
  children: ReactNode;
}) {
  const [narrow, setNarrow] = useState(initial);
  useEffect(() => {
    const widthMq = window.matchMedia("(max-width: 767px)");
    const isTouchDevice = () =>
      navigator.maxTouchPoints > 0 || "ontouchstart" in window;
    const update = () => setNarrow(widthMq.matches || isTouchDevice());
    update();
    widthMq.addEventListener("change", update);
    return () => widthMq.removeEventListener("change", update);
  }, []);
  return (
    <NarrowContext.Provider value={narrow}>{children}</NarrowContext.Provider>
  );
}

export function useIsNarrow(): boolean {
  return useContext(NarrowContext);
}
