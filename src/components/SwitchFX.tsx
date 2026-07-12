"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useReducedMotion } from "@/lib/use-reduced-motion";

/* A smooth, shader-based "water wormhole" behind the source-switch overlay:
 * flowing concentric ripples pulled inward with a gentle swirl, in Flow State
 * blues - not pixelated points but a full-screen GLSL quad. When `collapsing`
 * turns true (a failed connection) the wormhole implodes toward the centre and
 * fades to the plain background. Lazy-loaded (only while a switch is in
 * flight); a no-op under prefers-reduced-motion or without WebGL. */

const VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uCollapse;   // 0 = open wormhole, 1 = imploded (failure)
  uniform float uArrive;     // 0 -> 1 fly-through-and-brighten (success)
  uniform float uAppear;     // 0 -> 1 fade-in
  uniform float uOpen;       // 0 -> 1 grow from a small disc to full screen
  uniform float uSeed;       // rotates the vortex direction (changes on re-target)
  uniform vec2  uRes;

  #define PI 3.14159265

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(41.3, 289.7))) * 43758.5453);
  }

  // A perspective TUNNEL you fly INTO: the depth coordinate is 1/r, so the
  // centre recedes to a far throat and the walls stream toward the viewer. The
  // walls are textured with thin longitudinal streaks that flicker as they pass.
  float tunnelWall(vec2 uv, float dir) {
    float r = length(uv);
    float a = atan(uv.y, uv.x) + uSeed;
    // Forward flight + perspective. Arrival accelerates the dive.
    float depth = (0.32 / (r + 0.05)) + uTime * (1.1 + uArrive * 4.0);
    float s = 0.0;
    for (int k = 0; k < 3; k++) {
      float N = 26.0 + float(k) * 34.0;
      float sl = a / (2.0 * PI) * N;
      float h = hash(vec2(floor(sl), floor(depth * 0.5) + float(k) * 17.0 + dir));
      float lit = smoothstep(0.62, 1.0, h);
      float line = smoothstep(0.5, 0.0, abs(fract(sl) - 0.5));  // thin streak
      float flick = 0.5 + 0.5 * sin(depth * 3.0 + h * 30.0);    // pass-by twinkle
      s += lit * pow(line, 2.2) * flick;
    }
    return s;
  }

  void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    uv.x *= uRes.x / uRes.y;
    // Gentle looking-through-water wobble.
    uv += 0.012 * vec2(sin(uv.y * 6.0 + uTime), cos(uv.x * 6.0 + uTime * 1.1));

    float r = length(uv);
    // Collapse implodes the whole field; nothing else scales the throat so the
    // sense of depth stays intact while diving.
    float rC = r * mix(1.0, 5.0, uCollapse);

    // Chromatic dispersion: sample the walls at slightly offset radii per channel.
    float disp = 0.03 + uArrive * 0.14;
    float wr = tunnelWall(uv * (1.0 + disp), 0.0);
    float wg = tunnelWall(uv, 5.0);
    float wb = tunnelWall(uv * (1.0 - disp), 11.0);
    float w = (wr + wg + wb) / 3.0;

    // Dark throat in the centre (the hole we fly toward); walls brighten outward.
    float wallBright = smoothstep(0.03, 0.55, rC);

    vec3 cool   = vec3(0.20, 0.45, 1.0);   // Flow State blue
    vec3 violet = vec3(0.55, 0.30, 1.0);   // wormhole violet
    vec3 tint   = mix(cool, violet, 0.5 + 0.5 * sin(atan(uv.y, uv.x) * 2.0 + uTime * 0.4));
    vec3 col = vec3(0.0);
    col.r += tint.r * wr;
    col.g += tint.g * wg;
    col.b += tint.b * wb;
    col *= wallBright * 1.5;
    col += violet * 0.05 * wallBright;                  // faint wall glow
    col += tint * smoothstep(0.35, 0.08, rC) * 0.10;    // soft rim near the throat
    col += vec3(0.85, 0.9, 1.0) * uArrive * wallBright; // arrival brighten

    // Grow-from-small reveal: a disc expanding from the centre to full screen.
    float reveal = smoothstep(uOpen * 1.7, uOpen * 1.7 - 0.28, r);
    float lum = clamp(w * wallBright * 1.4, 0.0, 1.0);
    float alpha = lum * uAppear * reveal * (1.0 - uCollapse) * (1.0 - uArrive);
    gl_FragColor = vec4(col, alpha);
  }
`;

export default function SwitchFX({
  collapsing,
  arriving,
  seed = 0,
}: {
  collapsing?: boolean;
  arriving?: boolean;
  /** Changing this rotates the vortex direction (re-targeting mid-switch). */
  seed?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  // Keep the latest phase flags + seed readable inside the animation loop.
  const collapsingRef = useRef(collapsing);
  const arrivingRef = useRef(arriving);
  const seedRef = useRef(seed);
  useEffect(() => {
    collapsingRef.current = collapsing;
    arrivingRef.current = arriving;
    seedRef.current = seed;
  }, [collapsing, arriving, seed]);

  useEffect(() => {
    if (reduced) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch {
      return; // no WebGL -> overlay stays flat
    }
    const scene = new THREE.Scene();
    const camera = new THREE.Camera();
    // Size to the canvas box (the overlay, which is offset from the server
    // rail) rather than the whole window, so the effect fills exactly its area.
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);

    const uniforms = {
      uTime: { value: 0 },
      uCollapse: { value: 0 },
      uArrive: { value: 0 },
      uAppear: { value: 0 },
      uOpen: { value: 0 },
      uSeed: { value: seedRef.current },
      uRes: { value: new THREE.Vector2(w, h) },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms,
      transparent: true,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(mesh);

    let raf = 0;
    let stopped = false;
    const t0 = performance.now();
    const tick = () => {
      const elapsed = (performance.now() - t0) / 1000;
      uniforms.uTime.value = elapsed;
      // Ease the fade-in, and ease the collapse toward 1 when failing.
      uniforms.uAppear.value = Math.min(elapsed / 0.25, 1);
      // Grow from a small central disc to full screen over the first ~0.6s.
      uniforms.uOpen.value = Math.min(elapsed / 0.6, 1);
      uniforms.uCollapse.value +=
        ((collapsingRef.current ? 1 : 0) - uniforms.uCollapse.value) * 0.08;
      // Arrival ramps faster (a quick fly-through before the screens appear).
      uniforms.uArrive.value +=
        ((arrivingRef.current ? 1 : 0) - uniforms.uArrive.value) * 0.16;
      // Ease the vortex direction toward the current seed (smooth re-target).
      uniforms.uSeed.value += (seedRef.current - uniforms.uSeed.value) * 0.06;
      renderer.render(scene, camera);
      if (!stopped) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onResize = () => {
      const nw = canvas.clientWidth || window.innerWidth;
      const nh = canvas.clientHeight || window.innerHeight;
      renderer.setSize(nw, nh, false);
      uniforms.uRes.value.set(nw, nh);
    };
    window.addEventListener("resize", onResize);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      mesh.geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [reduced]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
