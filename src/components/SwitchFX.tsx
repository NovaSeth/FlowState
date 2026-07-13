"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useReducedMotion, prefersReducedMotion } from "@/lib/use-reduced-motion";

/* A real 3D wireframe wormhole (three.js): a wavy tube built from a
 * CatmullRom path, drawn as blue wireframe edges, with the camera flying
 * through it and exponential fog fading the depths to black - so you dive into
 * the dark throat ahead. Blue matches the side navigation. Nothing else: no
 * crosshair, no objects, no interaction - just the tunnel. Lazy-loaded (only
 * while a switch is in flight); a no-op under prefers-reduced-motion / no WebGL.
 *
 * `collapsing` (failure) fades the tunnel out; `arriving` (success) accelerates
 * the dive; `seed` reshapes the path so a re-target flies a new direction. */

const BLUE = 0x2f6bff; // the side-nav brand blue

export default function SwitchFX({
  collapsing,
  arriving,
  seed = 0,
}: {
  collapsing?: boolean;
  arriving?: boolean;
  seed?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const stateRef = useRef({ collapsing, arriving });
  useEffect(() => {
    stateRef.current = { collapsing, arriving };
  }, [collapsing, arriving]);

  useEffect(() => {
    // Use the SYNCHRONOUS check, not just the `reduced` state: useReducedMotion
    // returns false on the first commit (SSR-safe default) and only flips true
    // in its own post-mount effect, so relying on `reduced` alone would spin up
    // and immediately tear down a full WebGL context for reduced-motion users.
    if (reduced || prefersReducedMotion()) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch {
      return; // no WebGL -> overlay stays flat
    }
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x01020a, 0.3);
    const camera = new THREE.PerspectiveCamera(78, w / h, 0.1, 1000);

    // A twisty path from seeded-random points (Bobby Roe's approach), so each
    // (re)target flies a different, dramatically bending route.
    let s = Math.floor(seed * 1000) + 1;
    const rand = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < 10; i++) {
      points.push(
        new THREE.Vector3((rand() - 0.5) * 4, (rand() - 0.5) * 4, i * -3),
      );
    }
    const path = new THREE.CatmullRomCurve3(points, true, "catmullrom", 0.5);
    const tubeGeo = new THREE.TubeGeometry(path, 320, 0.72, 18, true);
    const edges = new THREE.EdgesGeometry(tubeGeo, 0.2);
    const mat = new THREE.LineBasicMaterial({
      color: BLUE,
      transparent: true,
      opacity: 0,
    });
    const tube = new THREE.LineSegments(edges, mat);
    scene.add(tube);

    // Ambient stars (part of the wormhole scene, not interactive).
    const starN = 260;
    const sp = new Float32Array(starN * 3);
    for (let i = 0; i < starN; i++) {
      sp[i * 3] = (Math.sin(i * 12.9 + seed) * 0.5 + 0.5 - 0.5) * 44;
      sp[i * 3 + 1] = (Math.sin(i * 78.2 + seed) * 0.5 + 0.5 - 0.5) * 44;
      sp[i * 3 + 2] = (Math.sin(i * 37.7 + seed) * 0.5 + 0.5 - 0.5) * 44;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0x9fc0ff,
      size: 0.08,
      transparent: true,
      opacity: 0,
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    let raf = 0;
    let stopped = false;
    let progress = 0;
    let last = performance.now();
    const t0 = last;
    const tick = () => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const elapsed = (now - t0) / 1000;
      const { collapsing, arriving } = stateRef.current;

      // Fly forward along the path (slow, hypnotic); arrival accelerates the dive.
      const speed = arriving ? 0.32 : 0.042;
      progress = (progress + dt * speed) % 1;
      const pos = path.getPointAt(progress);
      const look = path.getPointAt((progress + 0.015) % 1);
      camera.position.copy(pos);
      camera.lookAt(look);

      // Fade in; fade out on collapse (failure).
      const target = collapsing ? 0 : 1;
      const appear = Math.min(elapsed / 0.4, 1);
      mat.opacity += (target * appear - mat.opacity) * 0.12;
      starMat.opacity = mat.opacity * 0.7;

      renderer.render(scene, camera);
      if (!stopped) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onResize = () => {
      const nw = canvas.clientWidth || window.innerWidth;
      const nh = canvas.clientHeight || window.innerHeight;
      renderer.setSize(nw, nh, false);
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      tubeGeo.dispose();
      edges.dispose();
      mat.dispose();
      starGeo.dispose();
      starMat.dispose();
      renderer.dispose();
    };
  }, [reduced, seed]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      // Grows from small to full as the wormhole opens.
      className="pointer-events-none absolute inset-0 h-full w-full [animation:fs-grow_0.6s_cubic-bezier(0.22,1,0.36,1)]"
    />
  );
}
