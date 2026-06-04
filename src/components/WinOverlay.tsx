"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useT } from "@/i18n/provider";
import { useReducedMotion } from "@/lib/use-reduced-motion";

/** The full-screen moment applies to projects and solutions (a milestone gets a lighter "+1"). */
export type WinTier = "project" | "solution";

/** i18n keys for the banner text per tier (resolved at render time). */
const TIER_TEXT: Record<WinTier, { kickerKey: string; titleKey: string }> = {
  project: { kickerKey: "win.projectKicker", titleKey: "win.projectTitle" },
  solution: { kickerKey: "win.solutionKicker", titleKey: "win.solutionTitle" },
};

const PALETTE = [0xf5c451, 0xffd700, 0xa371f7, 0x3fb950, 0x2f81f7, 0xffffff];

/**
 * Full-screen "YOU WIN" moment - a dark dim + banner + a 3D confetti shower
 * (three.js). Fired ONLY on milestone/project/solution completions (rarely =>
 * it stays a celebration). Lazy-loaded by Celebrations, so three.js only loads
 * on the first win. Auto-close + click + Escape. Under prefers-reduced-motion:
 * no 3D confetti, just the banner (and shorter).
 */
export function WinOverlay({
  tier,
  count,
  onClose,
}: {
  tier: WinTier;
  count: number;
  onClose: () => void;
}) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  // Escape + auto-close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const auto = setTimeout(onClose, reduced ? 2600 : 5200);
    return () => {
      document.removeEventListener("keydown", onKey);
      clearTimeout(auto);
    };
  }, [onClose, reduced]);

  // banner pop-in
  useEffect(() => {
    const el = bannerRef.current;
    if (!el || reduced) return;
    el.animate(
      [
        { transform: "scale(.6) translateY(20px)", opacity: 0 },
        { transform: "scale(1.05)", opacity: 1, offset: 0.6 },
        { transform: "scale(1) translateY(0)", opacity: 1 },
      ],
      { duration: 600, easing: "cubic-bezier(.34,1.56,.64,1)" },
    );
  }, [reduced]);

  // three.js confetti shower
  useEffect(() => {
    if (reduced) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch {
      return; // no WebGL -> banner only
    }
    const scene = new THREE.Scene();
    const w = window.innerWidth;
    const h = window.innerHeight;
    const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 100);
    camera.position.z = 16;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);

    // Confetti count per tier (WinTier is only project | solution).
    const N = tier === "solution" ? 320 : 220;
    const geo = new THREE.PlaneGeometry(0.3, 0.42);
    const top = 11;
    const spreadX = 22;
    type Bit = {
      mesh: THREE.Mesh;
      vy: number;
      vx: number;
      rx: number;
      rz: number;
    };
    const bits: Bit[] = [];
    const mats: THREE.Material[] = [];
    for (let i = 0; i < N; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: PALETTE[(Math.random() * PALETTE.length) | 0],
        side: THREE.DoubleSide,
        transparent: true,
      });
      mats.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        (Math.random() - 0.5) * spreadX,
        top + Math.random() * 14, // start above the screen, spread out over time
        (Math.random() - 0.5) * 6,
      );
      mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      scene.add(mesh);
      bits.push({
        mesh,
        vy: 0.05 + Math.random() * 0.08,
        vx: (Math.random() - 0.5) * 0.03,
        rx: (Math.random() - 0.5) * 0.12,
        rz: (Math.random() - 0.5) * 0.12,
      });
    }

    let raf = 0;
    let stopped = false;
    const t0 = performance.now();
    const tick = () => {
      const elapsed = performance.now() - t0;
      for (const b of bits) {
        b.mesh.position.y -= b.vy;
        b.mesh.position.x += b.vx + Math.sin(b.mesh.position.y * 0.5) * 0.01;
        b.mesh.rotation.x += b.rx;
        b.mesh.rotation.z += b.rz;
        if (b.mesh.position.y < -13) b.mesh.position.y = top + Math.random() * 4;
      }
      // gentle fade-out near the end
      if (elapsed > 3800) {
        const k = Math.max(0, 1 - (elapsed - 3800) / 1400);
        for (const m of mats) (m as THREE.MeshBasicMaterial).opacity = k;
      }
      renderer.render(scene, camera);
      if (!stopped) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onResize = () => {
      const nw = window.innerWidth;
      const nh = window.innerHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    window.addEventListener("resize", onResize);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      geo.dispose();
      mats.forEach((m) => m.dispose());
      renderer.dispose();
    };
  }, [tier, reduced]);

  const txt = TIER_TEXT[tier];
  const kicker = t(txt.kickerKey);
  const title = t(txt.titleKey);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${kicker} ${title}`}
      onClick={onClose}
      className="fixed inset-0 z-[70] flex items-center justify-center"
    >
      {/* background dim */}
      <div className="absolute inset-0 bg-[#0b0420]/80 backdrop-blur-sm" />
      {/* radial glow */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 42%, rgba(163,113,247,.35), transparent 60%)",
        }}
      />
      {/* 3D confetti */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* banner */}
      <div
        ref={bannerRef}
        className="relative z-10 flex flex-col items-center px-6 text-center"
      >
        <span className="text-sm font-bold uppercase tracking-[4px] text-amber-300">
          {kicker}
          {count > 1 ? ` x${count}` : ""}
        </span>
        <span
          className="mt-1 bg-gradient-to-b from-amber-200 via-amber-400 to-amber-600 bg-clip-text text-6xl font-black uppercase tracking-tight text-transparent sm:text-7xl"
          style={{
            WebkitTextStroke: "2px rgba(120,72,0,.35)",
            filter: "drop-shadow(0 4px 14px rgba(245,196,81,.5))",
          }}
        >
          {title}
        </span>
        <span className="mt-3 text-base font-medium text-white/80">
          {t("win.subtitle")}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="mt-6 rounded-full bg-gradient-to-b from-violet-500 to-violet-700 px-8 py-2.5 text-sm font-bold uppercase tracking-wide text-white shadow-floating transition-transform hover:scale-105 active:scale-95"
        >
          {t("win.button")}
        </button>
      </div>
    </div>
  );
}
