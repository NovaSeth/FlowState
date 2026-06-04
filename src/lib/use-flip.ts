"use client";

import { RefObject, useLayoutEffect, useRef } from "react";
import { prefersReducedMotion } from "./use-reduced-motion";
import { toRgba } from "./color";

const FLASH_MS = 700; // flash in place (slide)
const HOLD_MS = 500; // slide: flash first, then the travel
const SLIDE_MS = 320;
// Kanban: duration of the "flash at the source + disappear" phase (420+240 in
// kanbanMove). Neighbors hold their old positions for this long and only THEN slide
// in - in parallel with the moved card entering at the top of the target column.
const KANBAN_HOLD = 660;

export type FlipMode = "slide" | "kanban";

// Applies inline styles without an unsafe `as CSSStyleDeclaration` cast.
// Partial<CSSStyleDeclaration> is the honest type for "some style props".
function applyStyle(el: HTMLElement, style: Partial<CSSStyleDeclaration>): void {
  Object.assign(el.style, style);
}

// Color of the target STATUS from data-flip-status (each status has its own color,
// the same variables as the column pill/dot): todo=fg-subtle, in_progress=accent,
// blocked=danger, done=success, closed=done(purple).
const STATUS_VAR: Record<string, string> = {
  todo: "--fg-subtle",
  in_progress: "--accent",
  blocked: "--danger",
  done: "--success",
  closed: "--done",
};
function statusHex(el: HTMLElement): string {
  const varName = STATUS_VAR[el.dataset.flipStatus ?? ""] ?? "--accent";
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue(varName)
      .trim() || "#2f81f7"
  );
}

/**
 * Tracks the transient DOM (cloned ghost nodes) and Web Animations created during
 * one effect run, so the effect's cleanup can cancel/remove them on unmount or
 * re-run (otherwise clones leak on document.body and animations keep running).
 */
interface FlipScratch {
  anims: Animation[];
  clones: HTMLElement[];
  // Set by the cleanup so async continuations (kanbanMove's .then chain) do not
  // start NEW animations / touch nodes after the effect has been torn down.
  cancelled: boolean;
}

// Flash the card background (inset box-shadow - a fill without a border, respects
// the corner radius and does not cover the text).
function flashInPlace(el: HTMLElement, scratch: FlipScratch): void {
  const c = toRgba(statusHex(el), 0.2);
  scratch.anims.push(
    el.animate(
      [
        { boxShadow: "inset 0 0 0 999px rgba(0,0,0,0)" },
        { boxShadow: `inset 0 0 0 999px ${c}`, offset: 0.12 },
        { boxShadow: "inset 0 0 0 999px rgba(0,0,0,0)", offset: 1 },
      ],
      { duration: FLASH_MS, easing: "ease-out" },
    ),
  );
}

