// Shared helpers for the Town concept gallery: a frame loop that only runs
// while a canvas is on screen, seeded randomness, colour maths and an
// isometric camera. Every direction draws with plain Canvas 2D.

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = (t) => t * t * (3 - 2 * t);

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hex(c) {
  if (Array.isArray(c)) return c;
  if (c[0] === 'r') return c.slice(c.indexOf('(') + 1, -1).split(',').slice(0, 3).map(Number);
  if (c.length === 4) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function css(c, a = 1) {
  const [r, g, b] = hex(c);
  return a >= 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}
export function mix(a, b, t, alpha = 1) {
  const x = hex(a), y = hex(b);
  return css([lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)], alpha);
}
export function mixRGB(a, b, t) {
  const x = hex(a), y = hex(b);
  return [lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)];
}
// k > 0 lightens toward white, k < 0 darkens toward a warm black.
export function shade(c, k, alpha = 1) {
  return k >= 0 ? mix(c, '#ffffff', k, alpha) : mix(c, '#1a1210', -k, alpha);
}

// Isometric camera. World x runs down-right, y down-left, z up.
export function isoCam(w, h, { cx, cy, cz = 0, s }) {
  const C = 0.8660254;
  const ox = w / 2 - (cx - cy) * s * C;
  const oy = h / 2 - ((cx + cy) * s * 0.5 - cz * s);
  return {
    s, w, h, ox, oy,
    p(x, y, z = 0) { return [ox + (x - y) * s * C, oy + (x + y) * s * 0.5 - z * s]; },
    // Apply an affine map so drawing in (u, v) lands on a plane through o.
    face(ctx, o, u, v) {
      const O = this.p(o[0], o[1], o[2]);
      const U = this.p(o[0] + u[0], o[1] + u[1], o[2] + u[2]);
      const V = this.p(o[0] + v[0], o[1] + v[1], o[2] + v[2]);
      ctx.transform(U[0] - O[0], U[1] - O[1], V[0] - O[0], V[1] - O[1], O[0], O[1]);
    },
  };
}

export function poly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

export function rrect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// One canvas, one render(ctx, w, h, t, stage). Animates only while visible.
export class Stage {
  constructor(canvas, render, opts = {}) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.render = render;
    this.opts = opts;
    this.params = opts.params || {};
    this.t0 = performance.now() - (opts.offset || 0) * 1000;
    this.visible = false;
    this.pan = [0, 0];
    new ResizeObserver(() => this.resize()).observe(canvas);
    new IntersectionObserver((es) => {
      this.visible = es[es.length - 1].isIntersecting;
      if (this.visible) this.kick();
    }, { rootMargin: '80px' }).observe(canvas);
    if (opts.pan) this.enablePan();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.kick(); });
  }
  resize() {
    const r = this.c.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const d = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width; this.h = r.height; this.dpr = d;
    this.c.width = Math.round(r.width * d);
    this.c.height = Math.round(r.height * d);
    this.frame(performance.now());
  }
  kick() {
    if (this.raf || reduceMotion) return;
    const fps = this.opts.fps || 30;
    const loop = (now) => {
      this.raf = 0;
      if (!this.visible || document.hidden) return;
      if (now - (this.last || 0) >= 1000 / fps - 3) { this.last = now; this.frame(now); }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  frame(now) {
    if (!this.w) return;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    const t = reduceMotion ? (this.opts.stillT ?? 14) : (now - this.t0) / 1000;
    this.render(ctx, this.w, this.h, t, this);
  }
  set(p) { Object.assign(this.params, p); this.frame(performance.now()); }
  enablePan() {
    let start = null;
    this.c.style.touchAction = 'pan-y';
    this.c.addEventListener('pointerdown', (e) => { start = [e.clientX, e.clientY, this.pan[0], this.pan[1]]; this.c.setPointerCapture(e.pointerId); });
    this.c.addEventListener('pointermove', (e) => {
      if (!start) return;
      this.pan = [start[2] + e.clientX - start[0], start[3] + (this.opts.pan === 'x' ? 0 : e.clientY - start[1])];
      this.frame(performance.now());
    });
    const end = () => { start = null; };
    this.c.addEventListener('pointerup', end);
    this.c.addEventListener('pointercancel', end);
  }
}

// Wire a page: every <canvas data-view="..."> gets a Stage running scene.render
// with that view's params; [data-set] buttons change params on their target.
export function mountPage(scene) {
  const stages = new Map();
  document.querySelectorAll('canvas[data-view]').forEach((c, i) => {
    const params = JSON.parse(c.dataset.params || '{}');
    params.view = c.dataset.view;
    const st = new Stage(c, (ctx, w, h, t, s) => { s.params.pan = s.pan; scene.render(ctx, w, h, t, s.params, s); }, {
      params, fps: Number(c.dataset.fps || 30), pan: c.dataset.pan || false, offset: i * 3.7,
      stillT: Number(c.dataset.still || 14),
    });
    if (c.id) stages.set(c.id, st);
  });
  document.querySelectorAll('[data-set]').forEach((b) => {
    b.addEventListener('click', () => {
      const st = stages.get(b.dataset.target);
      if (!st) return;
      const [k, v] = b.dataset.set.split('=');
      st.set({ [k]: v });
      b.parentElement.querySelectorAll(`[data-set^="${k}="]`).forEach((o) => o.setAttribute('aria-pressed', o === b ? 'true' : 'false'));
    });
  });
  return stages;
}

// The shared synthetic cast. Names are made up; nothing here is a real host.
export const HARNESS = {
  claude: { label: 'Claude' },
  codex: { label: 'Codex' },
  gemini: { label: 'Gemini' },
  rex: { label: 'Rex' },
};
export const STATES = [
  ['working', 'Working at a desk'],
  ['thinking', 'Thinking'],
  ['needs', 'Needs you'],
  ['done', 'Done, to review'],
  ['idle', 'Idle at the bar'],
  ['walking', 'Walking'],
  ['bus', 'Riding the bus'],
  ['asleep', 'Asleep, resumable'],
];
