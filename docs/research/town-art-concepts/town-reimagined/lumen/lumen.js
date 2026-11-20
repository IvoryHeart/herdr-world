// Direction 2 · Lumen: a town of glass and light on a floating mirror disc.
// Buildings are clear glass you can see into. Agents are small beings of
// light, and their state is how they glow: a question is a pillar of amber
// light you can spot from across town. Day is pearl and frosted; night is the
// native mode.
import { TAU, rng, isoCam, poly, rrect, mix, css, hex, lerp, clamp, ease } from '../lib.js';

export const HARNESS_COL = { claude: '#ff8a5c', codex: '#5ab0ff', gemini: '#b98cff', rex: '#5ff0a6' };
const PROJ = { world: '#ffd166', crew: '#ff7b9c', docs: '#4fe3d0', lab: '#b98cff', site: '#7cf29a', api: '#7aa8ff', ops: '#ffb36b' };
const AMBER = '#ffbf3c', GREEN = '#5ff0a6';
const CX = 12.5, CY = 11, R = 15.5;
const FONT = '"Space Grotesk", "Inter", system-ui, sans-serif';

const AG = (n, h, s) => ({ n, h, s });
const A = {
  scout: AG('scout', 'claude', 'working'), wren: AG('wren', 'codex', 'working'), juniper: AG('juniper', 'claude', 'thinking'),
  otter: AG('otter', 'gemini', 'working'), pixel: AG('pixel', 'codex', 'thinking'), hazel: AG('hazel', 'codex', 'working'),
  maple: AG('maple', 'claude', 'needs'), sable: AG('sable', 'codex', 'needs'), lark: AG('lark', 'rex', 'done'),
  kite: AG('kite', 'rex', 'working'), moss: AG('moss', 'claude', 'idle'), ember: AG('ember', 'codex', 'idle'), fern: AG('fern', 'gemini', 'idle'),
  fig: AG('fig', 'gemini', 'walking'), quill: AG('quill', 'claude', 'walking'), tansy: AG('tansy', 'codex', 'asleep'),
  bram: AG('bram', 'claude', 'asleep'), olive: AG('olive', 'gemini', 'asleep'), sorrel: AG('sorrel', 'rex', 'needs'),
};

const PAL = {
  day: { sky: ['#f6f3fb', '#dfe4f3', '#cdd5ec'], floor: '#eef1f8', floor2: '#dfe5f2', glass: [225, 233, 255], ga: 0.3, edge: '#7d8cc2', edge2: 'rgba(110,125,175,0.35)', glow: 0.55, add: false, ink: '#3b4566', road: 'rgba(160,175,215,0.35)', sea: '#bcd6ea', refl: 0.22, star: 0 },
  dusk: { sky: ['#20183f', '#6a3c6e', '#f19a72'], floor: '#1c1730', floor2: '#2a2140', glass: [255, 200, 220], ga: 0.12, edge: '#ffd9e6', edge2: 'rgba(255,190,210,0.35)', glow: 0.85, add: true, ink: '#ffe8f0', road: 'rgba(255,170,200,0.18)', sea: '#2a2148', refl: 0.4, star: 0.3 },
  night: { sky: ['#03040c', '#0a0f2a', '#141b45'], floor: '#05070f', floor2: '#0a0e1d', glass: [150, 220, 255], ga: 0.08, edge: '#9fefff', edge2: 'rgba(120,220,255,0.28)', glow: 1, add: true, ink: '#d9f6ff', road: 'rgba(110,200,255,0.14)', sea: '#060c1c', refl: 0.5, star: 1 },
};

function inDisc(x, y, pad = 0) { return Math.hypot(x - CX, y - CY) < R - pad; }
const BLOCK = [
  { x0: 2.6, y0: 2.6, x1: 7.8, y1: 10 }, { x0: 8.6, y0: 0.8, x1: 11, y1: 3.2 }, { x0: 14.8, y0: 1.4, x1: 19.4, y1: 7.4 }, { x0: 2.8, y0: 12.8, x1: 8.2, y1: 18.2 },
  { x0: 7.2, y0: 17.2, x1: 11.8, y1: 22 }, { x0: 14.4, y0: 15.4, x1: 18.8, y1: 19.6 }, { x0: 18.6, y0: 12.4, x1: 22.6, y1: 17 },
  { x0: 19.4, y0: 6.2, x1: 22.6, y1: 9.4 }, { x0: 13.2, y0: 16, x1: 15, y1: 18.4 },
];
function blocked(x, y, pad) {
  if (Math.hypot(x - CX, y - CY) < 5.6 + pad) return true;
  if (Math.abs(y - 11) < 0.9 + pad || Math.abs(x - 12.5) < 0.9 + pad) return true;
  if (x > 22.4 - pad) return true;
  return BLOCK.some((b) => x > b.x0 - pad && x < b.x1 + pad && y > b.y0 - pad && y < b.y1 + pad);
}
const CRYSTALS = (() => {
  const r = rng(77), out = [];
  for (let i = 0; i < 900 && out.length < 46; i++) {
    const x = CX - R + r() * 2 * R, y = CY - R + r() * 2 * R;
    if (!inDisc(x, y, 1.2) || blocked(x, y, 0.4)) continue;
    if (out.some((o) => Math.hypot(o.x - x, o.y - y) < 1.1)) continue;
    out.push({ x, y, h: 0.7 + r() * 1.3, k: r() });
  }
  return out;
})();

