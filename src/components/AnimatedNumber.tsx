"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/use-reduced-motion";

/**
 * A number that counts up to the new value when the `value` prop changes - you
 * can see that something ticked (e.g. 89% -> 91%, the task counter). The first
 * render shows the value immediately (no animation from zero). Reduced-motion or
 * no change -> set it instantly.
 */
export function AnimatedNumber({
  value,
  suffix = "",
  className,
}: {
  value: number;
  suffix?: string;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const reduced = useReducedMotion();

  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    if (reduced) {
      fromRef.current = value;
      // set it asynchronously (in rAF), not synchronously inside the effect
      const id = requestAnimationFrame(() => setDisplay(value));
      return () => cancelAnimationFrame(id);
    }
    const duration = 500;
    let start = 0;
    let raf = 0;
    const step = (ts: number) => {
      if (!start) start = ts;
      const t = Math.min(1, (ts - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) {
        raf = requestAnimationFrame(step);
      } else {
        fromRef.current = value;
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);

  return (
    <span className={className}>
      {display}
      {suffix}
    </span>
  );
}
