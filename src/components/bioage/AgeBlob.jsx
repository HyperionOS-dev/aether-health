import { useEffect, useRef } from "react";

// Central "Age" blob: a slow, floating, morphing organic shape with drifting particles,
// colored by whether the estimate is younger (lavender) or older (strain orange).
// Performance: capped to ~30fps, paused when off-screen, minimal per-frame work.
const TONES = {
  younger: { core: "#C9B5E8", glow: "#9C7FD6", halo: "rgba(201,181,232,0.32)" },
  older: { core: "#FF7A40", glow: "#FF5500", halo: "rgba(255,85,0,0.30)" },
  neutral: { core: "#8B94A7", glow: "#C9B5E8", halo: "rgba(201,181,232,0.22)" },
};

const hexA = (hex, a) => {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};

export default function AgeBlob({ number, deltaLabel, deltaTone = "younger", size = 300 }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const S = canvas.clientWidth || size;
    canvas.width = S * dpr;
    canvas.height = S * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const r = S / 2;
    const N = 28;
    const parts = Array.from({ length: N }, () => {
      const a = Math.random() * Math.PI * 2;
      const dist = Math.pow(Math.random(), 0.7) * (r * 0.74);
      return {
        bx: r + Math.cos(a) * dist,
        by: r + Math.sin(a) * dist,
        rr: Math.random() * 2 + 0.5,
        sp: Math.random() * 0.5 + 0.3,
        ph: Math.random() * Math.PI * 2,
        amp: Math.random() * 4 + 2,
        a: Math.random() * 0.4 + 0.2,
      };
    });

    // 64 points around the blob boundary; few modes keep the silhouette smooth + cheap.
    const BP = 64;
    const baseR = r * 0.82;

    // One frame at time t — shared by the animated loop and the static reduced-motion path.
    const drawBlob = (cx, cy, tone, phase, breath) => {
      ctx.beginPath();
      for (let i = 0; i <= BP; i++) {
        const ang = (i / BP) * Math.PI * 2;
        // two slow deformation modes give an organic, breathing wobble
        const def =
          Math.sin(ang * 3 + phase) * (baseR * 0.05) +
          Math.sin(ang * 5 + phase * 0.7) * (baseR * 0.035) +
          Math.cos(ang * 2 + phase * 0.4) * (baseR * 0.025);
        const rad = baseR * breath + def;
        const x = cx + Math.cos(ang) * rad;
        const y = cy + Math.sin(ang) * rad;
        if (i === 0) ctx.moveTo(x, y);
        else {
          const pa = ((i - 1) / BP) * Math.PI * 2;
          const pmx = cx + Math.cos((ang + pa) / 2) * rad;
          const pmy = cy + Math.sin((ang + pa) / 2) * rad;
          ctx.quadraticCurveTo(x, y, pmx, pmy);
        }
      }
      ctx.closePath();
    };

    // One frame at time t — shared by the animated loop and the static reduced-motion path.
    const frame = (t) => {
      const c = TONES[deltaTone] || TONES.neutral;
      ctx.clearRect(0, 0, S, S);

      const cx = r + Math.sin(t * 0.7) * (r * 0.03);
      const cy = r + Math.cos(t * 0.58) * (r * 0.03);
      const breath = 0.98 + Math.sin(t * 0.9) * 0.04;
      const phase = t * 1.1;

      const g = ctx.createRadialGradient(cx, cy, baseR * 0.1, cx, cy, baseR * breath);
      g.addColorStop(0, hexA(c.glow, 0.20));
      g.addColorStop(0.6, hexA(c.glow, 0.08));
      g.addColorStop(1, hexA(c.glow, 0));
      drawBlob(cx, cy, c, phase, breath);
      ctx.fillStyle = g;
      ctx.fill();

      ctx.lineWidth = 1;
      ctx.strokeStyle = hexA(c.core, 0.35);
      ctx.stroke();

      ctx.globalCompositeOperation = "lighter";
      for (const p of parts) {
        const x = p.bx + Math.sin(t * p.sp + p.ph) * p.amp + (cx - r);
        const y = p.by + Math.cos(t * p.sp * 0.8 + p.ph) * p.amp + (cy - r);
        ctx.beginPath();
        ctx.fillStyle = hexA(c.core, p.a);
        ctx.arc(x, y, p.rr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    };

    // Reduced motion: render one static frame and never start the loop.
    const reduce =
      typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      frame(0);
      return;
    }

    let raf = null;
    let last = 0;
    let t = 0;
    let running = true;

    const loop = (now) => {
      if (!running) { raf = null; return; }
      raf = requestAnimationFrame(loop);
      const dt = now - last;
      if (dt < 24) return; // ~40fps cap
      last = now;
      t += dt * 0.001;
      frame(t);
    };

    const start = () => { if (running && raf == null) raf = requestAnimationFrame(loop); };
    const stop = () => { if (raf != null) { cancelAnimationFrame(raf); raf = null; } };

    // Pause when off-screen…
    const io = new IntersectionObserver(
      ([e]) => { running = e.isIntersecting; if (running) start(); else stop(); },
      { threshold: 0.05 },
    );
    io.observe(canvas);

    // …and when the tab is hidden.
    const onVis = () => {
      if (document.hidden) { running = false; stop(); }
      else { running = true; start(); }
    };
    document.addEventListener("visibilitychange", onVis);
    if (document.hidden) running = false;

    start();

    return () => { stop(); io.disconnect(); document.removeEventListener("visibilitychange", onVis); };
  }, [deltaTone, size]);

  const c = TONES[deltaTone] || TONES.neutral;
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <div className="absolute inset-0 rounded-full" style={{ boxShadow: `0 0 70px 6px ${c.halo}` }} />
      <canvas ref={ref} className="relative h-full w-full" />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-display text-5xl font-bold leading-none text-white tabular-nums">{number}</span>
        <span className="mt-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#a0a0a0]">Biological Age</span>
        <span className="mt-1.5 text-sm font-medium" style={{ color: c.core }}>{deltaLabel}</span>
      </div>
    </div>
  );
}