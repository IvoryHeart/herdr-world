// Town navigation: pan, rotate, tilt and zoom for mouse, trackpad and touch.
// Every input moves a goal; the camera eases toward it, so motion stays smooth.
// Rotation snaps to the nearest 45° when released (unless snapping is off).
import * as THREE from '../vendor/three.module.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class TownControls {
  constructor(camera, dom, o = {}) {
    this.camera = camera;
    this.dom = dom;
    this.bounds = o.bounds || { x0: -5, x1: 5, z0: -5, z1: 5 };
    this.limits = { dMin: o.dMin ?? 7, dMax: o.dMax ?? 70, pMin: 0.3, pMax: 1.3 };
    this.home = { x: o.x ?? 0, z: o.z ?? 0, theta: o.theta ?? Math.PI / 4, phi: o.phi ?? 0.72, dist: o.dist ?? 40 };
    this.snap = true;
    this.step = Math.PI / 4;
    this.cur = { ...this.home };
    this.goal = { ...this.home };
    this.vel = { x: 0, z: 0 };
    this.pointers = new Map();
    this.gesture = null;
    this.onChange = o.onChange || (() => {});
    this.ray = new THREE.Raycaster();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.bind();
    this.apply();
  }

  // ---- goal setters ----
  rotateBy(a) { this.goal.theta += a; }
  quarter(dir) {
    const s = Math.PI / 2;
    this.goal.theta = Math.round(this.goal.theta / s) * s + dir * s;
  }
  zoomBy(k, sx, sy) {
    const before = this.goal.dist;
    this.goal.dist = clamp(this.goal.dist * k, this.limits.dMin, this.limits.dMax);
    // keep the point under the cursor fixed while zooming
    if (sx != null) {
      const p = this.pick(sx, sy);
      if (p) {
        const f = 1 - this.goal.dist / before;
        this.goal.x += (p.x - this.goal.x) * f;
        this.goal.z += (p.z - this.goal.z) * f;
      }
    }
  }
  tiltBy(a) { this.goal.phi = clamp(this.goal.phi + a, this.limits.pMin, this.limits.pMax); }
  cycleTilt() {
    const stops = [0.42, 0.72, 1.12];
    const i = stops.findIndex((s) => s > this.goal.phi + 0.05);
    this.goal.phi = stops[i < 0 ? 0 : i];
  }
  panScreen(dx, dy) {
    const { theta, phi, dist } = this.cur;
    const h = this.dom.clientHeight || 1;
    const wpp = (2 * dist * Math.tan((this.camera.fov * Math.PI) / 360)) / h;
    const rx = Math.cos(theta), rz = -Math.sin(theta); // screen right on the ground
    const fx = -Math.sin(theta), fz = -Math.cos(theta); // screen up on the ground (away from camera)
    const k = 1 / Math.max(0.35, Math.sin(phi));
    this.goal.x -= (rx * dx - fx * dy * k) * wpp;
    this.goal.z -= (rz * dx - fz * dy * k) * wpp;
  }
  snapNow() { if (this.snap) this.goal.theta = Math.round(this.goal.theta / this.step) * this.step; }
  reset() { Object.assign(this.goal, this.home, { theta: this.nearestHeading(this.home.theta) }); }
  north() { this.goal.theta = this.nearestHeading(this.home.theta); }
  nearestHeading(a) { return a + Math.round((this.goal.theta - a) / TAU) * TAU; }
  flyTo(x, z, dist) { this.goal.x = x; this.goal.z = z; if (dist) this.goal.dist = clamp(dist, this.limits.dMin, this.limits.dMax); }

  pick(sx, sy) {
    const r = this.dom.getBoundingClientRect();
    const v = new THREE.Vector2(((sx - r.left) / r.width) * 2 - 1, -((sy - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.ground, p) ? p : null;
  }

  // ---- per frame ----
  update(dt) {
    const k = 1 - Math.exp(-dt * 11);
    const g = this.goal, c = this.cur, b = this.bounds;
    if (!this.pointers.size) { g.x += this.vel.x * dt; g.z += this.vel.z * dt; this.vel.x *= Math.exp(-dt * 5); this.vel.z *= Math.exp(-dt * 5); }
    g.x = clamp(g.x, b.x0, b.x1); g.z = clamp(g.z, b.z0, b.z1);
    const moving = Math.abs(g.x - c.x) + Math.abs(g.z - c.z) + Math.abs(g.theta - c.theta) + Math.abs(g.phi - c.phi) + Math.abs(g.dist - c.dist) / 10 > 1e-4;
    for (const key of ['x', 'z', 'theta', 'phi', 'dist']) c[key] += (g[key] - c[key]) * k;
    this.apply();
    return moving;
  }
  apply() {
    const { x, z, theta, phi, dist } = this.cur;
    this.camera.position.set(x + Math.sin(theta) * Math.cos(phi) * dist, Math.sin(phi) * dist, z + Math.cos(theta) * Math.cos(phi) * dist);
    this.camera.lookAt(x, 0, z);
    this.onChange(this.cur);
  }

  // ---- input ----
  bind() {
    const el = this.dom;
    el.style.touchAction = 'none';
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e));
    el.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    el.addEventListener('dblclick', (e) => { const p = this.pick(e.clientX, e.clientY); if (p) this.flyTo(p.x, p.z, this.goal.dist * 0.55); });
    // Safari trackpad pinch and twist arrive as gesture events
    let g0 = null;
    el.addEventListener('gesturestart', (e) => { e.preventDefault(); g0 = { s: 1, r: 0 }; });
    el.addEventListener('gesturechange', (e) => {
      e.preventDefault(); if (!g0) return;
      this.zoomBy(g0.s / e.scale, e.clientX, e.clientY);
      this.rotateBy(((e.rotation - g0.r) * Math.PI) / 180);
      g0 = { s: e.scale, r: e.rotation };
    });
    el.addEventListener('gestureend', (e) => { e.preventDefault(); g0 = null; this.snapNow(); });
    window.addEventListener('keydown', (e) => this.key(e));
  }
  down(e) {
    this.dom.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
    this.vel = { x: 0, z: 0 };
    const rotate = e.pointerType === 'mouse' && (e.button === 2 || e.button === 1 || e.shiftKey || e.altKey);
    if (this.pointers.size === 1) this.mode = rotate ? 'rotate' : 'pan';
    if (this.pointers.size === 2) { this.mode = 'two'; this.two = this.twoState(); }
    this.lastMove = performance.now();
  }
  twoState() {
    const [a, b] = [...this.pointers.values()];
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
  }
  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    const now = performance.now(), dt = Math.max(1, now - this.lastMove) / 1000;
    this.lastMove = now;
    if (this.mode === 'pan' && this.pointers.size === 1) {
      const bx = this.goal.x, bz = this.goal.z;
      this.panScreen(dx, dy);
      this.vel = { x: ((this.goal.x - bx) / dt) * 0.6, z: ((this.goal.z - bz) / dt) * 0.6 };
    } else if (this.mode === 'rotate') {
      this.rotateBy(-dx * 0.0085);
      this.tiltBy(dy * 0.005);
    } else if (this.mode === 'two' && this.pointers.size === 2) {
      const s = this.twoState(), o = this.two;
      this.panScreen(s.cx - o.cx, s.cy - o.cy);
      if (s.d > 10 && o.d > 10) this.zoomBy(o.d / s.d, s.cx, s.cy);
      let da = s.ang - o.ang;
      if (da > Math.PI) da -= TAU; if (da < -Math.PI) da += TAU;
      this.rotateBy(da);
      this.two = s;
    }
  }
  up(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.mode === 'rotate' || this.mode === 'two') this.snapNow();
    if (this.pointers.size === 1) { this.mode = 'pan'; this.vel = { x: 0, z: 0 }; }
    if (!this.pointers.size) { this.mode = null; if (performance.now() - this.lastMove > 80) this.vel = { x: 0, z: 0 }; }
  }
  wheel(e) {
    e.preventDefault();
    const line = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * line, dy = e.deltaY * line;
    if (e.ctrlKey || e.metaKey) { this.zoomBy(Math.exp(dy * 0.012), e.clientX, e.clientY); return; } // trackpad pinch
    if (e.shiftKey || e.altKey) { this.rotateBy((dx || dy) * 0.004); clearTimeout(this.snapT); this.snapT = setTimeout(() => this.snapNow(), 220); return; }
    // a mouse wheel scrolls in coarse vertical notches; a trackpad scrolls finely on both axes
    const mouseWheel = e.deltaMode !== 0 || (dx === 0 && Math.abs(dy) >= 40 && Number.isInteger(dy));
    if (mouseWheel) this.zoomBy(Math.exp(dy * 0.0016), e.clientX, e.clientY);
    else this.panScreen(-dx, -dy);
  }
  key(e) {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    const pan = 60;
    if (k === 'q' || k === '[') this.quarter(-1);
    else if (k === 'e' || k === ']') this.quarter(1);
    else if (k === 'arrowleft' || k === 'a') this.panScreen(pan, 0);
    else if (k === 'arrowright' || k === 'd') this.panScreen(-pan, 0);
    else if (k === 'arrowup' || k === 'w') this.panScreen(0, pan);
    else if (k === 'arrowdown' || k === 's') this.panScreen(0, -pan);
    else if (k === '+' || k === '=') this.zoomBy(0.8);
    else if (k === '-' || k === '_') this.zoomBy(1.25);
    else if (k === 't') this.cycleTilt();
    else if (k === 'r' || k === '0') this.reset();
    else return;
    e.preventDefault();
  }
}
