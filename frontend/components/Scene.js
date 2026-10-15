"use client";

import { useEffect, useRef } from "react";

/**
 * Pseudo-3D backdrop: a (2,3) torus knot drawn as a cloud of white points, perspective-projected onto a
 * 2D canvas. Depth drives size and opacity; the pointer tilts it slightly. No WebGL, no dependencies.
 */

const POINTS = 4200;

/** Gaussian-ish jitter keeps the ribbon soft instead of a hard tube. */
const jitter = () => (Math.random() + Math.random() + Math.random() - 1.5) * 0.075;

function buildKnot() {
  const pts = new Float32Array(POINTS * 3);
  const p = 2;
  const q = 3;
  for (let i = 0; i < POINTS; i++) {
    const t = (i / POINTS) * Math.PI * 2;
    const r = 0.42 * Math.cos(q * t) + 1;
    pts[i * 3] = r * Math.cos(p * t) + jitter();
    pts[i * 3 + 1] = r * Math.sin(p * t) + jitter();
    pts[i * 3 + 2] = 0.42 * Math.sin(q * t) * 1.6 + jitter();
  }
  return pts;
}

export default function Scene({ className }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const pts = buildKnot();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let frame = 0;
    let visible = true;
    let angle = 0.6;
    let last = 0;
    // Tilt toward the pointer is a damped spring with velocity, so the shape has mass: it accelerates
    // and settles instead of snapping to the cursor.
    const tilt = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const scale = Math.min(width, height) * 0.34;
      const cx = width * 0.5;
      const cy = height * 0.5;
      const ay = angle + tilt.x * 0.3;
      const ax = 0.95 + tilt.y * 0.18;
      const sinY = Math.sin(ay);
      const cosY = Math.cos(ay);
      const sinX = Math.sin(ax);
      const cosX = Math.cos(ax);
      const focal = 3.4;

      ctx.fillStyle = "#fff";
      for (let i = 0; i < POINTS; i++) {
        const x0 = pts[i * 3];
        const y0 = pts[i * 3 + 1];
        const z0 = pts[i * 3 + 2];
        // Rotate around Y, then X.
        const x1 = x0 * cosY + z0 * sinY;
        const z1 = -x0 * sinY + z0 * cosY;
        const y2 = y0 * cosX - z1 * sinX;
        const z2 = y0 * sinX + z1 * cosX;
        const persp = focal / (focal + z2);
        const depth = (1.6 - z2) / 3.2; // ~0 far .. ~1 near
        ctx.globalAlpha = Math.max(0.06, Math.min(0.95, depth * depth));
        const size = Math.max(0.6, persp * 1.7);
        ctx.fillRect(cx + x1 * scale * persp, cy + y2 * scale * persp, size, size);
      }
      ctx.globalAlpha = 1;
    };

    const STIFFNESS = 5; // low: ~1.6 s to cover 90% of a jump
    const DAMPING = 4.2; // near critical (2·√5 ≈ 4.47): settles without visible overshoot or wobble
    const SPIN = 0.08; // rad/s, ~80 s per turn

    const step = (dt) => {
      angle += SPIN * dt;
      tilt.vx += (STIFFNESS * (tilt.tx - tilt.x) - DAMPING * tilt.vx) * dt;
      tilt.vy += (STIFFNESS * (tilt.ty - tilt.y) - DAMPING * tilt.vy) * dt;
      tilt.x += tilt.vx * dt;
      tilt.y += tilt.vy * dt;
    };

    const tick = (now) => {
      // Time-based so the motion feels the same at 60 Hz and 144 Hz; clamp after tab switches.
      const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 0;
      last = now;
      if (visible) {
        step(dt);
        draw();
      }
      frame = requestAnimationFrame(tick);
    };

    const onPointer = (e) => {
      tilt.tx = (e.clientX / window.innerWidth - 0.5) * 2;
      tilt.ty = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    // Drift back to rest when the pointer leaves the window.
    const onLeave = () => {
      tilt.tx = 0;
      tilt.ty = 0;
    };

    resize();
    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
    ro.observe(canvas);
    // Stop drawing while scrolled away.
    const io = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
    io.observe(canvas);

    if (reduceMotion) {
      draw();
    } else {
      window.addEventListener("pointermove", onPointer, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
      frame = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onPointer);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
