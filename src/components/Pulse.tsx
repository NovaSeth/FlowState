"use client";

import { ReactNode, useEffect, useRef } from "react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { toRgba } from "@/lib/color";

type Variant = "status" | "percent" | "plain";

/**
 * Wraps an element and "pulses" it with a short ring flash when `signal`
 * changes - a "something changed here" signal (baseline, not a celebration:
 * celebrating completions is the job of the global Celebrations system). Accent
 * for neutral/improving changes, danger when it gets worse (->blocked / a % drop).
 * The flash uses the Web Animations API (clean re-triggering). No-op under
 * prefers-reduced-motion. The first render doesn't animate.
 */
export function Pulse({
  signal,
  variant = "plain",
  className = "",
  children,
}: {
  signal: string | number;
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef(signal);
  const mounted = useRef(false);
  const anim = useRef<Animation | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    mounted.current = true;
  }, []);

  useEffect(() => {
    if (prev.current === signal) return;
    const p = prev.current;
    prev.current = signal;
    if (!mounted.current) return; // don't animate the first render
    const el = ref.current;
    if (!el) return;
    if (reduced) return;

    // good = neutral change (accent), done = completion / % increase (success),
    // bad = worse (danger). Done glows green, to stay consistent with "+1".
    let tone: "good" | "bad" | "done" = "good";
    if (variant === "status") {
      if (signal === "done") tone = "done";
      else if (signal === "blocked" || (p === "done" && signal !== "done")) tone = "bad";
      else tone = "good";
    } else if (variant === "percent") {
      tone = Number(signal) > Number(p) ? "done" : "bad";
    }

    const css = getComputedStyle(document.documentElement);
    const varName =
      tone === "bad" ? "--danger" : tone === "done" ? "--success" : "--accent";
    const base = css.getPropertyValue(varName).trim();
    const hex = base || (tone === "done" ? "#3fb950" : "#2f81f7");
    const tint = toRgba(hex, 0.22);
    // Background flash only (no border): a FAST ignition (~7% of the time) and a
    // LONG fade. A re-trigger starts from the CURRENT fade color (we read bg
    // before cancel), so a repeated flash doesn't blink through transparency - it
    // ramps up smoothly.
    const cur = getComputedStyle(el).backgroundColor || "rgba(0,0,0,0)";
    anim.current?.cancel();
    anim.current = el.animate(
      [
        { backgroundColor: cur, offset: 0 },
        { backgroundColor: tint, offset: 0.07 },
        { backgroundColor: "rgba(0,0,0,0)", offset: 1 },
      ],
      { duration: 1400, easing: "ease-out" },
    );
  }, [signal, variant, reduced]);

  return (
    <div ref={ref} className={className} style={{ borderRadius: "0.5rem" }}>
      {children}
    </div>
  );
}
