"use client";

import { useEffect, useState } from "react";

/**
 * Non-hook, one-shot check of the reduced-motion preference. Single source of truth
 * for imperative code (e.g. fly-plus-one, use-flip) that needs the value outside of
 * React render. SSR-safe: returns false when there is no window.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Whether the user requested reduced motion (system). The "live pulse" animations
 * are an enhancement - when true, we replace the noise (flash/particles) with a calm
 * fade or nothing. We start from false (SSR-safe), the real value comes after mount.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}
