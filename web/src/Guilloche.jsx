import { useEffect, useRef } from "react";

// Guilloche: the lace of fine interlocking curves engraved on banknotes so they are hard to copy.
// Here it is the paper the pay sheet lies on. It turns very slowly, and stops when off screen.
function draw(ctx, w, h, t) {
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = 0.6;
  const rosette = (cx, cy, R, lobes, depth, rings, phase, alpha) => {
    for (let k = 0; k < rings; k++) {
      const p = phase + (k / rings) * Math.PI * 2;
      ctx.beginPath();
      for (let i = 0; i <= 720; i++) {
        const a = (i / 720) * Math.PI * 2;
        const r = R * (1 + depth * Math.sin(lobes * a + p) + depth * 0.45 * Math.sin(lobes * 2.5 * a - p * 1.7));
        const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.strokeStyle = `rgba(13, 90, 60, ${alpha})`;
      ctx.stroke();
    }
  };
  const m = Math.max(w, h);
  rosette(w * 0.78, h * 0.42, m * 0.34, 12, 0.16, 26, t, 0.17);
  rosette(w * 0.78, h * 0.42, m * 0.2, 18, 0.2, 18, -t * 1.4, 0.2);
  rosette(w * 0.08, h * 0.95, m * 0.26, 9, 0.22, 20, t * 0.8, 0.12);
  // The ribbon: a band of crossing waves along the bottom edge, as on a certificate border.
  for (let k = 0; k < 14; k++) {
    ctx.beginPath();
    for (let x = 0; x <= w; x += 4) {
      const y = h - 34 + 16 * Math.sin(x / 46 + (k / 14) * Math.PI * 2 + t * 2) * Math.cos(x / 310 + k * 0.2);
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = "rgba(13, 90, 60, 0.13)";
    ctx.stroke();
  }
}

export default function Guilloche({ className }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf, visible = true, w = 0, h = 0, last = 0;
    const size = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(ctx, w, h, performance.now() / 60000);
    };
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      if (!visible || now - last < 50) return; // 20 frames a second is plenty for a slow turn
      last = now;
      draw(ctx, w, h, now / 60000);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(canvas);
    if (!still) raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, []);
  return <canvas ref={ref} aria-hidden="true" className={className} />;
}