// Kanban: a card changing column. Choreography: a CLONE in the old column flashes
// and disappears, while the real card (already in the new column) enters FROM THE
// TOP with a fading flash. A stronger signal than a dry travel.
function kanbanMove(el: HTMLElement, old: DOMRect, scratch: FlipScratch): void {
  const hex = statusHex(el);
  const peak = toRgba(hex, 0.22);
  const tail = toRgba(hex, 0.1);

  const clone = el.cloneNode(true) as HTMLElement;
  // the clone is a purely visual ghost - without anchor attributes, so it does not
  // collide with the data-cid/data-flip-key lookup while it is alive.
  clone.removeAttribute("data-cid");
  clone.removeAttribute("data-flip-key");
  applyStyle(clone, {
    position: "fixed",
    left: `${old.left}px`,
    top: `${old.top}px`,
    width: `${old.width}px`,
    height: `${old.height}px`,
    margin: "0",
    zIndex: "60",
    pointerEvents: "none",
  });
  document.body.appendChild(clone);
  scratch.clones.push(clone);

  // the real card stays hidden until the "enter from the top"
  el.style.opacity = "0";

  const cleanup = () => {
    clone.remove();
    el.style.opacity = "";
  };

  const flash = clone.animate(
    [
      { boxShadow: "inset 0 0 0 999px rgba(0,0,0,0)" },
      { boxShadow: `inset 0 0 0 999px ${peak}`, offset: 0.25 },
      { boxShadow: `inset 0 0 0 999px ${peak}`, offset: 1 },
    ],
    { duration: 420, easing: "ease-out", fill: "forwards" },
  );
  scratch.anims.push(flash);

  flash.finished
    .then(() => {
      if (scratch.cancelled) return Promise.reject(new Error("cancelled"));
      const fade = clone.animate(
        [
          { opacity: 1, transform: "scale(1)" },
          { opacity: 0, transform: "scale(.92)" },
        ],
        { duration: 240, easing: "ease-in", fill: "forwards" },
      );
      scratch.anims.push(fade);
      return fade.finished;
    })
    .then(() => {
      if (scratch.cancelled) return;
      cleanup();
      // the real card enters FROM THE TOP + a fading flash
      scratch.anims.push(
        el.animate(
          [
            { opacity: 0, transform: "translateY(-16px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" },
        ),
      );
      scratch.anims.push(
        el.animate(
          [
            { boxShadow: `inset 0 0 0 999px ${peak}` },
            { boxShadow: `inset 0 0 0 999px ${tail}`, offset: 0.5 },
            { boxShadow: "inset 0 0 0 999px rgba(0,0,0,0)" },
          ],
          { duration: 640, easing: "ease-out" },
        ),
      );
    })
    .catch(cleanup);
}

/**
 * FLIP: animates position changes of [data-flip-key] elements within `scopeRef`
 * whenever `signal` changes. Measures positions after each render (useLayoutEffect).
 * Modes:
 *  - "slide" (list): flash in place, then after 500ms travel to the new position,
 *  - "kanban": a card changing column disappears (flash + ghost fade) and enters from
 *    the top in the new column with a fading flash.
 * New elements enter (fade + scale). No-op under prefers-reduced-motion.
 * The first commit does not animate. Key = data-flip-key (stable entity id).
 */
export function useFlip(
  scopeRef: RefObject<HTMLElement | null>,
  signal: string,
  mode: FlipMode = "slide",
  resetKey = "",
): void {
  const prev = useRef<Map<string, DOMRect>>(new Map());
  const prevStatus = useRef<Map<string, string>>(new Map());
  const prevReset = useRef<string | null>(null);
  const armed = useRef(false);

  useLayoutEffect(() => {
    const scope = scopeRef.current;
    if (!scope) {
      prev.current = new Map();
      prevStatus.current = new Map();
      // Symmetry with the measured branch: forget the last reset key so re-mounting
      // a scope does not treat the first commit as a (non-)reset by stale state.
      prevReset.current = null;
      armed.current = false;
      return;
    }
    // Transient resources created this run (clones appended to body, in-flight Web
    // Animations) - cleaned up on unmount/re-run so they do not leak.
    const scratch: FlipScratch = { anims: [], clones: [], cancelled: false };
    // A resetKey change (e.g. a different milestone) = swapping the WHOLE set, not a
    // change of individual tasks -> just measure positions, do not animate (no enter/flash).
    const resetChanged = prevReset.current !== resetKey;
    prevReset.current = resetKey;
    const reduce = prefersReducedMotion();

    const els = Array.from(
      scope.querySelectorAll<HTMLElement>("[data-flip-key]"),
    );
    const next = new Map<string, DOMRect>();
    const nextStatus = new Map<string, string>();
    for (const el of els) {
      const k = el.dataset.flipKey;
      if (k) {
        next.set(k, el.getBoundingClientRect());
        nextStatus.set(k, el.dataset.flipStatus ?? "");
      }
    }

    if (armed.current && !reduce && !resetChanged) {
      for (const el of els) {
        const k = el.dataset.flipKey;
        if (!k) continue;
        const n = next.get(k)!;
        const p = prev.current.get(k);
        // Whether THIS card's STATUS changed (and not just its position due to a
        // neighbor's resort). Only such a card gets the flash / kanban choreography.
        const changed =
          prevStatus.current.has(k) &&
          prevStatus.current.get(k) !== nextStatus.get(k);
        if (p) {
          const dx = p.left - n.left;
          const dy = p.top - n.top;
          if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) continue;
          if (mode === "kanban") {
            // Only the card whose STATUS changed runs the clone->disappear->enter
            // choreography. Cards closing the gap just slide smoothly.
            if (changed) {
              kanbanMove(el, p, scratch);
            } else {
              // Neighbor closing the gap / making room: holds its old position
              // (fill+delay) for the flash+disappear duration, then slides in.
              scratch.anims.push(
                el.animate(
                  [
                    { transform: `translate(${dx}px, ${dy}px)` },
                    { transform: "translate(0, 0)" },
                  ],
                  {
                    duration: SLIDE_MS,
                    easing: "cubic-bezier(.2,.8,.2,1)",
                    delay: KANBAN_HOLD,
                    fill: "both",
                  },
                ),
              );
            }
          } else {
            // list: only the card with a changed status FLASHES; the rest just
            // travel. Everyone holds for 500ms (the list is frozen during the flash),
            // then travels to the new positions.
            if (changed) flashInPlace(el, scratch);
            const z0 = el.style.zIndex;
            el.style.zIndex = "5";
            const anim = el.animate(
              [
                { transform: `translate(${dx}px, ${dy}px)` },
                { transform: "translate(0, 0)" },
              ],
              {
                duration: SLIDE_MS,
                easing: "cubic-bezier(.2,.8,.2,1)",
                delay: HOLD_MS,
                fill: "both",
              },
            );
            scratch.anims.push(anim);
            const restore = () => {
              el.style.zIndex = z0;
            };
            anim.finished.then(restore).catch(restore);
          }
        } else {
          scratch.anims.push(
            el.animate(
              [
                { opacity: 0, transform: "scale(.96)" },
                { opacity: 1, transform: "scale(1)" },
              ],
              { duration: 220, easing: "ease-out" },
            ),
          );
        }
      }
    }

    prev.current = next;
    prevStatus.current = nextStatus;
    armed.current = true;

    // Cleanup: on unmount or before the next run, cancel in-flight animations and
    // remove any clone nodes still attached to the body. `cancelled` stops
    // kanbanMove's async continuation from spawning new animations afterwards.
    return () => {
      scratch.cancelled = true;
      for (const a of scratch.anims) a.cancel();
      for (const c of scratch.clones) c.remove();
    };
  }, [signal, scopeRef, mode, resetKey]);
}
