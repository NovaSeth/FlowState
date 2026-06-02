"use client";

import type { ScoreKind } from "./scoreboard";
import { prefersReducedMotion } from "./use-reduced-motion";

/**
 * "+1" animation flying to the scoreboard. It spawns at the source point (the row
 * that just completed - or the center of the screen when the source isn't visible),
 * GROWS toward the center, then SHRINKS and flies to its counter in the HUD
 * ([data-score=kind]). On arrival it emits the window event 'fs:score' {kind} - the
 * HUD bumps the number. Multiple "+1"s can fly in parallel (each is a separate,
 * self-removing DOM node).
 *
 * Tiers: task = plain "+1"; milestone = "+1" with a spinning ribbon; project/solution
 * = larger, gold (the dim+confetti is handled separately by WinOverlay).
 *
 * With prefers-reduced-motion: no flight, we emit 'fs:score' immediately.
 */

type Tier = "task" | "milestone" | "project";

const COLOR: Record<Tier, string> = {
  task: "#3fb950",
  milestone: "#a371f7",
  project: "#f5c451",
};

function emit(kind: ScoreKind): void {
  window.dispatchEvent(new CustomEvent("fs:score", { detail: { kind } }));
}

function inViewport(r: DOMRect): boolean {
  return (
    r.width > 0 &&
    r.height > 0 &&
    r.bottom > 0 &&
    r.right > 0 &&
    r.top < window.innerHeight &&
    r.left < window.innerWidth
  );
}

/** A fireworks burst that FOLLOWS the "+1": a flash at the climax (`from`), and the
 *  particles scatter and DRIFT toward the counter (`to`) - trailing the number,
 *  instead of staying in the center. Self-removing nodes. */