export function createLumen() {
  let refl = null, frameNo = 0;
  return { render, drawWisp: wisp, HARNESS_COL };

  function render(ctx, w, h, t, P) {
    const view = P.view || 'hero';
    if (view === 'sheet') return sheet(ctx, w, h, t);
    const time = P.time || (view === 'night' ? 'night' : view === 'phone' ? 'night' : 'night');
    const weather = P.weather || (view === 'night' ? 'rain' : 'clear');
    const pal = PAL[time];
    const cam = camera(w, h, view, P.pan);
    const G = { ctx, cam, t, pal, time, weather, view, L: [] };

    sky(ctx, w, h, t, pal, weather);
    // reflection pass into an offscreen buffer, refreshed every other frame
    frameNo++;
    const dpr = ctx.getTransform().a;
    if (!refl) refl = document.createElement('canvas');
    if (refl.width !== Math.round(w * dpr / 2) || refl.height !== Math.round(h * dpr / 2) || frameNo % 2 === 0 || refl._key !== time + view) {
      refl._key = time + view;
      refl.width = Math.round(w * dpr / 2); refl.height = Math.round(h * dpr / 2);
      const rc = refl.getContext('2d');
      rc.setTransform(dpr / 2, 0, 0, dpr / 2, 0, 0);
      const camR = Object.assign({}, cam, { p: (x, y, z = 0) => cam.p(x, y, -z), face: cam.face });
      const GR = { ...G, ctx: rc, cam: camR, L: [], mirror: true };
      drawObjects(GR);
    }
    disc(G, () => {
      ctx.save();
      ctx.globalAlpha = pal.refl;
      ctx.filter = 'blur(1.2px)';
      ctx.drawImage(refl, 0, 0, w, h);
      ctx.restore();
    });
    roads(G);
    sea(G);
    drawObjects(G);
    beams(G);
    // light pass
    ctx.save();
    ctx.globalCompositeOperation = pal.add ? 'lighter' : 'source-over';
    for (const fn of G.L) fn(ctx, pal.glow);
    ctx.restore();
    if (weather === 'rain') rain(G, w, h);
    if (weather === 'snow') snow(G, w, h);
    // lens vignette
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.4, w / 2, h / 2, Math.max(w, h) * 0.8);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, time === 'day' ? 'rgba(90,100,140,0.18)' : 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
  }

  function camera(w, h, view, pan) {
    const fit = Math.min(w / (2.45 * R * 1.04), h / (1.414 * R + 9));
    const f = {
      hero: [12.5, 11, 3.2, 1], night: [12.5, 11, 3.2, 1], office: [5.4, 6.4, 3.2, 3.0], hall: [12.5, 11.2, 3.2, 2.6],
      post: [9.4, 4.2, 3.6, 2.4], harbor: [22.5, 13, 1.5, 2.1], apartments: [7.4, 17.4, 1.4, 2.5], phone: [7.5, 8.5, 2.6, 2.2],
    }[view] || [12.5, 11, 3.2, 1];
    let s = fit * f[3];
    if (view === 'phone') s = w / 9;
    let cx = f[0], cy = f[1];
    if (pan && (pan[0] || pan[1])) { cx -= (pan[0] / s / 0.866 + pan[1] / s * 2) / 2; cy -= (-pan[0] / s / 0.866 + pan[1] / s * 2) / 2; }
    return isoCam(w, h, { cx, cy, cz: f[2], s });
  }

  // ---------- light helpers ----------
  function glow(G, x, y, r, col, a = 1) {
    G.L.push((c, k) => {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, css(col, clamp(a * k, 0, 1))); g.addColorStop(0.35, css(col, clamp(a * k * 0.35, 0, 1))); g.addColorStop(1, css(col, 0));
      c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }
  function ellipseAt(ctx, cam, x, y, z, r) {
    const c = cam.p(x, y, z);
    ctx.ellipse(c[0], c[1], r * cam.s * 1.2247, r * cam.s * 0.7071, 0, 0, TAU);
  }

  // ---------- sky, disc, roads ----------
  function sky(ctx, w, h, t, pal, weather) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, pal.sky[0]); g.addColorStop(0.55, pal.sky[1]); g.addColorStop(1, pal.sky[2]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    if (pal.star) {
      const r = rng(4);
      for (let i = 0; i < 160; i++) {
        const x = r() * w, y = r() * h * 0.8, tw = 0.5 + 0.5 * Math.sin(t * (0.5 + r() * 2) + i);
        ctx.fillStyle = `rgba(220,235,255,${(0.15 + 0.55 * tw * r()) * pal.star * (weather === 'clear' ? 1 : 0.3)})`;
        ctx.fillRect(x, y, r() < 0.1 ? 2 : 1, r() < 0.1 ? 2 : 1);
      }
      // aurora ribbons
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        for (let x = 0; x <= w; x += 12) {
          const y = h * (0.12 + k * 0.05) + Math.sin(x * 0.004 + t * 0.15 + k) * h * 0.05 + Math.sin(x * 0.011 - t * 0.1) * h * 0.015;
          x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.strokeStyle = ['rgba(80,255,190,0.06)', 'rgba(120,160,255,0.06)', 'rgba(200,120,255,0.05)'][k];
        ctx.lineWidth = h * 0.06; ctx.stroke();
      }
      ctx.restore();
    } else {
      const sg = ctx.createRadialGradient(w * 0.78, h * 0.12, 0, w * 0.78, h * 0.12, h * 0.6);
      sg.addColorStop(0, 'rgba(255,240,220,0.9)'); sg.addColorStop(1, 'rgba(255,240,220,0)');
      ctx.fillStyle = sg; ctx.fillRect(0, 0, w, h);
    }
  }
  function discPath(ctx, cam, z = 0, r = R) { ctx.beginPath(); ellipseAt(ctx, cam, CX, CY, z, r); }
  function disc(G, reflect) {
    const { ctx, cam, pal, t, time } = G;
    // underside: a light column falling away into the void
    const c0 = cam.p(CX, CY, 0);
    const col = ctx.createLinearGradient(0, c0[1], 0, c0[1] + cam.s * 14);
    col.addColorStop(0, time === 'day' ? 'rgba(150,170,220,0.35)' : 'rgba(90,200,255,0.18)'); col.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(c0[0] - R * cam.s * 1.0, c0[1]); ctx.lineTo(c0[0] + R * cam.s * 1.0, c0[1]); ctx.lineTo(c0[0] + R * cam.s * 0.3, c0[1] + cam.s * 14); ctx.lineTo(c0[0] - R * cam.s * 0.3, c0[1] + cam.s * 14); ctx.fill();
    // thick glass edge of the disc
    ctx.save();
    discPath(ctx, cam, -0.7); ctx.fillStyle = time === 'day' ? '#c7cfe6' : '#0b1430'; ctx.fill();
    const e = cam.p(CX, CY, -0.35);
    const eg = ctx.createLinearGradient(e[0] - R * cam.s * 1.2, 0, e[0] + R * cam.s * 1.2, 0);
    eg.addColorStop(0, time === 'day' ? 'rgba(255,255,255,0.9)' : 'rgba(120,230,255,0.5)'); eg.addColorStop(0.5, 'rgba(255,255,255,0.05)'); eg.addColorStop(1, time === 'day' ? 'rgba(255,255,255,0.7)' : 'rgba(180,120,255,0.45)');
    ctx.strokeStyle = eg; ctx.lineWidth = cam.s * 0.7;
    discPath(ctx, cam, -0.35); ctx.stroke();
    // floor
    discPath(ctx, cam, 0);
    const fg = ctx.createRadialGradient(c0[0], c0[1], 0, c0[0], c0[1], R * cam.s * 1.3);
    fg.addColorStop(0, pal.floor2); fg.addColorStop(1, pal.floor);
    ctx.fillStyle = fg; ctx.fill();
    ctx.clip();
    reflect();
    // fine grid etched in the floor
    ctx.strokeStyle = time === 'day' ? 'rgba(120,140,200,0.12)' : 'rgba(120,200,255,0.06)'; ctx.lineWidth = 1;
    for (let i = -16; i <= 16; i++) {
      let a = cam.p(CX + i, CY - R, 0.01), b = cam.p(CX + i, CY + R, 0.01); ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
      a = cam.p(CX - R, CY + i, 0.01); b = cam.p(CX + R, CY + i, 0.01); ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
    }
    ctx.restore();
    // rim light with slow ticks, like a dial
    ctx.save();
    ctx.strokeStyle = pal.edge; ctx.globalAlpha = 0.8; ctx.lineWidth = 1.2;
    discPath(ctx, cam, 0.02); ctx.stroke();
    ctx.globalAlpha = 0.45; ctx.setLineDash([2, 10]); ctx.lineDashOffset = -t * 6; ctx.lineWidth = 3;
    discPath(ctx, cam, 0.02, R + 0.6); ctx.stroke();
    ctx.restore();
    G.L.push((c, k) => { c.save(); c.strokeStyle = css(time === 'day' ? '#ffffff' : '#6fe0ff', 0.25 * k); c.lineWidth = cam.s * 0.5; c.filter = `blur(${cam.s * 0.3}px)`; discPath(c, cam, 0.02); c.stroke(); c.restore(); });
  }
  function roads(G) {
    const { ctx, cam, pal, t } = G;
    ctx.save();
    discPath(ctx, cam, 0); ctx.clip();
    const lane = (pts) => { poly(ctx, pts.map((q) => cam.p(q[0], q[1], 0.02))); ctx.fillStyle = pal.road; ctx.fill(); };
    lane([[CX - R, 10.45], [23, 10.45], [23, 11.55], [CX - R, 11.55]]);
    lane([[11.95, CY - R], [13.05, CY - R], [13.05, CY + R], [11.95, CY + R]]);
    // ring road
    ctx.beginPath(); ellipseAt(ctx, cam, CX, CY, 0.02, 5.15); ellipseAt(ctx, cam, CX, CY, 0.02, 4.05);
    ctx.fillStyle = pal.road; ctx.fill('evenodd');
    // flowing light packets along the lanes
    const packet = (x, y, col) => { const q = cam.p(x, y, 0.05); ctx.fillStyle = col; ctx.fillRect(q[0] - 1.5, q[1] - 1, 3, 2); glow(G, q[0], q[1], cam.s * 0.5, col, 0.5); };
    for (let i = 0; i < 14; i++) {
      const k = ((t * 0.06 + i / 14) % 1);
      packet(lerp(CX - R + 1, 22.8, k), 10.75, '#7fe7ff');
      packet(lerp(22.8, CX - R + 1, k), 11.25, '#ffb07f');
      const yy = lerp(CY - R + 1, CY + R - 1, k);
      if (Math.abs(yy - CY) > 5.2) packet(12.25, yy, '#b8a0ff');
    }
    for (let i = 0; i < 18; i++) { const a = (i / 18) * TAU + t * 0.15; packet(CX + Math.cos(a) * 4.6, CY + Math.sin(a) * 4.6, i % 3 ? '#7fe7ff' : '#ff9ad5'); }
    // edge lines
    ctx.strokeStyle = pal.edge2; ctx.lineWidth = 1;
    ctx.beginPath(); ellipseAt(ctx, cam, CX, CY, 0.02, 5.15); ctx.stroke();
    ctx.beginPath(); ellipseAt(ctx, cam, CX, CY, 0.02, 4.05); ctx.stroke();
    ctx.restore();
  }

  // ---------- glass primitives ----------
  function gfill(G, a = 1) { const g = G.pal.glass; return `rgba(${g[0]},${g[1]},${g[2]},${G.pal.ga * a})`; }
  function glass(G, x0, y0, x1, y1, z0, z1, o = {}) {
    const { ctx, cam, pal } = G, p = cam.p.bind(cam);
    const tint = o.tint;
    const fillA = (a) => tint ? css(tint, pal.add ? a * pal.ga * 2.0 : a * 0.2) : gfill(G, a);
    // back faces
    poly(ctx, [p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1)]); ctx.fillStyle = fillA(0.6); ctx.fill();
    poly(ctx, [p(x0, y0, z0), p(x0, y1, z0), p(x0, y1, z1), p(x0, y0, z1)]); ctx.fillStyle = fillA(0.75); ctx.fill();
    if (o.inner) o.inner();
    // front faces with a vertical sheen
    const F = [[p(x0, y1, z0), p(x1, y1, z0), p(x1, y1, z1), p(x0, y1, z1)], [p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1)]];
    F.forEach((f, i) => {
      poly(ctx, f);
      const g = ctx.createLinearGradient(0, f[2][1], 0, f[0][1]);
      g.addColorStop(0, fillA(i ? 1.6 : 1.1)); g.addColorStop(1, fillA(i ? 0.8 : 0.5));
      ctx.fillStyle = g; ctx.fill();
    });
    // a specular streak across the left face
    if (!G.mirror) {
      ctx.save(); poly(ctx, F[0]); ctx.clip();
      const k = ((G.t * 0.05 + x0 * 0.13) % 1.6) - 0.3;
      const a = p(lerp(x0, x1, k), y1, z0), b = p(lerp(x0, x1, k + 0.25), y1, z1);
      ctx.strokeStyle = pal.add ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.5)'; ctx.lineWidth = cam.s * 0.6;
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
      ctx.restore();
    }
    // top
    poly(ctx, [p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)]); ctx.fillStyle = fillA(1.2); ctx.fill();
    // edges: back edges faint, front edges bright
    ctx.lineJoin = 'round';
    ctx.strokeStyle = pal.edge2; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [a, b] of [[[x0, y0, z0], [x1, y0, z0]], [[x0, y0, z0], [x0, y1, z0]], [[x0, y0, z0], [x0, y0, z1]]]) { ctx.moveTo(...p(...a)); ctx.lineTo(...p(...b)); }
    ctx.stroke();
    ctx.strokeStyle = o.edge || pal.edge; ctx.lineWidth = o.lw || 1.3;
    ctx.beginPath();
    const E = [[[x0, y1, z0], [x1, y1, z0]], [[x1, y1, z0], [x1, y0, z0]], [[x0, y1, z0], [x0, y1, z1]], [[x1, y1, z0], [x1, y1, z1]], [[x1, y0, z0], [x1, y0, z1]],
      [[x0, y0, z1], [x1, y0, z1]], [[x1, y0, z1], [x1, y1, z1]], [[x1, y1, z1], [x0, y1, z1]], [[x0, y1, z1], [x0, y0, z1]]];
    for (const [a, b] of E) { ctx.moveTo(...p(...a)); ctx.lineTo(...p(...b)); }
    ctx.stroke();
    if (!G.mirror && pal.add) {
      const top = p((x0 + x1) / 2, (y0 + y1) / 2, z1);
      G.L.push((c, k) => { c.save(); c.strokeStyle = css(o.edge || pal.edge, 0.22 * k); c.lineWidth = 4; c.beginPath(); for (const [a, b] of E.slice(5)) { c.moveTo(...p(...a)); c.lineTo(...p(...b)); } c.stroke(); c.restore(); });
    }
  }
  function slab(G, x0, y0, x1, y1, z, col, lit) {
    const { ctx, cam, pal } = G, p = cam.p.bind(cam);
    const pts = [p(x0, y0, z), p(x1, y0, z), p(x1, y1, z), p(x0, y1, z)];
    poly(ctx, pts);
    ctx.fillStyle = lit ? css(col, pal.add ? 0.22 : 0.45) : (pal.add ? 'rgba(140,170,220,0.05)' : 'rgba(170,180,210,0.25)');
    ctx.fill();
    ctx.strokeStyle = lit ? css(col, 0.9) : pal.edge2; ctx.lineWidth = lit ? 1.4 : 1; ctx.stroke();
    if (lit && !G.mirror) {
      G.L.push((c, k) => { poly(c, pts); c.fillStyle = css(col, 0.07 * k); c.fill(); });
      const m = p((x0 + x1) / 2, (y0 + y1) / 2, z + 0.6);
      glow(G, m[0], m[1], cam.s * 2.2, col, 0.16);
    }
  }
  function cyl(G, x, y, r, z0, z1, col, o = {}) {
    const { ctx, cam, pal } = G;
    const b = cam.p(x, y, z0), tp = cam.p(x, y, z1), rx = r * cam.s * 1.2247, ry = r * cam.s * 0.7071;
    const fill = (a) => col ? css(col, pal.add ? a : a * 0.55) : gfill(G, a * 3);
    ctx.beginPath(); ctx.ellipse(b[0], b[1], rx, ry, 0, 0, TAU); ctx.fillStyle = fill(pal.add ? 0.06 : 0.12); ctx.fill();
    if (o.inner) o.inner();
    ctx.beginPath(); ctx.moveTo(b[0] - rx, b[1]); ctx.ellipse(b[0], b[1], rx, ry, 0, Math.PI, 0, true); ctx.lineTo(tp[0] + rx, tp[1]); ctx.ellipse(tp[0], tp[1], rx, ry, 0, 0, Math.PI, false); ctx.closePath();
    const g = ctx.createLinearGradient(b[0] - rx, 0, b[0] + rx, 0);
    g.addColorStop(0, fill(pal.add ? 0.16 : 0.4)); g.addColorStop(0.3, fill(pal.add ? 0.05 : 0.15)); g.addColorStop(0.8, fill(pal.add ? 0.1 : 0.3)); g.addColorStop(1, fill(pal.add ? 0.22 : 0.5));
    ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); ctx.ellipse(tp[0], tp[1], rx, ry, 0, 0, TAU); ctx.fillStyle = fill(pal.add ? 0.12 : 0.35); ctx.fill();
    ctx.strokeStyle = o.edge || pal.edge; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(b[0], b[1], rx, ry, 0, 0, Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(b[0] - rx, b[1]); ctx.lineTo(tp[0] - rx, tp[1]); ctx.moveTo(b[0] + rx, b[1]); ctx.lineTo(tp[0] + rx, tp[1]); ctx.strokeStyle = pal.edge2; ctx.stroke();
  }
  function holoText(G, x, y, text, size, col, o = {}) {
    const { ctx } = G;
    ctx.save();
    ctx.font = `${o.weight || 600} ${size}px ${FONT}`; ctx.textAlign = o.align || 'center'; ctx.textBaseline = 'middle';
    if (o.plate) {
      const tw = ctx.measureText(text).width, pw = tw + size * 1.0, ph = size * 1.55;
      const px = o.align === 'left' ? x - size * 0.5 : x - pw / 2;
      ctx.fillStyle = G.pal.add ? 'rgba(8,14,32,0.62)' : 'rgba(255,255,255,0.72)';
      rrect(ctx, px, y - ph / 2, pw, ph, ph / 2); ctx.fill();
      ctx.strokeStyle = css(col, 0.7); ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.fillStyle = o.fill || col; ctx.fillText(text, x, y + 0.5);
    ctx.restore();
  }

  // ---------- agents: beings of light ----------
  function wisp(ctx, x, y, u, a, t, o = {}, G = null) {
    const col = HARNESS_COL[a.h] || '#fff';
    const s = o.state || a.s;
    const ph = (a.n.charCodeAt(0) * 0.71 + a.n.length) % TAU;
    const add = G ? G.pal.add : true;
    const lift = s === 'asleep' ? 0 : (0.12 + Math.sin(t * 2 + ph) * 0.06) * u;
    const dim = s === 'asleep' ? 0.35 + 0.15 * Math.sin(t * 0.8 + ph) : s === 'idle' ? 0.75 : 1;
    const pulse = s === 'working' ? 0.85 + 0.15 * Math.sin(t * 6 + ph) : s === 'needs' ? 0.8 + 0.2 * Math.sin(t * 5 + ph) : 1;
    // ground pool
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, 0.45);
    const pg = ctx.createRadialGradient(0, 0, 0, 0, 0, u * 0.9);
    pg.addColorStop(0, css(col, 0.5 * dim)); pg.addColorStop(1, css(col, 0));
    ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(0, 0, u * 0.9, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(x, y - lift);
    if (o.flip) ctx.scale(-1, 1);
    if (s === 'asleep') ctx.rotate(-1.25);
    // halo
    const hg = ctx.createRadialGradient(0, -u * 0.9, 0, 0, -u * 0.9, u * 1.5);
    hg.addColorStop(0, css(col, (add ? 0.45 : 0.3) * dim * pulse)); hg.addColorStop(1, css(col, 0));
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(0, -u * 0.9, u * 1.5, 0, TAU); ctx.fill();
    // body: a teardrop of light
    const step = s === 'walking' ? Math.sin(t * 8 + ph) * 0.08 : 0;
    ctx.beginPath();
    ctx.moveTo(0, -u * 0.05);
    ctx.bezierCurveTo(u * (0.42 + step), -u * 0.25, u * 0.4, -u * 0.95, 0, -u * 1.08);
    ctx.bezierCurveTo(-u * 0.4, -u * 0.95, -u * (0.42 - step), -u * 0.25, 0, -u * 0.05);
    const bg = ctx.createLinearGradient(0, -u * 1.1, 0, 0);
    bg.addColorStop(0, css(mix(col, '#ffffff', 0.55), dim)); bg.addColorStop(0.6, css(col, 0.9 * dim)); bg.addColorStop(1, css(col, 0.15 * dim));
    ctx.fillStyle = bg; ctx.fill();
    // head orb with a visor
    const hy = -u * 1.42;
    ctx.beginPath(); ctx.arc(0, hy, u * 0.3, 0, TAU);
    const og = ctx.createRadialGradient(-u * 0.08, hy - u * 0.1, 0, 0, hy, u * 0.32);
    og.addColorStop(0, css('#ffffff', dim)); og.addColorStop(0.7, css(mix(col, '#ffffff', 0.4), dim)); og.addColorStop(1, css(col, dim));
    ctx.fillStyle = og; ctx.fill();
    ctx.fillStyle = add ? 'rgba(6,10,26,0.85)' : 'rgba(40,50,80,0.85)';
    rrect(ctx, -u * 0.22, hy - u * 0.06, u * 0.44, u * 0.15, u * 0.075); ctx.fill();
    if (s !== 'asleep') {
      const blink = Math.sin(t * 0.9 + ph * 2) > 0.97 ? 0.2 : 1;
      ctx.fillStyle = css(mix(col, '#ffffff', 0.7));
      const look = s === 'thinking' ? Math.sin(t * 0.8) * u * 0.05 : 0;
      ctx.fillRect(-u * 0.13 + look, hy - u * 0.02, u * 0.07, u * 0.07 * blink); ctx.fillRect(u * 0.06 + look, hy - u * 0.02, u * 0.07, u * 0.07 * blink);
    }
    // harness mark: the shape of the halo ring above the head
    ctx.strokeStyle = css(mix(col, '#ffffff', 0.5), 0.9 * dim); ctx.lineWidth = Math.max(1, u * 0.05);
    const ry = hy - u * 0.5, spin = t * 0.8 + ph;
    ctx.beginPath();
    if (a.h === 'claude') { ctx.ellipse(0, ry, u * 0.3, u * 0.09, 0, 0, TAU); ctx.stroke(); for (let i = 0; i < 6; i++) { const an = spin + (i / 6) * TAU; ctx.fillStyle = css('#ffffff', 0.8 * dim); ctx.fillRect(Math.cos(an) * u * 0.3 - 1, ry + Math.sin(an) * u * 0.09 - 1, 2, 2); } }
    else if (a.h === 'codex') { ctx.moveTo(-u * 0.24, ry); ctx.lineTo(0, ry - u * 0.1); ctx.lineTo(u * 0.24, ry); ctx.lineTo(0, ry + u * 0.1); ctx.closePath(); ctx.stroke(); }
    else if (a.h === 'gemini') { for (const sgn of [-1, 1]) { const an = spin * 1.5 + (sgn > 0 ? Math.PI : 0); ctx.moveTo(Math.cos(an) * u * 0.32 + u * 0.06, ry + Math.sin(an) * u * 0.1); ctx.arc(Math.cos(an) * u * 0.32, ry + Math.sin(an) * u * 0.1, u * 0.06, 0, TAU); } ctx.fillStyle = css('#ffffff', dim); ctx.fill(); }
    else { ctx.moveTo(-u * 0.22, ry + u * 0.06); ctx.lineTo(0, ry - u * 0.14); ctx.lineTo(u * 0.22, ry + u * 0.06); ctx.closePath(); ctx.stroke(); }
    ctx.restore();
    // state effects that live in world space
    const top = y - lift - u * 2.0;
    if (s === 'thinking') {
      for (let i = 0; i < 5; i++) {
        const an = t * 2.2 + (i / 5) * TAU;
        ctx.fillStyle = css(mix(col, '#ffffff', 0.6), 0.5 + 0.5 * Math.sin(an));
        ctx.beginPath(); ctx.arc(x + Math.cos(an) * u * 0.55, y - lift - u * 1.45 + Math.sin(an) * u * 0.18, u * 0.06 + Math.sin(an) * u * 0.02, 0, TAU); ctx.fill();
      }
    }
    if (s === 'done') {
      const k = (t * 0.6 + ph) % 1;
      ctx.strokeStyle = css(GREEN, 1 - k); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y, u * (0.4 + k * 1.2), u * (0.18 + k * 0.54), 0, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(8,24,18,0.75)'; ctx.beginPath(); ctx.arc(x + u * 0.55, top + u * 0.4, u * 0.24, 0, TAU); ctx.fill();
      ctx.strokeStyle = GREEN; ctx.lineWidth = Math.max(1.5, u * 0.07);
      ctx.beginPath(); ctx.moveTo(x + u * 0.44, top + u * 0.4); ctx.lineTo(x + u * 0.52, top + u * 0.48); ctx.lineTo(x + u * 0.67, top + u * 0.3); ctx.stroke();
    }
    if (s === 'needs') {
      // the beacon: an amber column of light rising out of the agent
      const bh = o.beam ?? u * 9;
      const bg2 = ctx.createLinearGradient(0, y - lift - u * 1.8 - bh, 0, y - lift - u * 1.2);
      bg2.addColorStop(0, css(AMBER, 0)); bg2.addColorStop(1, css(AMBER, add ? 0.55 : 0.75));
      ctx.fillStyle = bg2; ctx.fillRect(x - u * 0.09, y - lift - u * 1.8 - bh, u * 0.18, bh + u * 0.6);
      ctx.fillStyle = bg2; ctx.globalAlpha = 0.35; ctx.fillRect(x - u * 0.3, y - lift - u * 1.8 - bh, u * 0.6, bh + u * 0.6); ctx.globalAlpha = 1;
      const qy = top - u * 0.15 + Math.sin(t * 3 + ph) * u * 0.08;
      ctx.fillStyle = add ? 'rgba(30,18,0,0.75)' : 'rgba(255,248,230,0.9)'; ctx.beginPath(); ctx.arc(x, qy, u * 0.3, 0, TAU); ctx.fill();
      ctx.strokeStyle = AMBER; ctx.lineWidth = Math.max(1.4, u * 0.06); ctx.stroke();
      ctx.fillStyle = AMBER; ctx.font = `700 ${u * 0.42}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', x, qy + 1); ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
      const k = (t * 0.8 + ph) % 1;
      ctx.strokeStyle = css(AMBER, (1 - k) * 0.8); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(x, y, u * (0.3 + k), u * (0.14 + k * 0.45), 0, 0, TAU); ctx.stroke();
    }
    if (s === 'asleep' && !o.noZ) {
      for (let i = 0; i < 3; i++) {
        const k = (t * 0.25 + i / 3) % 1;
        ctx.fillStyle = css(mix(col, '#ffffff', 0.5), Math.sin(k * Math.PI) * 0.7);
        ctx.font = `600 ${u * (0.3 + k * 0.2)}px ${FONT}`;
        ctx.fillText('z', x + u * (0.3 + k * 0.5), y - u * (0.8 + k * 1.1));
      }
    }
    if (G && !G.mirror) glow(G, x, y - lift - u * 0.9, u * 1.8, col, 0.22 * dim * pulse);
  }
  function wispAt(G, a, x, y, z, o = {}) {
    const q = G.cam.p(x, y, z);
    wisp(G.ctx, q[0], q[1], G.cam.s * (o.scale || 0.52), a, G.t, o, G);
  }
  function holoDesk(G, x, y, z, on, col) {
    // a floating pane, angled toward the viewer, with lines of code scrolling
    const { ctx, cam, t } = G;
    const o = [x - 0.32, y + 0.12, z + 0.45];
    ctx.save();
    cam.face(ctx, o, [0.64, 0, 0], [0, -0.08, 0.5]);
    ctx.scale(1 / 64, -1 / 50);
    ctx.fillStyle = on ? css(col, G.pal.add ? 0.25 : 0.35) : 'rgba(150,170,210,0.12)';
    ctx.fillRect(0, -50, 64, 50);
    ctx.strokeStyle = on ? css(col, 0.95) : G.pal.edge2; ctx.lineWidth = 2.5; ctx.strokeRect(0, -50, 64, 50);
    if (on) {
      const r = rng(Math.floor(x * 10 + y * 3));
      for (let i = 0; i < 6; i++) {
        const lw = 12 + ((r() * 40 + t * 30 + i * 17) % 40);
        ctx.fillStyle = css(mix(col, '#ffffff', 0.5), 0.8);
        ctx.fillRect(6 + (i % 3) * 4, -44 + i * 7, lw, 3);
      }
    }
    ctx.restore();
    // a pedestal of light
    const b = cam.p(x, y + 0.1, z), b2 = cam.p(x, y + 0.1, z + 0.45);
    ctx.strokeStyle = on ? css(col, 0.6) : G.pal.edge2; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(...b); ctx.lineTo(...b2); ctx.stroke();
    if (on && !G.mirror) { const m = cam.p(x, y + 0.12, z + 0.7); glow(G, m[0], m[1], cam.s * 0.8, col, 0.28); }
  }

  // ---------- the town ----------
  function drawObjects(G) {
    const O = [];
    const add = (k, fn) => O.push({ k, fn });
    tower(G, add, { x0: 3.2, y0: 3.2, x1: 7.2, y1: 7.2, name: 'ATLAS', floors: [
      { id: 'world', lit: true, people: [A.scout, A.wren, A.juniper] },
      { id: 'crew', lit: true, people: [A.otter, null, A.pixel] },
      { id: 'lab', lit: true, people: [null, A.hazel] },
      { id: 'docs', lit: false, people: [] },
    ], queue: [A.maple, A.sable, A.lark] });
    tower(G, add, { x0: 15.4, y0: 2.0, x1: 18.6, y1: 5.2, name: 'NIMBUS', floors: [
      { id: 'site', lit: true, people: [A.kite] }, { id: 'api', lit: false, people: [] }, { id: 'ops', lit: false, people: [] },
    ], queue: [A.sorrel] });
    hall(G, add);
    post(G, add);
    lounge(G, add);
    apartments(G, add);
    library(G, add);
    warehouse(G, add);
    arrival(G, add);
    busStop(G, add);
    bus(G, add);
    walkers(G, add);
    for (const c of CRYSTALS) add(c.x + c.y, () => crystal(G, c));
    O.sort((a, b) => a.k - b.k);
    for (const o of O) { G.ctx.save(); o.fn(); G.ctx.restore(); }
  }
  function tower(G, add, b) {
    const { cam } = G, FH = 1.45, H = b.floors.length * FH;
    add(b.x0 + b.y0 + 4, () => {
      glass(G, b.x0, b.y0, b.x1, b.y1, 0, H + 0.5, {
        inner: () => {
          b.floors.forEach((f, i) => {
            const z = i * FH + 0.05, col = PROJ[f.id];
            slab(G, b.x0 + 0.1, b.y0 + 0.1, b.x1 - 0.1, b.y1 - 0.1, z, col, f.lit);
            const seats = [[b.x0 + 1.0, b.y0 + 1.1], [b.x1 - 1.0, b.y0 + 1.1], [b.x0 + 1.0, b.y1 - 1.0], [b.x1 - 1.0, b.y1 - 1.0]].slice(0, b.x1 - b.x0 > 3.5 ? 4 : 3);
            seats.forEach(([sx, sy], k) => {
              const who = f.people[k];
              if (who) wispAt(G, who, sx, sy - 0.25, z);
              holoDesk(G, sx, sy, z, !!who && f.lit, col);
            });
            if (!G.mirror) {
              const lp = cam.p(b.x0 + 0.15, b.y1 - 0.1, z + 0.2);
              holoText(G, lp[0] - cam.s * 0.2, lp[1] - cam.s * 0.1, f.id, Math.max(9, cam.s * 0.36), f.lit ? col : G.pal.edge2, { align: 'right', weight: 700 });
            }
          });
        },
      });
      if (!G.mirror) {
        // crown: the host name floating over the roof
        const c = cam.p((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, H + 1.4 + Math.sin(G.t) * 0.08);
        holoText(G, c[0], c[1], b.name, Math.max(11, cam.s * 0.55), G.pal.ink, { plate: true, weight: 700 });
        // antenna light
        const an = cam.p(b.x1 - 0.4, b.y0 + 0.4, H + 0.5), an2 = cam.p(b.x1 - 0.4, b.y0 + 0.4, H + 1.6);
        G.ctx.strokeStyle = G.pal.edge; G.ctx.lineWidth = 1; G.ctx.beginPath(); G.ctx.moveTo(...an); G.ctx.lineTo(...an2); G.ctx.stroke();
        if (Math.sin(G.t * 3) > 0) glow(G, an2[0], an2[1], cam.s * 0.6, '#ff4d6d', 1);
      }
    });
    // reception: light pads in front, the queue standing on them oldest first
    const ry = b.y1 + 0.9;
    add(b.x0 + ry + 1, () => {
      const { ctx } = G;
      const desk = [cam.p(b.x0 + 0.3, ry - 0.3, 0.6), cam.p(b.x1 - 0.3, ry - 0.3, 0.6)];
      glass(G, b.x0 + 0.3, ry - 0.5, b.x1 - 0.3, ry - 0.15, 0, 0.55, { tint: '#9fefff', lw: 1 });
      if (!G.mirror) { const m = cam.p((b.x0 + b.x1) / 2, ry - 0.15, 0.3); holoText(G, m[0], m[1], 'RECEPTION', Math.max(8, cam.s * 0.24), G.pal.ink, { weight: 700 }); }
      b.queue.forEach((a, k) => {
        const px = b.x0 + 0.7 + k * 1.15, py = ry + 0.6;
        const q = cam.p(px, py, 0.02);
        ctx.strokeStyle = css(a.s === 'done' ? GREEN : AMBER, 0.8); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.ellipse(q[0], q[1], cam.s * 0.5, cam.s * 0.25, 0, 0, TAU); ctx.stroke();
        wispAt(G, a, px, py, 0, { beam: a.s === 'needs' ? cam.s * 5.5 : 0 });
        if (!G.mirror && a.s === 'needs') G.beamsTo = (G.beamsTo || []).concat([[px, py]]);
      });
      void desk;
    });
  }
  function hall(G, add) {
    const { cam, t } = G;
    add(CX + CY + 2, () => {
      const tiers = [[3.2, 0, 1.15], [2.3, 1.15, 2.3], [1.4, 2.3, 3.45]];
      for (const [hw, z0, z1] of tiers) glass(G, CX - hw / 1.6 * 1.0, CY - hw / 1.6, CX + hw / 1.6, CY + hw / 1.6, z0, z1, { tint: '#c9b8ff' });
      if (G.mirror) return;
      // the counter ring: Busy, Waiting, Done, Quiet floating over the hall
      const { ctx } = G;
      const z = 5.6 + Math.sin(t * 0.7) * 0.1;
      ctx.save();
      ctx.strokeStyle = css('#c9b8ff', 0.8); ctx.lineWidth = 1.5; ctx.setLineDash([cam.s * 0.5, cam.s * 0.25]); ctx.lineDashOffset = -t * 10;
      ctx.beginPath(); ellipseAt(ctx, cam, CX, CY, z, 2.6); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = css('#c9b8ff', 0.35); ctx.beginPath(); ellipseAt(ctx, cam, CX, CY, z - 0.3, 2.9); ctx.stroke();
      ctx.restore();
      const stats = [['7', 'BUSY', '#7fe7ff'], ['3', 'WAITING', AMBER], ['1', 'DONE', GREEN], ['2', 'QUIET', '#b8c2e0']];
      stats.forEach(([n, l, col], i) => {
        const an = t * 0.25 + (i / 4) * TAU;
        const q = cam.p(CX + Math.cos(an) * 2.6, CY + Math.sin(an) * 2.6, z);
        const front = Math.sin(an + Math.PI / 4) * 0.5 + 0.5;
        ctx.globalAlpha = 0.45 + 0.55 * front;
        holoText(G, q[0], q[1] - cam.s * 0.35, n, Math.max(12, cam.s * 0.7), col, { weight: 700 });
        holoText(G, q[0], q[1] + cam.s * 0.15, l, Math.max(7, cam.s * 0.22), col, { weight: 600 });
        ctx.globalAlpha = 1;
      });
      const top = cam.p(CX, CY, 3.45), up = cam.p(CX, CY, z - 0.4);
      const bg = ctx.createLinearGradient(0, up[1], 0, top[1]); bg.addColorStop(0, css('#c9b8ff', 0)); bg.addColorStop(1, css('#c9b8ff', 0.5));
      ctx.fillStyle = bg; ctx.fillRect(top[0] - 2, up[1], 4, top[1] - up[1]);
      glow(G, top[0], top[1], cam.s * 3, '#b89cff', 0.4);
      const lbl = cam.p(CX + 1.6, CY + 1.6, 0.4);
      holoText(G, lbl[0], lbl[1] + cam.s * 0.3, 'TOWN HALL', Math.max(8, cam.s * 0.26), G.pal.ink, { weight: 700, plate: true });
    });
    // hiring portal: a standing ring with a new agent stepping through
    add(CX + 2.6 + CY + 2.6, () => {
      const { ctx } = G, px = CX + 2.7, py = CY + 2.2;
      const c = cam.p(px, py, 1.15);
      const k = (t * 0.25) % 1;
      ctx.save(); ctx.translate(c[0], c[1]);
      ctx.strokeStyle = css('#7fe7ff', 0.9); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, 0, cam.s * 0.55, cam.s * 1.1, 0.5, 0, TAU); ctx.stroke();
      ctx.strokeStyle = css('#7fe7ff', 0.4); ctx.lineWidth = 6; ctx.stroke();
      ctx.fillStyle = css('#7fe7ff', G.pal.add ? 0.12 : 0.2); ctx.fill();
      ctx.restore();
      if (!G.mirror) {
        glow(G, c[0], c[1], cam.s * 2, '#7fe7ff', 0.5);
        const nw = { n: 'new', h: ['claude', 'codex', 'gemini', 'rex'][Math.floor(t / 4) % 4], s: 'walking' };
        ctx.globalAlpha = Math.min(1, k * 4) * (1 - Math.max(0, k - 0.8) * 5);
        wispAt(G, nw, px + k * 1.4, py + k * 1.4, 0, { scale: 0.5 });
        ctx.globalAlpha = 1;
        const l = cam.p(px, py, 2.6); holoText(G, l[0], l[1], 'HIRE', Math.max(8, cam.s * 0.28), '#7fe7ff', { weight: 700 });
      }
    });
    // expenses: a hologram bar chart
    add(9.8 + 13.2, () => {
      if (G.mirror) return;
      const { ctx } = G, ex = 9.4, ey = 13.4;
      const bars = [0.5, 0.8, 0.6, 1.1, 0.9, 1.4];
      bars.forEach((v, i) => {
        const b = cam.p(ex + i * 0.32, ey, 0.05), tp = cam.p(ex + i * 0.32, ey, 0.05 + v * (1 + 0.05 * Math.sin(t * 2 + i)));
        const g = ctx.createLinearGradient(0, tp[1], 0, b[1]); g.addColorStop(0, css(i === 5 ? '#ff9ad5' : '#7fe7ff', 0.9)); g.addColorStop(1, css(i === 5 ? '#ff9ad5' : '#7fe7ff', 0.1));
        ctx.fillStyle = g; ctx.fillRect(b[0] - cam.s * 0.1, tp[1], cam.s * 0.2, b[1] - tp[1]);
      });
      const l = cam.p(ex + 0.8, ey, 2.0); holoText(G, l[0], l[1], 'EXPENSES · $41 today', Math.max(8, cam.s * 0.24), G.pal.ink, { weight: 600, plate: true });
    });
  }
  function post(G, add) {
    const { cam, t } = G, x0 = 9.0, y0 = 1.2, x1 = 10.6, y1 = 2.8;
    add(x0 + y0 + 2, () => {
      glass(G, x0, y0, x1, y1, 0, 6.2, { tint: '#ffd27a', edge: '#ffe2a8', inner: () => {
        for (let i = 0; i < 6; i++) slab(G, x0 + 0.1, y0 + 0.1, x1 - 0.1, y1 - 0.1, 0.4 + i, AMBER, i < 3);
      } });
      if (G.mirror) return;
      const { ctx } = G, c = [(x0 + x1) / 2, (y0 + y1) / 2], z = 7.0;
      // a ring of envelopes orbiting the top
      for (let i = 0; i < 9; i++) {
        const an = t * 0.6 + (i / 9) * TAU;
        const q = cam.p(c[0] + Math.cos(an) * 1.6, c[1] + Math.sin(an) * 1.6, z + Math.sin(an * 2) * 0.15);
        const e = cam.s * 0.32, lit = i < 3;
        ctx.strokeStyle = css(lit ? AMBER : '#ffe2a8', lit ? 1 : 0.5); ctx.lineWidth = 1.2;
        ctx.fillStyle = css(lit ? AMBER : '#ffe2a8', lit ? 0.3 : 0.08);
        ctx.beginPath(); ctx.rect(q[0] - e, q[1] - e * 0.65, e * 2, e * 1.3); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(q[0] - e, q[1] - e * 0.65); ctx.lineTo(q[0], q[1] + e * 0.1); ctx.lineTo(q[0] + e, q[1] - e * 0.65); ctx.stroke();
      }
      const top = cam.p(c[0], c[1], 6.6);
      holoText(G, top[0], top[1] - cam.s * 0.2, '3', Math.max(14, cam.s * 0.9), AMBER, { weight: 700 });
      const l = cam.p(x1, y1, 0.3);
      holoText(G, l[0] + cam.s * 0.2, l[1] + cam.s * 0.3, 'POST · needs you', Math.max(8, cam.s * 0.26), G.pal.ink, { weight: 700, plate: true, align: 'left' });
      glow(G, top[0], top[1], cam.s * 3, AMBER, 0.45);
    });
  }
  function beams(G) {
    // amber arcs carry each waiting question to the post office
    if (!G.beamsTo) return;
    const { ctx, cam, t } = G, dst = [9.8, 2.0, 6.8];
    ctx.save();
    for (const [x, y] of G.beamsTo) {
      const pt = (k) => cam.p(lerp(x, dst[0], k), lerp(y, dst[1], k), lerp(1.6, dst[2], k) + Math.sin(k * Math.PI) * 2.2);
      ctx.strokeStyle = css(AMBER, 0.35); ctx.lineWidth = 1.2; ctx.setLineDash([3, 5]); ctx.lineDashOffset = -t * 20;
      ctx.beginPath(); for (let k = 0; k <= 1.001; k += 0.04) { const q = pt(k); k ? ctx.lineTo(...q) : ctx.moveTo(...q); } ctx.stroke();
      ctx.setLineDash([]);
      const k = (t * 0.45 + x * 0.1) % 1, q = pt(k);
      ctx.fillStyle = '#fff3d0'; ctx.beginPath(); ctx.arc(q[0], q[1], 2.2, 0, TAU); ctx.fill();
      glow(G, q[0], q[1], cam.s * 0.8, AMBER, 0.9);
    }
    ctx.restore();
  }
  function lounge(G, add) {
    const { cam, t } = G, x = 5.5, y = 15.5, r = 2.2;
    add(x + y + 1.5, () => {
      cyl(G, x, y, r, 0, 1.8, '#ff7ad9', { edge: '#ffb3ec', inner: () => {
        // bar counter arc and drifting guests
        const { ctx } = G;
        ctx.strokeStyle = css('#ff7ad9', 0.9); ctx.lineWidth = cam.s * 0.18; ctx.lineCap = 'round';
        ctx.beginPath(); const c = cam.p(x, y, 0.6); ctx.ellipse(c[0], c[1], r * 0.55 * cam.s * 1.22, r * 0.55 * cam.s * 0.707, 0, Math.PI * 1.05, Math.PI * 1.85); ctx.stroke();
        [[A.moss, 0], [A.ember, 2.1], [A.fern, 4.2]].forEach(([a, off]) => {
          const an = t * 0.12 + off;
          wispAt(G, a, x + Math.cos(an) * 1.1, y + Math.sin(an) * 1.1, 0.02);
        });
      } });
      if (G.mirror) return;
      const { ctx } = G, z = 2.6 + Math.sin(t) * 0.08;
      ctx.strokeStyle = css('#ff7ad9', 0.9); ctx.lineWidth = 2; ctx.beginPath(); ellipseAt(ctx, cam, x, y, z, 1.4); ctx.stroke();
      const c = cam.p(x, y, z); glow(G, c[0], c[1], cam.s * 3.4, '#ff5cc8', 0.5);
      holoText(G, c[0], c[1] - cam.s * 0.4, 'LOUNGE', Math.max(9, cam.s * 0.34), '#ffc7f0', { weight: 700 });
    });
  }
  function apartments(G, add) {
    const { cam, t } = G;
    // capsule pods stacked like a honeycomb; sleepers glow faintly
    const pods = [];
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) pods.push([8.3 + c * 1.3, 18.4 + r * 1.4, 0]);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) pods.push([8.95 + c * 1.3, 18.4 + r * 1.4, 1.0]);
    const who = [null, A.tansy, null, A.bram, null, A.olive, null, null, null, null];
    add(9.6 + 19.4 + 1, () => {
      // shared glass frame
      glass(G, 7.5, 17.7, 11.9, 20.9, 0, 2.3, { edge: '#cfe0ff', inner: () => {
        pods.forEach(([px, py, pz], i) => {
          cyl(G, px, py, 0.45, pz, pz + 0.9, who[i] ? HARNESS_COL[who[i].h] : null, { edge: who[i] ? css(HARNESS_COL[who[i].h], 0.8) : G.pal.edge2 });
          if (who[i]) {
            wispAt(G, who[i], px + 0.1, py + 0.05, pz + 0.15, { scale: 0.42, state: 'asleep', noZ: i !== 3 });
          }
        });
      } });
      if (G.mirror) return;
      const l = cam.p(9.7, 20.9, 2.7);
      holoText(G, l[0], l[1], 'APARTMENTS', Math.max(9, cam.s * 0.3), G.pal.ink, { weight: 700, plate: true });
    });
  }
  function library(G, add) {
    const { cam, t } = G, x = 16.6, y = 17.4;
    add(x + y + 1, () => {
      // memory strata: stacked discs, each one a day, text bands turning
      for (let i = 0; i < 7; i++) {
        const z = 0.2 + i * 0.55, r = 1.7 - i * 0.12;
        cyl(G, x, y, r, z, z + 0.32, '#4fe3d0', { edge: css('#7ff7e4', 0.9) });
        if (G.mirror) continue;
        const { ctx } = G, c = cam.p(x, y, z + 0.16);
        ctx.save();
        ctx.strokeStyle = css('#bffff4', 0.75); ctx.lineWidth = Math.max(1, cam.s * 0.06);
        ctx.setLineDash([cam.s * 0.15, cam.s * 0.07, cam.s * 0.35, cam.s * 0.1]); ctx.lineDashOffset = t * (i % 2 ? 6 : -6) * (1 + i * 0.1);
        ctx.beginPath(); ctx.ellipse(c[0], c[1], r * cam.s * 1.2247, r * cam.s * 0.7071, 0, 0.1, Math.PI - 0.1); ctx.stroke();
        ctx.restore();
      }
      if (G.mirror) return;
      const tp = cam.p(x, y, 4.4); glow(G, tp[0], tp[1], cam.s * 3, '#4fe3d0', 0.5);
      holoText(G, tp[0], tp[1], 'LIBRARY · memory', Math.max(9, cam.s * 0.3), G.pal.ink, { weight: 700, plate: true });
    });
  }
  function warehouse(G, add) {
    const { cam, t } = G, x0 = 19.0, y0 = 12.8, x1 = 22.2, y1 = 16.6;
    add(x0 + y0 + 3, () => {
      glass(G, x0, y0, x1, y1, 0, 2.4, { inner: () => {
        const st = [GREEN, AMBER, GREEN, '#ff5c7a', AMBER, '#c9d2ff', GREEN, AMBER, GREEN];
        let k = 0;
        for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) for (let s = 0; s < ((r + c) % 2 ? 2 : 1); s++) {
          const cx = x0 + 0.35 + c * 1.45, cy = y0 + 0.35 + r * 1.15, col = st[k++ % st.length];
          glass(G, cx, cy, cx + 0.9, cy + 0.9, s * 0.85, s * 0.85 + 0.8, { tint: col, edge: css(col, 0.95), lw: 1 });
          if (!G.mirror) { const m = cam.p(cx + 0.45, cy + 0.45, s * 0.85 + 0.4); glow(G, m[0], m[1], cam.s * 0.9, col, 0.35); }
        }
      } });
      if (G.mirror) return;
      const l = cam.p(x0 + 1.6, y0 + 1.9, 3.0); holoText(G, l[0], l[1], 'PR WAREHOUSE · 12', Math.max(8, cam.s * 0.26), G.pal.ink, { weight: 700, plate: true });
    });
  }
  function arrival(G, add) {
    // a new host is printed by a beam from the sky, layer by layer
    const { cam, t } = G, x0 = 19.8, y0 = 6.6, x1 = 22.2, y1 = 9.0, H = 4.2;
    const k = (t % 12) / 12, grow = ease(clamp(k / 0.6, 0, 1)), fade = k > 0.9 ? 1 - (k - 0.9) / 0.1 : 1;
    add(x0 + y0 + 2, () => {
      const { ctx } = G, h = Math.max(0.05, H * grow);
      ctx.globalAlpha = fade;
      glass(G, x0, y0, x1, y1, 0, h, { tint: '#7cf29a', edge: '#b7ffd0' });
      if (G.mirror) return;
      const p = cam.p.bind(cam);
      // the scan plane at the print head
      const sp = [p(x0, y0, h), p(x1, y0, h), p(x1, y1, h), p(x0, y1, h)];
      if (grow < 1) { poly(ctx, sp); ctx.fillStyle = css('#b7ffd0', 0.5); ctx.fill(); }
      const c = p((x0 + x1) / 2, (y0 + y1) / 2, h);
      const bg = ctx.createLinearGradient(0, 0, 0, c[1]); bg.addColorStop(0, css('#7cf29a', 0)); bg.addColorStop(1, css('#7cf29a', grow < 1 ? 0.4 : 0.1));
      ctx.fillStyle = bg; ctx.fillRect(c[0] - cam.s * 0.5, c[1] - cam.s * 12, cam.s * 1.0, cam.s * 12);
      glow(G, c[0], c[1], cam.s * 2.5, '#7cf29a', 0.7 * fade);
      for (let i = 0; i < 12; i++) { const r = rng(i + 1), pk = (t * 0.6 + r()) % 1; const q = p(lerp(x0, x1, r()), lerp(y0, y1, r()), h + pk * 3); ctx.fillStyle = css('#d8ffe6', 1 - pk); ctx.fillRect(q[0], q[1], 2, 2); }
      const l = p(x1, y1, 0.2); holoText(G, l[0] + cam.s * 0.3, l[1] + cam.s * 0.4, grow < 1 ? `pine · joining ${Math.round(grow * 100)}%` : 'pine · new host', Math.max(8, cam.s * 0.26), '#b7ffd0', { weight: 700, plate: true, align: 'left' });
      ctx.globalAlpha = 1;
    });
  }
  function crystal(G, c) {
    // light-filled prisms instead of trees
    const { ctx, cam, t } = G, p = cam.p.bind(cam);
    const hh = c.h * (1 + 0.04 * Math.sin(t + c.k * 9)), r = 0.28;
    const b = [p(c.x - r, c.y, 0), p(c.x, c.y + r, 0), p(c.x + r, c.y, 0)], tp = p(c.x, c.y, hh);
    const col = ['#7fe7ff', '#b98cff', '#5ff0a6', '#7fe7ff'][Math.floor(c.k * 4)];
    poly(ctx, [b[0], b[1], tp]); ctx.fillStyle = css(col, G.pal.add ? 0.35 : 0.45); ctx.fill();
    poly(ctx, [b[1], b[2], tp]); ctx.fillStyle = css(col, G.pal.add ? 0.18 : 0.28); ctx.fill();
    ctx.strokeStyle = css(col, 0.9); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(...b[1]); ctx.lineTo(...tp); ctx.stroke();
    if (!G.mirror) glow(G, tp[0], tp[1] + cam.s * 0.4, cam.s * 0.9, col, 0.25);
  }
  function busStop(G, add) {
    const { cam } = G;
    add(13.4 + 16.8, () => {
      glass(G, 13.35, 16.4, 13.55, 17.8, 0, 1.2, { tint: '#7fe7ff' });
      if (G.mirror) return;
      const l = cam.p(13.45, 17.1, 1.7); holoText(G, l[0], l[1], 'LOOP · 2 min', Math.max(8, cam.s * 0.22), '#7fe7ff', { weight: 700, plate: true });
    });
  }
  function bus(G, add) {
    // a maglev capsule circling the ring road
    const { cam, t } = G, an = t * 0.22, rr = 4.6;
    const x = CX + Math.cos(an) * rr, y = CY + Math.sin(an) * rr;
    add(x + y + 0.5, () => {
      const { ctx } = G, dir = an + Math.PI / 2;
      const segs = 6, len = 2.2;
      const pts = [];
      for (let i = 0; i <= segs; i++) { const a2 = an - (i / segs) * (len / rr); pts.push([CX + Math.cos(a2) * rr, CY + Math.sin(a2) * rr]); }
      ctx.lineCap = 'round';
      const path = (z) => { ctx.beginPath(); pts.forEach(([px, py], i) => { const q = cam.p(px, py, z); i ? ctx.lineTo(...q) : ctx.moveTo(...q); }); };
      path(0.55); ctx.strokeStyle = G.pal.add ? 'rgba(220,240,255,0.85)' : 'rgba(255,255,255,0.95)'; ctx.lineWidth = cam.s * 0.75; ctx.stroke();
      path(0.62); ctx.strokeStyle = css('#7fe7ff', 0.9); ctx.lineWidth = cam.s * 0.16; ctx.stroke();
      path(0.75); ctx.strokeStyle = G.pal.add ? 'rgba(20,30,60,0.9)' : 'rgba(80,100,150,0.7)'; ctx.lineWidth = cam.s * 0.22; ctx.setLineDash([cam.s * 0.3, cam.s * 0.12]); ctx.stroke(); ctx.setLineDash([]);
      if (G.mirror) return;
      // riders' faces in the window band
      [A.fig, A.quill].forEach((a, i) => { const [px, py] = pts[2 + i * 2]; const q = cam.p(px, py, 0.62); ctx.fillStyle = css(HARNESS_COL[a.h], 1); ctx.beginPath(); ctx.arc(q[0], q[1] - cam.s * 0.08, cam.s * 0.14, 0, TAU); ctx.fill(); });
      const head = cam.p(pts[0][0], pts[0][1], 0.6);
      glow(G, head[0], head[1], cam.s * 1.8, '#dff6ff', 0.9);
      const under = cam.p(x, y, 0.02);
      glow(G, under[0], under[1], cam.s * 1.6, '#7fe7ff', 0.4);
      void dir;
    });
  }
  function walkers(G, add) {
    const { t } = G;
    const paths = [[A.fig, (k) => [lerp(1, 7.6, k), 11.25], 22], [A.quill, (k) => [12.25, lerp(16.4, 25, k)], 18]];
    paths.forEach(([a, f, T], i) => {
      const ph = (t / T + i * 0.4) % 2, k = ph < 1 ? ph : 2 - ph, [x, y] = f(k);
      add(x + y, () => {
        // a short trail of light behind each step
        const { ctx, cam } = G;
        for (let s = 1; s < 8; s++) {
          const kk = clamp(k - (ph < 1 ? 1 : -1) * s * 0.008, 0, 1), [tx, ty] = f(kk), q = cam.p(tx, ty, 0.3);
          ctx.fillStyle = css(HARNESS_COL[a.h], 0.25 * (1 - s / 8)); ctx.beginPath(); ctx.arc(q[0], q[1], cam.s * 0.12 * (1 - s / 10), 0, TAU); ctx.fill();
        }
        wispAt(G, { ...a, s: 'walking' }, x, y, 0, { flip: ph >= 1 });
        if (G.weather === 'rain' && !G.mirror) {
          // a little dome of light keeps the rain off
          const q = cam.p(x, y, 0);
          ctx.strokeStyle = css(HARNESS_COL[a.h], 0.6); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.ellipse(q[0], q[1] - cam.s * 0.9, cam.s * 0.6, cam.s * 0.9, 0, Math.PI, 0); ctx.stroke();
        }
      });
    });
  }
  function sea(G) {
    const { ctx, cam, t, pal, time } = G, p = cam.p.bind(cam);
    ctx.save();
    discPath(ctx, cam, 0.01); ctx.clip();
    // water: everything past the quay
    ctx.beginPath(); const a = p(23, CY - R, 0.01), b = p(CX + R + 1, CY - R, 0.01), c = p(CX + R + 1, CY + R, 0.01), d = p(23, CY + R, 0.01);
    ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...c); ctx.lineTo(...d); ctx.closePath();
    ctx.fillStyle = time === 'day' ? 'rgba(150,190,225,0.55)' : 'rgba(20,60,110,0.35)'; ctx.fill();
    // caustic lines
    for (let i = 0; i < 9; i++) {
      const x0 = 23.4 + i * 0.6;
      ctx.beginPath();
      for (let y = CY - R; y <= CY + R; y += 0.4) { const q = p(x0 + Math.sin(y * 0.9 + t * 0.8 + i) * 0.15, y, 0.02); y === CY - R ? ctx.moveTo(...q) : ctx.lineTo(...q); }
      ctx.strokeStyle = time === 'day' ? 'rgba(255,255,255,0.55)' : css('#6fe0ff', 0.12 + 0.06 * Math.sin(t + i)); ctx.lineWidth = 1; ctx.stroke();
    }
    // quay edge
    ctx.strokeStyle = pal.edge; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(...p(23, CY - R, 0.03)); ctx.lineTo(...p(23, CY + R, 0.03)); ctx.stroke();
    ctx.restore();
    // release lanes: beacons running out to sea, one ship per project
    const lanes = [{ y: 6.2, id: 'world', v: 'v2.1', out: true }, { y: 13.8, id: 'crew', v: 'v0.4' }, { y: 17.2, id: 'docs', v: 'v1.0' }];
    lanes.forEach((ln, j) => {
      const col = PROJ[ln.id];
      for (let i = 0; i < 6; i++) {
        const bx = 23.6 + i * 0.85; if (!inDisc(bx, ln.y, 0.3)) continue;
        const q = p(bx, ln.y, 0.05), on = ((t * 2 - i * 0.4) % 3) < 0.5;
        ctx.fillStyle = css(col, on ? 1 : 0.35); ctx.beginPath(); ctx.arc(q[0], q[1], on ? 2.2 : 1.5, 0, TAU); ctx.fill();
        if (on) glow(G, q[0], q[1], cam.s * 0.6, col, 0.8);
      }
      const k = ln.out ? (t * 0.04) % 1 : 0;
      const sx = ln.out ? lerp(23.8, 27.6, ease(clamp(k * 1.4, 0, 1))) : 24.3, bob = Math.sin(t * 1.3 + j) * 0.05;
      ship(G, sx, ln.y + 0.55, bob, col, ln.v, ln.id, ln.out && k > 0.05 && k < 0.75);
    });
  }
  function ship(G, x, y, bob, col, v, id, sailing) {
    const { ctx, cam, t } = G, p = cam.p.bind(cam);
    const L = 1.9, W = 0.42, z = 0.12 + bob;
    if (sailing) {
      ctx.strokeStyle = css('#ffffff', 0.35); ctx.lineWidth = 1;
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(...p(x, y + s * 0.1, 0.03)); ctx.lineTo(...p(x - 2.2, y + s * 0.7, 0.03)); ctx.stroke(); }
    }
    // glass hull
    const hull = [p(x - L / 2, y - W, z), p(x + L / 2 - 0.3, y - W, z), p(x + L / 2 + 0.2, y, z), p(x + L / 2 - 0.3, y + W, z), p(x - L / 2, y + W, z)];
    const keel = [p(x - L / 2 + 0.2, y, z - 0.35), p(x + L / 2 - 0.1, y, z - 0.25)];
    poly(ctx, [hull[4], hull[3], hull[2], keel[1], keel[0]]); ctx.fillStyle = gfill(G, 3); ctx.fill(); ctx.strokeStyle = G.pal.edge; ctx.lineWidth = 1; ctx.stroke();
    poly(ctx, hull); ctx.fillStyle = gfill(G, 2); ctx.fill(); ctx.stroke();
    // a sail of light
    const m0 = p(x - 0.1, y, z), m1 = p(x - 0.1, y, z + 2.3), s1 = p(x + 0.7, y, z + 0.25), s2 = p(x - 0.85, y, z + 0.3);
    ctx.beginPath(); ctx.moveTo(...m1); ctx.lineTo(...s1); ctx.lineTo(...m0); ctx.closePath(); ctx.fillStyle = css(col, 0.55); ctx.fill();
    ctx.beginPath(); ctx.moveTo(...m1); ctx.lineTo(...s2); ctx.lineTo(...m0); ctx.closePath(); ctx.fillStyle = css(col, 0.3); ctx.fill();
    ctx.strokeStyle = css(col, 1); ctx.beginPath(); ctx.moveTo(...m0); ctx.lineTo(...m1); ctx.stroke();
    glow(G, m1[0], (m1[1] + m0[1]) / 2, cam.s * 1.8, col, 0.45);
    holoText(G, m1[0], m1[1] - cam.s * 0.4, `${id} ${v}${sailing ? ' · shipping' : ''}`, Math.max(8, cam.s * 0.26), col, { weight: 700, plate: true });
  }
  function rain(G, w, h) {
    const { ctx, cam, t } = G, r = rng(3);
    ctx.save(); ctx.globalCompositeOperation = G.pal.add ? 'lighter' : 'source-over';
    for (let i = 0; i < 220; i++) {
      const x = r() * w * 1.1, sp = 0.9 + r() * 0.6, len = 10 + r() * 20, y = ((r() * h + t * h * sp) % (h + 40)) - 20;
      const g = ctx.createLinearGradient(0, y, 0, y + len); g.addColorStop(0, 'rgba(180,230,255,0)'); g.addColorStop(1, G.pal.add ? 'rgba(180,230,255,0.45)' : 'rgba(110,140,190,0.5)');
      ctx.strokeStyle = g; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - y * 0.05, y); ctx.lineTo(x - (y + len) * 0.05, y + len); ctx.stroke();
    }
    for (let i = 0; i < 50; i++) {
      const an = r() * TAU, rd = Math.sqrt(r()) * (R - 1), k = (t * 0.8 + r()) % 1;
      const q = cam.p(CX + Math.cos(an) * rd, CY + Math.sin(an) * rd, 0.02);
      ctx.strokeStyle = G.pal.add ? `rgba(150,220,255,${0.5 * (1 - k)})` : `rgba(100,130,180,${0.5 * (1 - k)})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(q[0], q[1], cam.s * 0.6 * k, cam.s * 0.3 * k, 0, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }
  function snow(G, w, h) {
    const { ctx, t } = G, r = rng(8);
    ctx.save();
    // a low frosted fog
    const fg = ctx.createLinearGradient(0, h * 0.4, 0, h);
    fg.addColorStop(0, 'rgba(230,240,255,0)'); fg.addColorStop(1, G.pal.add ? 'rgba(200,220,255,0.12)' : 'rgba(255,255,255,0.35)');
    ctx.fillStyle = fg; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 150; i++) {
      const depth = r(), x = (r() * w + Math.sin(t * 0.5 + i) * 20 * depth + w) % w, y = ((r() * h + t * h * (0.04 + depth * 0.1)) % (h + 20)) - 10;
      const rad = 1 + depth * 3.5;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad * 2);
      g.addColorStop(0, `rgba(255,255,255,${0.5 + depth * 0.4})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad * 2, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // ---------- character sheet ----------
  function sheet(ctx, w, h, t) {
    const pal = PAL.night;
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#05060f'); g.addColorStop(1, '#0d1230');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const cols = w > 720 ? 6 : 2;
    const cells = [...Object.keys(HARNESS_COL).map((hk) => ({ hk })), ...['working', 'thinking', 'needs', 'done', 'idle', 'walking', 'bus', 'asleep'].map((st) => ({ st }))];
    const rows = Math.ceil(cells.length / cols), cw = w / cols, ch = h / rows;
    const names = { working: 'Working', thinking: 'Thinking', needs: 'Needs you', done: 'Done · to review', idle: 'Idle at the lounge', walking: 'Walking', bus: 'On the bus', asleep: 'Asleep · resumable' };
    const who = { working: A.scout, thinking: A.pixel, needs: A.maple, done: A.lark, idle: A.fern, walking: A.fig, bus: A.otter, asleep: A.tansy };
    cells.forEach((c, i) => {
      const x0 = (i % cols) * cw, y0 = Math.floor(i / cols) * ch, X = x0 + cw / 2, fy = y0 + ch * 0.68;
      const u = Math.min(cw, ch) * 0.2;
      const G = { ctx, cam: isoCam(cw, ch, { cx: 0, cy: 0, s: u * 1.6 }), t, pal, L: [], mirror: false };
      G.cam = Object.assign({}, G.cam, { p: ((base) => (x, y, z) => { const q = base(x, y, z); return [q[0] + x0, q[1] + (fy - y0 - ch / 2) + y0]; })(G.cam.p.bind(G.cam)) });
      G.cam.face = function (cx2, o, uu, vv) { const O = this.p(...o), U = this.p(o[0] + uu[0], o[1] + uu[1], o[2] + uu[2]), V = this.p(o[0] + vv[0], o[1] + vv[1], o[2] + vv[2]); cx2.transform(U[0] - O[0], U[1] - O[1], V[0] - O[0], V[1] - O[1], O[0], O[1]); };
      ctx.save();
      ctx.strokeStyle = 'rgba(120,200,255,0.12)'; ctx.lineWidth = 1;
      rrect(ctx, x0 + 8, y0 + 8, cw - 16, ch - 16, 14); ctx.stroke();
      // floor disc for each specimen
      ctx.beginPath(); ctx.ellipse(X, fy, u * 1.4, u * 0.6, 0, 0, TAU); ctx.strokeStyle = 'rgba(120,200,255,0.25)'; ctx.stroke();
      if (c.hk) {
        wisp(ctx, X, fy, u, { n: c.hk, h: c.hk, s: 'standing' }, t, {}, G);
        label(ctx, X, y0 + ch * 0.9, c.hk[0].toUpperCase() + c.hk.slice(1), HARNESS_COL[c.hk], u);
      } else {
        const a = who[c.st];
        if (c.st === 'working' || c.st === 'thinking') { wisp(ctx, X, fy - u * 0.1, u, a, t, {}, G); holoDesk(G, 0, 0.55, 0, c.st === 'working', PROJ.world); }
        else if (c.st === 'bus') {
          ctx.save(); ctx.translate(X, fy);
          ctx.fillStyle = 'rgba(220,240,255,0.12)'; ctx.strokeStyle = 'rgba(220,240,255,0.9)'; ctx.lineWidth = 1.5;
          rrect(ctx, -u * 1.8, -u * 1.9, u * 3.6, u * 1.5, u * 0.75); ctx.fill(); ctx.stroke();
          ctx.fillStyle = css('#7fe7ff', 0.9); ctx.fillRect(-u * 1.5, -u * 0.62, u * 3.0, u * 0.1);
          ctx.restore();
          wisp(ctx, X, fy - u * 0.55, u * 0.75, a, t, { state: 'bus' }, G);
          const hl = [X + u * 1.8, fy - u * 1.1]; glow(G, hl[0], hl[1], u * 1.4, '#dff6ff', 0.8);
        } else if (c.st === 'asleep') {
          const cyG = Object.assign({}, G);
          cyl(cyG, 0, 0, 0.55, 0, 0.55, HARNESS_COL[a.h], { edge: css(HARNESS_COL[a.h], 0.8) });
          wisp(ctx, X + u * 0.75, fy - u * 0.35, u * 0.8, a, t, { state: 'asleep' }, G);
        } else if (c.st === 'idle') {
          ctx.strokeStyle = css('#ff7ad9', 0.9); ctx.lineWidth = u * 0.14; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.ellipse(X, fy - u * 0.1, u * 1.2, u * 0.45, 0, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
          wisp(ctx, X + Math.sin(t * 0.4) * u * 0.3, fy, u, a, t, {}, G);
        } else if (c.st === 'walking') {
          const dx = Math.sin(t * 0.8) * u * 0.8;
          for (let s = 1; s < 7; s++) { ctx.fillStyle = css(HARNESS_COL[a.h], 0.3 * (1 - s / 7)); ctx.beginPath(); ctx.arc(X + dx - Math.sign(Math.cos(t * 0.8)) * s * u * 0.18, fy - u * 0.2, u * 0.08, 0, TAU); ctx.fill(); }
          wisp(ctx, X + dx, fy, u, a, t, { flip: Math.cos(t * 0.8) < 0 }, G);
        } else wisp(ctx, X, fy, u, a, t, { beam: u * 2.6 }, G);
        label(ctx, X, y0 + ch * 0.9, names[c.st], '#d9f6ff', u);
      }
      ctx.restore();
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (const fn of G.L) fn(ctx, 1); ctx.restore();
    });
  }
  function label(ctx, x, y, text, col, u) {
    ctx.font = `600 ${Math.max(11, u * 0.36)}px ${FONT}`; ctx.textAlign = 'center'; ctx.fillStyle = col; ctx.fillText(text, x, y); ctx.textAlign = 'start';
  }
}
