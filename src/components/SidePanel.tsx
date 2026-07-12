"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { useIsNarrow } from "@/lib/use-is-narrow";

/* Shared chrome for the right-edge inspector drawers (task detail, project
   dashboard): backdrop, Escape-to-close, focus hand-off, slide animation, and on
   narrow screens a swipe-dismissable bottom sheet. Extracted from TaskPanel so
   every drawer behaves identically. */

export function SidePanel({
  open,
  ariaLabel,
  onClose,
  children,
  wide = false,
}: {
  open: boolean;
  ariaLabel: string;
  onClose: () => void;
  children: ReactNode;
  /** A third wider drawer for content-heavy panels (project dashboard). */
  wide?: boolean;
}) {
  const narrow = useIsNarrow();

  // Dialog: Escape closes it, focus moves into the panel on open and returns to
  // the previous element on close. onClose lives in a ref so the effect does not
  // detach on every render (and does not trip react-hooks/refs via a write during render).
  const asideRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    asideRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open]);

  // Swipe-down closes the bottom sheet (mobile). The gesture only starts outside
  // the scrollable content ([data-sheet-scroll]) so it does not collide with scrolling.
  const [dragY, setDragY] = useState(0);
  const dragFrom = useRef<number | null>(null);

  function onTouchStart(e: React.TouchEvent) {
    if (!narrow || !open) return;
    if ((e.target as HTMLElement).closest("[data-sheet-scroll]")) return;
    dragFrom.current = e.touches[0].clientY;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (dragFrom.current === null) return;
    const dy = e.touches[0].clientY - dragFrom.current;
    setDragY(dy > 0 ? dy : 0); // downward only
  }
  function onTouchEnd() {
    if (dragFrom.current === null) return;
    if (dragY > 110) onClose(); // threshold: dragged down far enough -> close
    setDragY(0);
    dragFrom.current = null;
  }

  // Mobile: bottom sheet sliding up from the bottom (rounded top, handle, safe-area).
  // Desktop: drawer from the right edge. Animated via translate.
  const sheet = narrow
    ? `inset-x-0 bottom-0 max-h-[92svh] rounded-t-2xl border-t pb-[env(safe-area-inset-bottom)] duration-300 ${
        open ? "translate-y-0" : "translate-y-full"
      }`
    : `right-0 top-13 bottom-0 w-full ${wide ? "max-w-[540px]" : "max-w-[400px]"} border-l duration-200 ${
        open ? "translate-x-0" : "translate-x-full"
      }`;

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed z-40 bg-black/10 transition-opacity ${
          narrow ? "inset-0" : "inset-x-0 bottom-0 top-13"
        } ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <aside
        ref={asideRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-hidden={!open}
        tabIndex={-1}
        inert={!open ? true : undefined}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={
          narrow && dragY > 0
            ? { transform: `translateY(${dragY}px)`, transition: "none" }
            : undefined
        }
        className={`fixed z-50 flex flex-col border-edge bg-canvas shadow-floating outline-none transition-transform ${sheet}`}
      >
        {narrow && open && (
          <div className="flex shrink-0 cursor-grab justify-center pb-1.5 pt-3 active:cursor-grabbing">
            <span className="h-1.5 w-10 rounded-full bg-edge-muted" />
          </div>
        )}
        {children}
      </aside>
    </>
  );
}