function fireworks(
  from: { x: number; y: number },
  to: { x: number; y: number },
  color: string,
): void {
  // Central flash (an expanding disc of glow) - the "boom" at the climax.
  const flash = document.createElement("div");
  flash.setAttribute("aria-hidden", "true");
  Object.assign(flash.style, {
    position: "fixed",
    left: "0",
    top: "0",
    zIndex: "74",
    width: "24px",
    height: "24px",
    marginLeft: "-12px",
    marginTop: "-12px",
    borderRadius: "9999px",
    background: color,
    boxShadow: `0 0 24px 6px ${color}`,
    pointerEvents: "none",
    willChange: "transform, opacity",
  } as CSSStyleDeclaration);
  document.body.appendChild(flash);
  flash
    .animate(
      [
        { transform: `translate(${from.x}px, ${from.y}px) scale(0.4)`, opacity: 0.95 },
        { transform: `translate(${from.x}px, ${from.y}px) scale(3.4)`, opacity: 0 },
      ],
      { duration: 480, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" },
    )
    .finished.then(() => flash.remove())
    .catch(() => flash.remove());

  const N = 22;
  for (let i = 0; i < N; i++) {
    const p = document.createElement("div");
    p.setAttribute("aria-hidden", "true");
    const sz = 5 + Math.random() * 5;
    Object.assign(p.style, {
      position: "fixed",
      left: "0",
      top: "0",
      zIndex: "74",
      width: `${sz}px`,
      height: `${sz}px`,
      borderRadius: "9999px",
      background: color,
      boxShadow: `0 0 10px 1px ${color}`,
      pointerEvents: "none",
      willChange: "transform, opacity",
    } as CSSStyleDeclaration);
    document.body.appendChild(p);
    const a = Math.random() * Math.PI * 2;
    const spread = 22 + Math.random() * 46;
    // start: a small spray around the climax; end: near the counter with scatter
    // -> the whole sheaf "flies" after the "+1" toward the counter.
    const sx = from.x + Math.cos(a) * spread * 0.35;
    const sy = from.y + Math.sin(a) * spread * 0.35;
    const ex = to.x + Math.cos(a) * spread;
    const ey = to.y + Math.sin(a) * spread;
    p.animate(
      [
        { transform: `translate(${sx}px, ${sy}px) scale(1)`, opacity: 1 },
        { transform: `translate(${ex}px, ${ey}px) scale(0.3)`, opacity: 0 },
      ],
      {
        duration: 520 + Math.random() * 220,
        delay: Math.random() * 120,
        easing: "cubic-bezier(.3,.55,.3,1)",
        fill: "forwards",
      },
    ).finished.then(() => p.remove()).catch(() => p.remove());
  }
}

export interface FlyOpts {
  kind: ScoreKind;
  tier: Tier;
  /** Rect of the source element (e.g. a row). When missing/off-screen -> center. */
  sourceRect?: DOMRect | null;
  /** How many in total - renders "+N" instead of "+1" (batched flight). Default 1. */
  count?: number;
  /** Start delay (ms) - for staggering several flights. Default 0. */
  delay?: number;
  /** Path offset (px) - spreads several parallel "+1"s into a fan. */
  offset?: { x: number; y: number };
}

export function flyPlusOne({
  kind,
  tier,
  sourceRect,
  count = 1,
  delay = 0,
  offset,
}: FlyOpts): void {
  if (typeof window === "undefined") return;
  const target = document.querySelector<HTMLElement>(`[data-score="${kind}"]`);
  if (prefersReducedMotion() || !target) {
    emit(kind);
    return;
  }

  const offX = offset?.x ?? 0;
  const offY = offset?.y ?? 0;
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const start =
    sourceRect && inViewport(sourceRect)
      ? { x: sourceRect.left + sourceRect.width / 2 + offX, y: sourceRect.top + sourceRect.height / 2 + offY }
      : { x: cx + offX, y: cy - 40 + offY };
  // The "admiring" point in the center - also offset, so the fan does not converge
  // to a single point before heading to the counter.
  const mid = { x: cx + offX, y: cy + offY };
  const tr = target.getBoundingClientRect();
  const end = { x: tr.left + tr.width / 2, y: tr.top + tr.height / 2 };

  const color = COLOR[tier];
  const baseBig = tier === "project" ? 3.2 : tier === "milestone" ? 3.0 : 2.1;
  const big = count > 1 ? baseBig * 1.25 : baseBig;

  // "+1" container
  const node = document.createElement("div");
  node.setAttribute("aria-hidden", "true");
  Object.assign(node.style, {
    position: "fixed",
    left: "0",
    top: "0",
    zIndex: "75",
    pointerEvents: "none",
    fontWeight: "900",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: count > 1 ? "36px" : "28px",
    color,
    textShadow: `0 2px 10px ${color}88`,
    willChange: "transform, opacity",
  } as CSSStyleDeclaration);
  node.textContent = `+${count}`;

  // ribbon (spinning ring) - project only; a milestone gets fireworks below.
  if (tier === "project") {
    const ring = document.createElement("div");
    Object.assign(ring.style, {
      position: "absolute",
      left: "50%",
      top: "50%",
      width: "46px",
      height: "46px",
      marginLeft: "-23px",
      marginTop: "-23px",
      borderRadius: "9999px",
      border: `3px solid ${color}`,
      borderTopColor: "transparent",
      borderBottomColor: "transparent",
      opacity: "0.9",
    } as CSSStyleDeclaration);
    ring.animate(
      [{ transform: "rotate(0deg)" }, { transform: "rotate(720deg)" }],
      { duration: 1100, easing: "linear" },
    );
    node.appendChild(ring);
  }

  document.body.appendChild(node);

  const place = (x: number, y: number, scale: number) =>
    `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${scale})`;

  // Phase 1: source -> center, growing (with an optional delay for staggering).
  // Phase 2: center -> counter, shrinking. fill:"both" keeps opacity 0 during the delay.
  const phase1 = node.animate(
    [
      { transform: place(start.x, start.y, 0.6), opacity: 0 },
      { transform: place(mid.x, mid.y, big), opacity: 1 },
    ],
    { duration: 620, easing: "cubic-bezier(.22,1,.36,1)", fill: "both", delay },
  );

  phase1.finished
    .then(() => {
      // Milestone: fireworks - boom at the climax (mid), particles drift after the
      // "+1" toward the counter (end), instead of staying in the center.
      if (tier === "milestone") fireworks({ x: mid.x, y: mid.y + 16 }, end, color);
      const phase2 = node.animate(
        [
          { transform: place(mid.x, mid.y, big), opacity: 1 },
          { transform: place(end.x, end.y, 0.35), opacity: 0.5 },
        ],
        {
          duration: 560,
          easing: "cubic-bezier(.55,0,.85,.4)",
          fill: "forwards",
          delay: tier === "project" ? 260 : 120, // a moment of "admiring" in the center
        },
      );
      return phase2.finished;
    })
    .then(() => {
      emit(kind); // the counter ticks on arrival
      node.remove();
    })
    .catch(() => {
      // animation interrupted (e.g. navigation) - count anyway + clean up
      emit(kind);
      node.remove();
    });
}
