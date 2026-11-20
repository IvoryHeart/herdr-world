// Direction 3 · Cutaway: the town as one long cross-section, drawn in the
// clean-line comic tradition. Every building is sliced open so every room,
// desk and agent is visible at once, with parallax depth behind. Speech
// balloons carry questions. Pneumatic tubes under the street carry them to the
// post office. A new host arrives by airship.
import { TAU, rng, rrect, mix, css, lerp, clamp, ease } from '../lib.js';

export const HARNESS_COL = { claude: '#e2683c', codex: '#2f5fb3', gemini: '#8b5cd6', rex: '#3f9a5b' };
const PROJ = { world: '#f2c14e', crew: '#ef7b6b', docs: '#58b7a8', lab: '#a77fd0', site: '#7cb36b', api: '#6f9bd8' };
const INK = '#1f1b2b', SKIN = '#f6d7b8', PANTS = '#3a3550';
const WS = 2800; // scene width in world units; ground at y = 0, up is negative
const SIGN = '"Alfa Slab One", "Rockwell", Georgia, serif';
const COMIC = '"Comic Neue", "Comic Sans MS", "Patrick Hand", sans-serif';

const P = (n, h, s) => ({ n, h, s });
const A = {
  scout: P('scout', 'claude', 'working'), wren: P('wren', 'codex', 'working'), juniper: P('juniper', 'claude', 'thinking'),
  otter: P('otter', 'gemini', 'working'), pixel: P('pixel', 'codex', 'thinking'), hazel: P('hazel', 'codex', 'working'),
  maple: P('maple', 'claude', 'needs'), sable: P('sable', 'codex', 'needs'), lark: P('lark', 'rex', 'done'),
  kite: P('kite', 'rex', 'working'), moss: P('moss', 'claude', 'idle'), ember: P('ember', 'codex', 'idle'), fern: P('fern', 'gemini', 'idle'),
  fig: P('fig', 'gemini', 'walking'), quill: P('quill', 'claude', 'walking'), tansy: P('tansy', 'codex', 'asleep'),
  bram: P('bram', 'claude', 'asleep'), olive: P('olive', 'gemini', 'asleep'), sorrel: P('sorrel', 'rex', 'needs'),
  mayor: P('townmaster', 'claude', 'working'), nova: P('nova', 'gemini', 'walking'),
};

const SKY = {
  day: { top: '#8fd3d1', mid: '#c9ebd9', hor: '#fbe9b7', far: '#e6b88a', far2: '#d89f76', hill: '#b9c27a', hill2: '#9fb46a', dark: 0 },
  dusk: { top: '#4b4a8a', mid: '#c46d7a', hor: '#f6b26b', far: '#a8657a', far2: '#8a536e', hill: '#6f6a6a', hill2: '#5d5a62', dark: 0.45 },
  night: { top: '#0f1435', mid: '#1f2a5a', hor: '#3b4a7a', far: '#2b3058', far2: '#242849', hill: '#1e2a3a', hill2: '#192331', dark: 0.8 },
};

export function createCutaway() {
  return { render, person, HARNESS_COL };

  function render(ctx, w, h, t, Pm) {
    const view = Pm.view || 'hero';
    if (view === 'sheet') return sheet(ctx, w, h, t);
    const time = Pm.time || (view === 'night' ? 'night' : 'day');
    const weather = Pm.weather || (view === 'night' ? 'rain' : 'clear');
    const S = SKY[time];
    const cam = camera(w, h, view, t, Pm.pan);
    const G = { ctx, t, time, weather, S, k: cam.k, dark: S.dark, lights: [], snow: weather === 'snow', rain: weather === 'rain' };
    ctx.save();
    sky(G, w, h, cam);
    ctx.translate(cam.ox, cam.oy);
    ctx.scale(cam.k, cam.k);
    G.lw = Math.max(1.6, 1.1 / cam.k);
    far(G, cam, w);
    ground(G);
    tubes(G);
    arrival(G);
    apartments(G);
    lounge(G);
    office(G, 790, 'ATLAS', [
      { id: 'reception', reception: true },
      { id: 'world', lit: true, people: [A.scout, A.wren, A.juniper] },
      { id: 'crew', lit: true, people: [A.otter, A.pixel] },
      { id: 'lab', lit: true, people: [null, A.hazel] },
      { id: 'docs', lit: false, people: [] },
    ], '#f2d38a', [A.maple, A.sable, A.lark]);
    post(G);
    hall(G);
    office(G, 1760, 'NIMBUS', [
      { id: 'reception', reception: true },
      { id: 'site', lit: true, people: [A.kite] },
      { id: 'api', lit: false, people: [] },
    ], '#8cc4bb', [A.sorrel]);
    library(G);
    harbor(G);
    street(G, cam);
    weatherFx(G, cam, w, h);
    // the lights pass: windows and lamps bloom after dark
    if (G.dark > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (const fn of G.lights) fn(ctx, G.dark);
      ctx.restore();
    }
    ctx.restore();
    if (view === 'hero' || view === 'night') caption(ctx, w, h, time, weather);
  }

  function camera(w, h, view, t, pan) {
    const L0 = -60, R0 = 3080, SW = R0 - L0;
    const views = {
      hero: { cx: (L0 + R0) / 2, k: w / SW, gy: 0.7 }, night: { cx: (L0 + R0) / 2, k: w / SW, gy: 0.7 },
      office: { cx: 985, kh: 1060, gy: 0.88 }, post: { cx: 1330, kh: 640, gy: 0.74 }, hall: { cx: 1580, kh: 720, gy: 0.78 },
      harbor: { cx: 2640, kh: 640, gy: 0.62 }, apartments: { cx: 470, kh: 760, gy: 0.82 }, arrival: { cx: 200, kh: 900, gy: 0.74 }, phone: { cx: 980, kh: 900, gy: 0.68 },
    };
    const v = views[view] || views.hero;
    let k = v.k || h / v.kh;
    let cx = v.cx, roam = view === 'phone';
    if ((view === 'hero' || view === 'night') && w / h < 1.25) { k = h / 1250; roam = true; }
    if (roam) {
      const span = SW - w / k;
      const ph = (t * 0.014) % 2;
      cx = L0 + w / k / 2 + span * ease(ph < 1 ? ph : 2 - ph);
    }
    if (pan && pan[0]) cx -= pan[0] / k;
    cx = clamp(cx, L0 + w / k / 2, R0 - w / k / 2);
    if (w / k > SW) cx = (L0 + R0) / 2;
    return { k, ox: w / 2 - cx * k, oy: h * v.gy, cx, view };
  }

  // ---------- ink helpers ----------
  function ink(G, fill, path, lw) {
    const { ctx } = G;
    path();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = INK; ctx.lineWidth = lw || G.lw; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
  }
  function rect(G, x, y, w, h, fill, lw) { ink(G, fill, () => { G.ctx.beginPath(); G.ctx.rect(x, y, w, h); }, lw); }
  function nightTint(G, c, k = 1) { return G.dark ? mix(c, '#1b2148', G.dark * 0.62 * k) : c; }
  function hatch(G, x, y, w, h, gap = 9, a = 0.35) {
    const { ctx } = G;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.strokeStyle = `rgba(31,27,43,${a})`; ctx.lineWidth = G.lw * 0.6;
    ctx.beginPath(); for (let i = -h; i < w; i += gap) { ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + h, y); } ctx.stroke();
    ctx.restore();
  }
  function text(G, s, x, y, size, col, o = {}) {
    const { ctx } = G;
    ctx.save(); ctx.font = `${o.weight || 400} ${size}px ${o.font || SIGN}`; ctx.textAlign = o.align || 'center'; ctx.textBaseline = 'middle';
    if (o.stroke) { ctx.lineWidth = o.stroke; ctx.strokeStyle = INK; ctx.lineJoin = 'round'; ctx.strokeText(s, x, y); }
    ctx.fillStyle = col; ctx.fillText(s, x, y); ctx.restore();
  }
  function glowAt(G, x, y, r, col, a = 1) {
    G.lights.push((c, d) => { const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, css(col, a * d)); g.addColorStop(1, css(col, 0)); c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); });
  }

  // ---------- sky and far layers ----------
  function sky(G, w, h, cam) {
    const { ctx, S, t, time } = G;
    const g = ctx.createLinearGradient(0, 0, 0, cam.oy);
    g.addColorStop(0, S.top); g.addColorStop(0.6, S.mid); g.addColorStop(1, S.hor);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    if (time === 'night') {
      const r = rng(2);
      for (let i = 0; i < 140; i++) { const x = r() * w, y = r() * cam.oy * 0.85, tw = 0.5 + 0.5 * Math.sin(t * (1 + r() * 2) + i); ctx.fillStyle = `rgba(255,250,220,${0.25 + 0.6 * tw * r()})`; ctx.fillRect(x, y, 1.5, 1.5); }
      // moon with ligne-claire outline
      const mx = w * 0.82, my = cam.oy * 0.22, mr = Math.min(w, h) * 0.05;
      ctx.fillStyle = '#fff3c4'; ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(mx, my, mr, Math.PI * 0.5, Math.PI * 1.5); ctx.ellipse(mx, my, mr * 0.45, mr, 0, Math.PI * 1.5, Math.PI * 0.5, true); ctx.fill(); ctx.stroke();
    } else {
      // a big flat sun with rays, like a printed poster
      const sx = w * 0.78, sy = cam.oy * (time === 'dusk' ? 0.72 : 0.25), sr = Math.min(w, h) * 0.07;
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(t * 0.02);
      ctx.fillStyle = time === 'dusk' ? 'rgba(255,170,90,0.35)' : 'rgba(255,240,180,0.45)';
      for (let i = 0; i < 16; i++) { ctx.rotate(TAU / 16); ctx.beginPath(); ctx.moveTo(sr * 1.15, -sr * 0.12); ctx.lineTo(sr * 2.6, 0); ctx.lineTo(sr * 1.15, sr * 0.12); ctx.fill(); }
      ctx.restore();
      ctx.fillStyle = time === 'dusk' ? '#ff9a5a' : '#ffe58a'; ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx, sy, sr, 0, TAU); ctx.fill(); ctx.stroke();
    }
    // clouds: flat ligne-claire shapes drifting
    const r = rng(6), n = G.weather === 'clear' ? 4 : 8;
    for (let i = 0; i < n; i++) {
      const cw = (60 + r() * 90) * Math.max(0.7, cam.k * 2), x = ((r() * w * 1.3 + t * (6 + r() * 8)) % (w + cw * 2)) - cw, y = cam.oy * (0.08 + r() * 0.35);
      const col = G.weather === 'clear' ? (time === 'night' ? '#3a4576' : '#fffaf0') : time === 'night' ? '#2c3460' : '#c9ced8';
      ctx.fillStyle = col; ctx.strokeStyle = INK; ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x - cw * 0.05, y - cw * 0.25, x + cw * 0.25, y - cw * 0.35, x + cw * 0.35, y - cw * 0.18);
      ctx.bezierCurveTo(x + cw * 0.45, y - cw * 0.45, x + cw * 0.85, y - cw * 0.4, x + cw * 0.8, y - cw * 0.12);
      ctx.bezierCurveTo(x + cw * 1.05, y - cw * 0.1, x + cw * 1.05, y + cw * 0.02, x + cw * 0.95, y);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // birds
    if (time !== 'night') {
      ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
      for (let i = 0; i < 5; i++) { const bx = ((t * 18 + i * 60) % (w + 100)) - 50, by = cam.oy * 0.3 + Math.sin(t * 0.8 + i) * 10 + i * 9, f = Math.sin(t * 8 + i) * 3; ctx.beginPath(); ctx.moveTo(bx - 6, by - f); ctx.quadraticCurveTo(bx - 2, by - 3, bx, by); ctx.quadraticCurveTo(bx + 2, by - 3, bx + 6, by - f); ctx.stroke(); }
    }
  }
  function far(G, cam, w) {
    // mesas and hills move slower than the street (parallax)
    const { ctx, S } = G;
    const par = (f) => (cam.cx - WS / 2) * (1 - f);
    ctx.save(); ctx.translate(par(0.35), 0);
    const r = rng(12);
    ctx.fillStyle = S.far; ctx.strokeStyle = INK; ctx.lineWidth = G.lw;
    for (let i = -2; i < 9; i++) {
      const x = i * 420 + r() * 120, top = -260 - r() * 220, wd = 220 + r() * 200;
      ctx.beginPath(); ctx.moveTo(x - 40, 0); ctx.lineTo(x, top + 30); ctx.lineTo(x + 20, top); ctx.lineTo(x + wd, top); ctx.lineTo(x + wd + 25, top + 40); ctx.lineTo(x + wd + 70, 0); ctx.closePath();
      ctx.fillStyle = i % 2 ? S.far : S.far2; ctx.fill(); ctx.stroke();
      // strata lines
      ctx.save(); ctx.clip(); ctx.strokeStyle = 'rgba(31,27,43,0.25)'; ctx.lineWidth = G.lw * 0.6;
      for (let y = top + 40; y < 0; y += 34) { ctx.beginPath(); ctx.moveTo(x - 50, y); ctx.lineTo(x + wd + 80, y + 6); ctx.stroke(); }
      ctx.restore();
    }
    ctx.restore();
    ctx.save(); ctx.translate(par(0.65), 0);
    ctx.fillStyle = S.hill; ctx.strokeStyle = INK; ctx.lineWidth = G.lw;
    ctx.beginPath(); ctx.moveTo(-600, 0);
    for (let x = -600; x <= WS + 600; x += 60) ctx.lineTo(x, -70 - Math.sin(x * 0.004) * 50 - Math.sin(x * 0.011) * 20);
    ctx.lineTo(WS + 600, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    // tiny far houses with lit windows at night
    const r2 = rng(31);
    for (let i = 0; i < 26; i++) {
      const x = -400 + i * 140 + r2() * 60, base = -70 - Math.sin(x * 0.004) * 50 - Math.sin(x * 0.011) * 20 + 8;
      rect(G, x, base - 26, 22, 26, nightTint(G, ['#f1e3c6', '#e9b08a', '#cfe3d9'][i % 3]), G.lw * 0.7);
      ink(G, nightTint(G, '#c8553d'), () => { ctx.beginPath(); ctx.moveTo(x - 3, base - 26); ctx.lineTo(x + 11, base - 38); ctx.lineTo(x + 25, base - 26); ctx.closePath(); }, G.lw * 0.7);
      if (G.dark && r2() < 0.6) glowAt(G, x + 11 + par(0.65), base - 14, 16, '#ffd27a', 0.7);
    }
    ctx.restore();
  }
  function ground(G) {
    const { ctx } = G;
    // sidewalk, street and the cut-away ground with strata and a basement
    rect(G, -200, 0, WS + 400, 14, nightTint(G, '#e8d4ad'));
    rect(G, -200, 14, WS + 400, 40, nightTint(G, '#6d6a7a'));
    ctx.strokeStyle = nightTint(G, '#f4e9c8'); ctx.lineWidth = 3; ctx.setLineDash([26, 22]);
    ctx.beginPath(); ctx.moveTo(-200, 34); ctx.lineTo(2420, 34); ctx.stroke(); ctx.setLineDash([]);
    rect(G, -200, 54, WS + 400, 10, nightTint(G, '#e8d4ad'));
    ink(G, nightTint(G, '#b07a58'), () => { ctx.beginPath(); ctx.rect(-400, 64, 2820, 1600); });
    const r = rng(8);
    ctx.strokeStyle = 'rgba(31,27,43,0.25)'; ctx.lineWidth = G.lw * 0.6;
    for (let y = 100; y < 400; y += 44) { ctx.beginPath(); ctx.moveTo(-200, y); for (let x = -200; x < 2420; x += 80) ctx.lineTo(x, y + Math.sin(x * 0.01 + y) * 6); ctx.stroke(); }
    for (let i = 0; i < 120; i++) { ctx.fillStyle = 'rgba(70,40,30,0.35)'; ctx.beginPath(); ctx.ellipse(-200 + r() * 2620, 80 + r() * 300, 3 + r() * 6, 2 + r() * 3, 0, 0, TAU); ctx.fill(); }
  }

  // ---------- figures: profile ligne-claire people ----------
  function person(ctx, x, y, a, t, o = {}, G0 = null) {
    const G = G0 || { ctx, lw: 1.8 };
    const col = HARNESS_COL[a.h] || '#888', s = o.s || 1, dir = o.flip ? -1 : 1;
    const st = o.pose || ({ working: 'sit', thinking: 'sit', idle: 'bar', walking: 'walk', asleep: 'sleep', bus: 'sit' }[a.s] || 'stand');
    const ph = (a.n.charCodeAt(0) * 0.53 + a.n.length) % TAU;
    ctx.save(); ctx.translate(x, y); ctx.scale(s * dir, s);
    const lw = G.lw / s;
    const stroke = () => { ctx.strokeStyle = INK; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); };
    const fill = (c) => { ctx.fillStyle = c; ctx.fill(); stroke(); };
    if (st === 'sleep') {
      // lying in bed: just the head on the pillow and the quilt hump
      const br = Math.sin(t * 1.3 + ph) * 1.5;
      ctx.beginPath(); ctx.moveTo(-6, -8); ctx.quadraticCurveTo(20, -26 - br, 52, -16 - br * 0.5); ctx.quadraticCurveTo(70, -12, 78, -2); ctx.lineTo(-6, -2); ctx.closePath(); fill(col);
      ctx.beginPath(); ctx.arc(-16, -14, 11, 0, TAU); fill(SKIN);
      hatOn(ctx, a.h, col, -16, -14, -1.2, fill);
      ctx.beginPath(); ctx.moveTo(-20, -14); ctx.lineTo(-14, -14); stroke();
      ctx.restore();
      return;
    }
    const sit = st === 'sit' || st === 'bar';
    const hip = sit ? (st === 'bar' ? -40 : -30) : -32;
    const sw = st === 'walk' ? Math.sin(t * 7 + ph) : 0, bob = st === 'walk' ? Math.abs(Math.cos(t * 7 + ph)) * 2 : 0;
    ctx.translate(0, -bob);
    // legs
    ctx.strokeStyle = PANTS; ctx.lineWidth = 7; ctx.lineCap = 'round';
    if (sit) {
      ctx.beginPath(); ctx.moveTo(0, hip); ctx.lineTo(16, hip); ctx.lineTo(16, st === 'bar' ? hip + 26 : 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-2, hip + 2); ctx.lineTo(13, hip + 3); ctx.lineTo(12, st === 'bar' ? hip + 28 : 0); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(0, hip); ctx.lineTo(sw * 10, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, hip); ctx.lineTo(-sw * 10, 0); ctx.stroke();
    }
    // shoes
    ctx.fillStyle = INK;
    if (!sit) { ctx.beginPath(); ctx.ellipse(sw * 10 + 3, -2, 5, 3, 0, 0, TAU); ctx.ellipse(-sw * 10 + 3, -2, 5, 3, 0, 0, TAU); ctx.fill(); }
    else { ctx.beginPath(); ctx.ellipse(19, st === 'bar' ? hip + 28 : -2, 5, 3, 0, 0, TAU); ctx.fill(); }
    // coat
    const top = hip - 28;
    ctx.beginPath(); ctx.moveTo(-9, top + 2); ctx.quadraticCurveTo(-12, hip, -12, hip + (sit ? 4 : 12)); ctx.lineTo(10, hip + (sit ? 4 : 12)); ctx.quadraticCurveTo(10, hip - 6, 8, top + 2); ctx.quadraticCurveTo(0, top - 3, -9, top + 2); ctx.closePath();
    fill(col);
    // arm, by pose
    ctx.beginPath();
    if (o.arm === 'type' || (a.s === 'working' && sit)) { const k = Math.sin(t * 14 + ph) * 1.5; ctx.moveTo(1, top + 6); ctx.lineTo(12, top + 22); ctx.lineTo(24, top + 20 + k); }
    else if (a.s === 'thinking') { ctx.moveTo(1, top + 6); ctx.lineTo(10, top + 22); ctx.lineTo(9, top - 4); }
    else if (a.s === 'needs') { const k = Math.sin(t * 5 + ph) * 4; ctx.moveTo(1, top + 6); ctx.lineTo(10, top - 6); ctx.lineTo(12 + k * 0.3, top - 24 + k); }
    else if (a.s === 'done' || a.s === 'idle') { ctx.moveTo(1, top + 6); ctx.lineTo(10, top + 18); ctx.lineTo(20, top + 10); }
    else { ctx.moveTo(1, top + 6); ctx.lineTo(sw * -8 + 2, top + 26); }
    ctx.strokeStyle = shadeInk(col); ctx.lineWidth = 6; ctx.stroke();
    // head in profile
    const hy = top - 13;
    ctx.beginPath(); ctx.arc(0, hy, 11, 0, TAU); fill(SKIN);
    ctx.beginPath(); ctx.moveTo(10, hy - 2); ctx.quadraticCurveTo(15, hy + 1, 10, hy + 3); fill(SKIN);
    const blink = Math.sin(t * 0.8 + ph * 2) > 0.97;
    ctx.fillStyle = INK; if (!blink) { ctx.beginPath(); ctx.arc(5, hy - 2, 1.6, 0, TAU); ctx.fill(); } else { ctx.fillRect(3, hy - 2, 4, 1); }
    ctx.beginPath(); ctx.moveTo(4, hy + 6); ctx.quadraticCurveTo(7, hy + 7, 9, hy + 6); ctx.lineWidth = lw * 0.8; ctx.stroke();
    hatOn(ctx, a.h, col, 0, hy, 0, fill);
    // props
    if (a.s === 'idle' && st === 'bar') { ctx.beginPath(); ctx.rect(19, top + 2, 8, 11); fill('#f6c34a'); ctx.fillStyle = '#fffaf0'; ctx.fillRect(19.5, top + 2.5, 7, 3); }
    if (a.s === 'done') { ctx.save(); ctx.translate(22, top + 4); ctx.rotate(-0.2); ctx.beginPath(); ctx.rect(-2, -14, 16, 20); fill('#fffaf0'); ctx.beginPath(); ctx.arc(6, -4, 6, 0, TAU); ctx.fillStyle = '#3f9a5b'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(3, -4); ctx.lineTo(5.5, -1.5); ctx.lineTo(9, -7); ctx.stroke(); ctx.restore(); }
    ctx.restore();
  }
  function shadeInk(c) { return mix(c, INK, 0.28); }
  function hatOn(ctx, h, col, x, y, rot, fill) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.beginPath();
    if (h === 'claude') { ctx.ellipse(1, -8, 17, 4, 0, 0, TAU); fill(mix(col, INK, 0.45)); ctx.beginPath(); ctx.moveTo(-8, -9); ctx.quadraticCurveTo(-7, -21, 2, -21); ctx.quadraticCurveTo(10, -21, 10, -9); ctx.closePath(); fill(mix(col, INK, 0.45)); ctx.beginPath(); ctx.rect(-8, -12, 18, 3); fill(col); }
    else if (h === 'codex') { ctx.moveTo(-11, -4); ctx.quadraticCurveTo(-11, -16, 0, -16); ctx.quadraticCurveTo(11, -16, 11, -6); ctx.lineTo(20, -5); ctx.lineTo(19, -2); ctx.lineTo(-11, -3); ctx.closePath(); fill(mix(col, INK, 0.15)); }
    else if (h === 'gemini') { ctx.moveTo(-11, -4); ctx.quadraticCurveTo(-10, -18, 0, -17); ctx.quadraticCurveTo(10, -17, 11, -4); ctx.closePath(); fill(col); ctx.beginPath(); ctx.arc(-5, -19, 4, 0, TAU); fill('#f6d55c'); ctx.beginPath(); ctx.arc(5, -20, 4, 0, TAU); fill('#f6d55c'); }
    else { ctx.moveTo(-12, 4); ctx.quadraticCurveTo(-14, -14, 0, -14); ctx.quadraticCurveTo(10, -14, 11, -4); ctx.lineTo(4, -4); ctx.lineTo(-4, 6); ctx.closePath(); fill(col); for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(-8 + i * 6, -13 + i * 0.5); ctx.lineTo(-5 + i * 6, -20); ctx.lineTo(-2 + i * 6, -13); fill(mix(col, '#ffffff', 0.3)); } }
    ctx.restore();
  }
  function balloon(G, x, y, tx, ty, txt, o = {}) {
    // a comic speech balloon pointing at (tx, ty)
    const { ctx } = G, size = o.size || 15;
    ctx.save();
    ctx.font = `700 ${size}px ${COMIC}`;
    const tw = ctx.measureText(txt).width, bw = tw + size * 1.4, bh = size * 2.0;
    ctx.beginPath();
    ctx.ellipse(x, y, bw / 2, bh / 2, 0, 0, TAU);
    ctx.moveTo(x - size * 0.4, y + bh * 0.35); ctx.lineTo(tx, ty); ctx.lineTo(x + size * 0.3, y + bh * 0.42);
    ctx.fillStyle = o.fill || '#fffdf5'; ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = G.lw; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x, y, bw / 2 - 0.5, bh / 2 - 0.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = o.color || INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, x, y + 1);
    ctx.restore();
  }
  function thought(G, x, y, t, ph) {
    const { ctx } = G;
    for (const [dx, dy, r] of [[4, -6, 3], [9, -16, 5]]) { ctx.beginPath(); ctx.arc(x + dx, y + dy, r, 0, TAU); ctx.fillStyle = '#fffdf5'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = G.lw * 0.8; ctx.stroke(); }
    const cx = x + 22, cy = y - 38;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; ctx.moveTo(cx + Math.cos(a) * 22 + 9, cy + Math.sin(a) * 13); ctx.arc(cx + Math.cos(a) * 22, cy + Math.sin(a) * 13, 9, 0, TAU); }
    ctx.fillStyle = '#fffdf5'; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx, cy, 24, 15, 0, 0, TAU); ctx.fill();
    for (let i = 0; i < 3; i++) { ctx.fillStyle = Math.floor(t * 2.5 + ph) % 4 > i ? INK : 'rgba(31,27,43,0.2)'; ctx.beginPath(); ctx.arc(cx - 9 + i * 9, cy, 2.6, 0, TAU); ctx.fill(); }
  }
  function zzz(G, x, y, t) {
    for (let i = 0; i < 3; i++) {
      const k = (t * 0.3 + i / 3) % 1;
      G.ctx.globalAlpha = Math.sin(k * Math.PI);
      text(G, 'Z', x + k * 20 + i * 4, y - k * 40, 11 + k * 8, '#fffdf5', { font: COMIC, weight: 700, stroke: G.lw * 1.4 });
      G.ctx.globalAlpha = 1;
    }
  }

  // ---------- building kit ----------
  // A building sliced open: floors from the ground up, thick cut walls, a roof.
  function section(G, x, w, floors, o) {
    const { ctx } = G;
    let y = 0;
    const tops = [];
    floors.forEach((f) => {
      const fh = f.h || 130, y0 = y - fh;
      const lit = !!f.lit, bg = f.bg || (lit ? '#fff1c8' : '#3f4668');
      // back wall
      rect(G, x, y0, w, fh, G.dark && lit ? mix(bg, '#ffd27a', 0.2) : nightTint(G, bg, lit ? 0.25 : 1));
      if (f.paper) { ctx.save(); ctx.beginPath(); ctx.rect(x, y0, w, fh - 10); ctx.clip(); ctx.strokeStyle = css(f.paper, lit ? 0.55 : 0.2); ctx.lineWidth = 6; for (let i = x + 10; i < x + w; i += 22) { ctx.beginPath(); ctx.moveTo(i, y0); ctx.lineTo(i, y - 30); ctx.stroke(); } ctx.restore(); rect(G, x, y - 34, w, 24, nightTint(G, f.paper, lit ? 0.3 : 1)); }
      if (!lit && !f.noShade) { ctx.fillStyle = 'rgba(15,18,40,0.25)'; ctx.fillRect(x, y0, w, fh); }
      if (lit) glowAt(G, x + w / 2, y0 + fh * 0.55, Math.max(w, fh) * 0.7, '#ffcf73', 0.35);
      f.draw && f.draw(x, y0, w, fh, y);
      // floor slab
      rect(G, x - 8, y - 10, w + 16, 10, nightTint(G, o.slab || '#d9c9a6'));
      tops.push(y0);
      y = y0 - 10;
    });
    // cut walls on both sides, hatched like a section drawing
    const H = -y;
    for (const wx of [x - 16, x + w]) { rect(G, wx, y, 16, H, nightTint(G, o.wall)); hatch(G, wx, y, 16, H, 7, 0.45); }
    return { top: y, tops };
  }
  function lamp(G, x, y) {
    const { ctx } = G;
    ctx.strokeStyle = INK; ctx.lineWidth = G.lw * 0.7; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 16); ctx.stroke();
    ink(G, '#f6c34a', () => { ctx.beginPath(); ctx.moveTo(x - 10, y + 26); ctx.lineTo(x - 5, y + 16); ctx.lineTo(x + 5, y + 16); ctx.lineTo(x + 10, y + 26); ctx.closePath(); }, G.lw * 0.8);
    glowAt(G, x, y + 34, 70, '#ffd27a', 0.55);
  }
  function deskSet(G, x, floorY, a, lit, col, t) {
    // a desk with a screen; the agent sits at it facing right
    const { ctx } = G;
    if (a) person(ctx, x, floorY, a, t, {}, G);
    // chair
    ink(G, nightTint(G, '#6b5a8a'), () => { ctx.beginPath(); ctx.rect(x - 14, floorY - 30, 4, 30); ctx.rect(x - 12, floorY - 31, 22, 5); });
    // desk
    rect(G, x + 18, floorY - 36, 46, 6, nightTint(G, '#c08a5b'));
    ink(G, null, () => { ctx.beginPath(); ctx.moveTo(x + 22, floorY - 30); ctx.lineTo(x + 22, floorY); ctx.moveTo(x + 60, floorY - 30); ctx.lineTo(x + 60, floorY); });
    // monitor
    rect(G, x + 36, floorY - 66, 24, 26, '#2a2f45');
    if (a && lit) {
      ctx.fillStyle = mix(col, '#ffffff', 0.4); ctx.fillRect(x + 39, floorY - 63, 18, 20);
      ctx.fillStyle = INK; for (let i = 0; i < 4; i++) ctx.fillRect(x + 41, floorY - 60 + i * 4.5, 6 + ((i * 7 + Math.floor(t * 3)) % 9), 1.6);
      glowAt(G, x + 48, floorY - 53, 30, '#aee6ff', 0.6);
    }
    ink(G, null, () => { ctx.beginPath(); ctx.moveTo(x + 48, floorY - 40); ctx.lineTo(x + 48, floorY - 36); });
    if (a && a.s === 'thinking') thought(G, x + 6, floorY - 86, t, x * 0.01);
  }
  function plant(G, x, y) {
    const { ctx } = G;
    ink(G, nightTint(G, '#c8553d'), () => { ctx.beginPath(); ctx.moveTo(x - 9, y - 18); ctx.lineTo(x + 9, y - 18); ctx.lineTo(x + 6, y); ctx.lineTo(x - 6, y); ctx.closePath(); });
    for (const [dx, dy, r] of [[-6, -30, 8], [6, -32, 8], [0, -40, 9]]) ink(G, nightTint(G, '#5f9e5d'), () => { ctx.beginPath(); ctx.ellipse(x + dx, y + dy, r * 0.6, r, dx * 0.05, 0, TAU); }, G.lw * 0.8);
  }
  function roofSign(G, x, y, label, bg, fg) {
    const { ctx } = G;
    ctx.save(); ctx.font = `400 34px ${SIGN}`; const tw = ctx.measureText(label).width; ctx.restore();
    ink(G, null, () => { ctx.beginPath(); ctx.moveTo(x - tw / 2 + 10, y); ctx.lineTo(x - tw / 2 + 10, y - 14); ctx.moveTo(x + tw / 2 - 10, y); ctx.lineTo(x + tw / 2 - 10, y - 14); });
    rect(G, x - tw / 2 - 14, y - 58, tw + 28, 44, bg);
    text(G, label, x, y - 35, 34, fg);
    if (G.dark) G.lights.push((c, d) => { c.save(); c.font = `400 34px ${SIGN}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.shadowColor = fg; c.shadowBlur = 14; c.fillStyle = css(fg, 0.5 * d); c.fillText(label, x, y - 35); c.restore(); });
  }
  function snowCap(G, x, y, w) {
    if (!G.snow) return;
    const { ctx } = G;
    ink(G, '#ffffff', () => { ctx.beginPath(); ctx.moveTo(x - 4, y + 2); for (let i = 0; i <= 10; i++) ctx.lineTo(x + (i / 10) * w, y - 7 - Math.sin(i * 1.7) * 3); ctx.lineTo(x + w + 4, y + 2); ctx.quadraticCurveTo(x + w * 0.7, y + 9, x + w * 0.5, y + 4); ctx.quadraticCurveTo(x + w * 0.2, y + 10, x - 4, y + 2); ctx.closePath(); }, G.lw * 0.8);
  }

  // ---------- buildings ----------
  function apartments(G) {
    const { ctx, t } = G, x = 300, w = 230;
    const units = [[A.tansy, null], [null, A.bram], [A.olive, null], [null, null]];
    const floors = units.map((pair, i) => ({
      h: 110, lit: !!(pair[0] || pair[1]), bg: pair[0] || pair[1] ? '#ffe9c4' : '#3f4668', paper: '#c9a9d6', noShade: false,
      draw: (fx, y0, fw, fh, fy) => {
        pair.forEach((who, j) => {
          const bx = fx + 12 + j * (fw / 2);
          // bed frame, pillow, quilt
          rect(G, bx, fy - 26, 86, 14, nightTint(G, '#c08a5b'));
          rect(G, bx - 4, fy - 52, 8, 52, nightTint(G, '#c08a5b'));
          rect(G, bx + 4, fy - 34, 24, 10, '#ffffff');
          if (who) { person(ctx, bx + 26, fy - 26, who, t, {}, G); if (i === 1) zzz(G, bx + 10, fy - 50, t); }
          else rect(G, bx + 4, fy - 34, 80, 8, nightTint(G, '#9aa3c0'));
          // a night window above each bed
          rect(G, bx + 40, y0 + 14, 30, 30, G.dark ? '#24306a' : '#bfe6f0');
          ctx.strokeStyle = INK; ctx.lineWidth = G.lw * 0.6; ctx.beginPath(); ctx.moveTo(bx + 55, y0 + 14); ctx.lineTo(bx + 55, y0 + 44); ctx.stroke();
        });
        ctx.strokeStyle = INK; ctx.lineWidth = G.lw; ctx.beginPath(); ctx.moveTo(fx + fw / 2, y0); ctx.lineTo(fx + fw / 2, fy - 10); ctx.stroke();
      },
    }));
    const s = section(G, x, w, floors, { wall: '#e9a07a' });
    // water tower on the roof
    rect(G, x - 16, s.top - 10, w + 32, 12, nightTint(G, '#c8553d'));
    snowCap(G, x - 16, s.top - 10, w + 32);
    ink(G, nightTint(G, '#a46a4a'), () => { ctx.beginPath(); ctx.rect(x + 140, s.top - 80, 50, 50); });
    ink(G, nightTint(G, '#8a5a35'), () => { ctx.beginPath(); ctx.moveTo(x + 134, s.top - 80); ctx.lineTo(x + 165, s.top - 104); ctx.lineTo(x + 196, s.top - 80); ctx.closePath(); });
    ink(G, null, () => { ctx.beginPath(); ctx.moveTo(x + 145, s.top - 30); ctx.lineTo(x + 140, s.top - 10); ctx.moveTo(x + 185, s.top - 30); ctx.lineTo(x + 190, s.top - 10); });
    roofSign(G, x + 70, s.top - 10, 'APTS', '#5b6fb5', '#fff3c4');
  }
  function lounge(G) {
    const { ctx, t } = G, x = 556, w = 200;
    const s = section(G, x, w, [
      { h: 150, lit: true, bg: '#5b3f7a', draw: (fx, y0, fw, fh, fy) => {
        // back bar with bottles, counter, stools, a jukebox
        rect(G, fx + 10, y0 + 24, fw - 20, 50, nightTint(G, '#3a2850', 0.3));
        for (let i = 0; i < 9; i++) { const bx = fx + 20 + i * 18; ink(G, ['#7cf29a', '#ffd166', '#ff7b9c', '#7fe7ff'][i % 4], () => { ctx.beginPath(); ctx.rect(bx, y0 + 46, 8, 22); ctx.rect(bx + 2.5, y0 + 40, 3, 6); }, G.lw * 0.6); }
        // string lights
        const bulbs = []; for (let i = 0; i <= 10; i++) bulbs.push([fx + (i / 10) * fw, y0 + 12 + Math.sin((i / 10) * Math.PI) * 12]);
        ctx.strokeStyle = INK; ctx.lineWidth = G.lw * 0.6; ctx.beginPath(); bulbs.forEach(([bx, by], i) => (i ? ctx.lineTo(bx, by) : ctx.moveTo(bx, by))); ctx.stroke();
        bulbs.forEach(([bx, by], i) => { ctx.fillStyle = ['#ffd166', '#ff7b9c', '#7cf29a'][i % 3]; ctx.beginPath(); ctx.arc(bx, by + 4, 4, 0, TAU); ctx.fill(); glowAt(G, bx, by + 4, 22, '#ffcf73', 0.8); });
        person(ctx, fx + 40, fy, A.moss, t, {}, G);
        person(ctx, fx + 104, fy, A.ember, t, { flip: false }, G);
        rect(G, fx + 20, fy - 50, 140, 10, nightTint(G, '#8a5a35', 0.3));
        for (const sx of [fx + 52, fx + 116]) { ink(G, '#f6c34a', () => { ctx.beginPath(); ctx.rect(sx - 8, fy - 44, 18, 5); }); ink(G, null, () => { ctx.beginPath(); ctx.moveTo(sx, fy - 39); ctx.lineTo(sx, fy); }); }
        rect(G, fx + 168, fy - 70, 26, 70, '#ff7b9c');
        ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(fx + 181, fy - 52, 8, Math.PI, 0); ctx.fill();
        glowAt(G, fx + 181, fy - 50, 40, '#ff7b9c', 0.8);
        // music notes drifting out of the jukebox
        for (let i = 0; i < 2; i++) { const k = (t * 0.4 + i * 0.5) % 1; ctx.globalAlpha = Math.sin(k * Math.PI); text(G, '♪', fx + 175 - k * 30, fy - 80 - k * 40, 16, INK, { font: COMIC, weight: 700 }); ctx.globalAlpha = 1; }
      } },
    ], { wall: '#6c5ba8' });
    // awning and a neon script sign
    ink(G, nightTint(G, '#ff7b9c'), () => { ctx.beginPath(); ctx.moveTo(x - 24, s.top + 2); ctx.lineTo(x + w + 24, s.top + 2); ctx.lineTo(x + w + 10, s.top - 24); ctx.lineTo(x - 10, s.top - 24); ctx.closePath(); });
    for (let i = 0; i < 8; i++) { ctx.fillStyle = nightTint(G, '#fff3c4'); ctx.fillRect(x - 10 + i * 30, s.top - 23, 14, 24); }
    snowCap(G, x - 12, s.top - 24, w + 24);
    ink(G, '#2a1f3d', () => { ctx.beginPath(); ctx.rect(x + 20, s.top - 92, 160, 56); });
    text(G, 'Lounge', x + 100, s.top - 64, 32, '#ff9ad5', { font: '"Pacifico", "Brush Script MT", cursive' });
    glowAt(G, x + 100, s.top - 64, 110, '#ff6ac1', 0.6);
  }
  function office(G, x, name, floors, wall, queue) {
    const { ctx, t } = G, w = name === 'ATLAS' ? 380 : 230;
    const FL = floors.map((f) => ({
      h: f.reception ? 186 : 132, lit: f.reception || f.lit, bg: f.reception ? '#f4ead2' : f.lit ? '#fff1c8' : '#3f4668', paper: f.reception ? null : PROJ[f.id],
      draw: (fx, y0, fw, fh, fy) => {
        if (f.reception) {
          // counter, bell, the waiting queue facing it, oldest first
          rect(G, fx + 14, fy - 50, 70, 50, nightTint(G, '#5e7fa3', 0.3));
          text(G, 'RECEPTION', fx + 49, fy - 26, 10, '#fff3c4');
          ink(G, '#f6c34a', () => { ctx.beginPath(); ctx.arc(fx + 70, fy - 52, 6, Math.PI, 0); });
          queue.forEach((a, i) => {
            const qx = fx + 118 + i * 56;
            person(ctx, qx, fy, a, t, { flip: true }, G);
            if (a.s === 'needs') {
              const q = ['Ship v2.1 tonight?', 'Rebase onto main?', 'Which port?'][i % 3];
              const by = y0 + 20 + i * 32;
              balloon(G, Math.min(qx + 40, fx + fw - 70), by, qx + 4, fy - 78, q, { size: 11, fill: '#fff6d6' });
            }
            if (a.s === 'done') balloon(G, Math.min(qx + 30, fx + fw - 40), y0 + 20 + i * 32, qx - 2, fy - 78, 'Done!', { size: 11, fill: '#e3f7e6', color: '#22663a' });
          });
          // door
          rect(G, fx + fw - 40, fy - 80, 32, 80, nightTint(G, '#8a5a35'));
          return;
        }
        rect(G, fx + 8, fy - 34 - 70, 0.01, 0.01, null);
        const n = Math.max(2, Math.floor(fw / 120));
        for (let i = 0; i < n; i++) deskSet(G, fx + 30 + i * (fw - 40) / n, fy - 10, f.people[i] || null, f.lit, PROJ[f.id], t);
        if (f.lit) lamp(G, fx + fw / 2, y0);
        plant(G, fx + fw - 18, fy - 10);
        // room name on a little plaque
        rect(G, fx + 8, y0 + 8, 64, 20, f.lit ? '#fffdf5' : '#5d6488');
        text(G, f.id, fx + 40, y0 + 18, 13, f.lit ? INK : '#c9cde0', { font: COMIC, weight: 700 });
        if (!f.lit) text(G, 'empty', fx + fw / 2, y0 + fh / 2, 14, 'rgba(220,225,245,0.5)', { font: COMIC, weight: 700 });
      },
    }));
    const s = section(G, x, w, FL, { wall });
    // elevator shaft with a moving car
    const shaftX = x + w + 16, H = -s.top;
    rect(G, shaftX, s.top, 36, H, nightTint(G, '#cbbfa6'));
    hatch(G, shaftX, s.top, 36, H, 12, 0.18);
    const ky = -((Math.sin(t * 0.35) * 0.5 + 0.5) * (H - 120)) - 70;
    rect(G, shaftX + 4, ky, 28, 60, nightTint(G, '#f6c34a'));
    if (G.dark) glowAt(G, shaftX + 18, ky + 30, 40, '#ffd27a', 0.7);
    ink(G, null, () => { ctx.beginPath(); ctx.moveTo(shaftX + 18, s.top); ctx.lineTo(shaftX + 18, ky); });
    // roof: cornice, antenna with a blinking light, the host sign
    rect(G, x - 24, s.top - 14, w + 48 + 36, 14, nightTint(G, mix(wall, INK, 0.25)));
    snowCap(G, x - 24, s.top - 14, w + 84);
    ink(G, null, () => { ctx.beginPath(); ctx.moveTo(x + w - 20, s.top - 14); ctx.lineTo(x + w - 20, s.top - 120); ctx.moveTo(x + w - 34, s.top - 70); ctx.lineTo(x + w - 6, s.top - 70); });
    if (Math.sin(t * 3) > 0) { ctx.fillStyle = '#ff4d4d'; ctx.beginPath(); ctx.arc(x + w - 20, s.top - 122, 4, 0, TAU); ctx.fill(); glowAt(G, x + w - 20, s.top - 122, 24, '#ff4d4d', 1); }
    roofSign(G, x + w / 2 - 20, s.top - 14, name, '#c8553d', '#fff3c4');
  }
  function post(G) {
    const { ctx, t } = G, x = 1215, w = 170;
    const s = section(G, x, w, [
      { h: 140, lit: true, bg: '#f9e7d0', draw: (fx, y0, fw, fh, fy) => {
        // the arrivals hall: tube outlets drop capsules into a basket
        rect(G, fx + 10, fy - 56, 80, 56, nightTint(G, '#c8553d', 0.3));
        text(G, 'NEEDS YOU', fx + 50, fy - 30, 11, '#fff3c4');
        person(ctx, fx + 120, fy, P('postie', 'rex', 'stand'), t, { flip: true }, G);
        // big counter showing the count
        ink(G, '#fff3c4', () => { ctx.beginPath(); ctx.arc(fx + 50, y0 + 40, 22, 0, TAU); });
        text(G, '3', fx + 50, y0 + 41, 26, '#c8302f');
        glowAt(G, fx + 50, y0 + 40, 50, '#ffcf3c', 0.9);
      } },
      { h: 120, lit: true, bg: '#f9e7d0', draw: (fx, y0, fw, fh, fy) => {
        // pigeonholes, three of them holding questions
        for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
          const px = fx + 14 + c * 24, py = y0 + 14 + r * 22, has = (r * 6 + c) % 7 === 2;
          rect(G, px, py, 20, 18, nightTint(G, '#8a5a35', 0.3), G.lw * 0.6);
          if (has) { rect(G, px + 3, py + 4, 14, 10, '#f6c34a', G.lw * 0.6); glowAt(G, px + 10, py + 9, 16, '#ffcf3c', 0.8); }
        }
      } },
    ], { wall: '#d0614e' });
    // pitched roof with a clock-face postmark
    ink(G, nightTint(G, '#9e3f2c'), () => { ctx.beginPath(); ctx.moveTo(x - 26, s.top); ctx.lineTo(x + w / 2, s.top - 70); ctx.lineTo(x + w + 26, s.top); ctx.closePath(); });
    snowCap(G, x - 10, s.top - 10, w + 20);
    text(G, 'POST', x + w / 2, s.top - 24, 24, '#fff3c4', { stroke: 3 });
    // pillar box on the sidewalk
    rect(G, x + w + 26, -64, 26, 64, '#c8302f');
    ink(G, '#c8302f', () => { ctx.beginPath(); ctx.ellipse(x + w + 39, -64, 15, 6, 0, 0, TAU); });
  }
  function hall(G) {
    const { ctx, t } = G, x = 1418, w = 300;
    const s = section(G, x, w, [
      { h: 150, lit: true, bg: '#f4ead2', draw: (fx, y0, fw, fh, fy) => {
        // hiring: a board of open seats and new agents lining up
        rect(G, fx + 14, y0 + 20, 120, 80, nightTint(G, '#2a9d8f', 0.3));
        text(G, 'HIRING', fx + 74, y0 + 38, 18, '#fff3c4');
        ['reviewer · codex', 'docs · gemini', 'ops · rex'].forEach((l, i) => text(G, l, fx + 74, y0 + 58 + i * 14, 11, '#e9fff9', { font: COMIC, weight: 700 }));
        const k = (t * 0.12) % 1;
        person(ctx, fx + 160 + k * 120, fy, A.nova, t, {}, G);
        person(ctx, fx + 210, fy, P('rook', 'codex', 'stand'), t, { flip: true }, G);
        balloon(G, fx + 230, y0 + 30, fx + 214, fy - 76, 'Hi, I start today!', { size: 11 });
      } },
      { h: 140, lit: true, bg: '#f4ead2', draw: (fx, y0, fw, fh, fy) => {
        // the expenses ledger: a wall chart and the town master at a desk
        rect(G, fx + 16, y0 + 16, 150, 92, '#fffdf5');
        text(G, 'EXPENSES · today $41', fx + 91, y0 + 30, 11, INK, { font: COMIC, weight: 700 });
        [0.4, 0.6, 0.5, 0.85, 0.7, 0.95].forEach((v, i) => rect(G, fx + 30 + i * 22, y0 + 100 - v * 56, 14, v * 56, i === 5 ? '#e2683c' : '#58b7a8', G.lw * 0.6));
        deskSet(G, fx + 196, fy - 10, A.mayor, true, '#f2c14e', t);
      } },
    ], { wall: '#efe3c8' });
    // dome, clock and flag
    rect(G, x - 30, s.top - 16, w + 60, 16, nightTint(G, '#e3d4b0'));
    for (let i = 0; i < 7; i++) rect(G, x - 20 + i * ((w + 40) / 6.6), s.top - 16 + 0.01, 0.01, 0.01, null);
    ink(G, nightTint(G, '#9fc7b8'), () => { ctx.beginPath(); ctx.moveTo(x + 50, s.top - 16); ctx.bezierCurveTo(x + 50, s.top - 150, x + w - 50, s.top - 150, x + w - 50, s.top - 16); ctx.closePath(); });
    ctx.save(); ctx.beginPath(); ctx.moveTo(x + 50, s.top - 16); ctx.bezierCurveTo(x + 50, s.top - 150, x + w - 50, s.top - 150, x + w - 50, s.top - 16); ctx.clip();
    ctx.strokeStyle = 'rgba(31,27,43,0.35)'; ctx.lineWidth = G.lw * 0.7;
    for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.moveTo(x + 50 + i * (w - 100) / 6, s.top - 16); ctx.quadraticCurveTo(x + w / 2, s.top - 170, x + w / 2, s.top - 130); ctx.stroke(); }
    ctx.restore();
    snowCap(G, x + 70, s.top - 118, w - 140);
    const cx = x + w / 2, cy = s.top - 62;
    ink(G, '#fffdf5', () => { ctx.beginPath(); ctx.arc(cx, cy, 26, 0, TAU); });
    ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(t * 0.05) * 14, cy - Math.cos(t * 0.05) * 14); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(t * 0.6) * 20, cy - Math.cos(t * 0.6) * 20); ctx.stroke();
    ink(G, null, () => { ctx.beginPath(); ctx.moveTo(cx, s.top - 128); ctx.lineTo(cx, s.top - 190); });
    ink(G, '#2a9d8f', () => { ctx.beginPath(); ctx.moveTo(cx, s.top - 190); ctx.quadraticCurveTo(cx + 22, s.top - 186 + Math.sin(t * 3) * 3, cx + 44, s.top - 182); ctx.lineTo(cx + 44, s.top - 162); ctx.quadraticCurveTo(cx + 22, s.top - 168 + Math.sin(t * 3 + 1) * 3, cx, s.top - 164); ctx.closePath(); });
    text(G, 'TOWN HALL', cx, s.top - 6, 13, INK);
    // columns on the sidewalk side
    for (let i = 0; i < 5; i++) { const px = x + 10 + i * ((w - 20) / 4); rect(G, px - 6, -150, 12, 150, 'rgba(255,253,245,0.0)', G.lw * 0.6); }
  }
  function library(G) {
    const { ctx, t } = G, x = 2036, w = 200;
    const shelves = (fx, y0, fw, fh, fy, glowy) => {
      for (let r = 0; r < 3; r++) {
        const sy = y0 + 18 + r * 36;
        rect(G, fx + 10, sy + 28, fw - 20, 5, nightTint(G, '#8a5a35', 0.3));
        let bx = fx + 14;
        const rr = rng(r * 13 + Math.floor(fx));
        while (bx < fx + fw - 22) { const bw = 6 + rr() * 6, bh = 18 + rr() * 9; const col = ['#e2683c', '#2f5fb3', '#f2c14e', '#3f9a5b', '#8b5cd6', '#58b7a8'][Math.floor(rr() * 6)]; rect(G, bx, sy + 28 - bh, bw, bh, nightTint(G, col, 0.3), G.lw * 0.5); if (glowy && rr() < 0.15) glowAt(G, bx + bw / 2, sy + 20, 14, '#9fe6ff', 0.9); bx += bw + 1; }
      }
    };
    const s = section(G, x, w, [
      { h: 140, lit: true, bg: '#efe0f7', draw: (fx, y0, fw, fh, fy) => { shelves(fx, y0, fw, fh, fy, true); person(ctx, fx + 60, fy, P('sage', 'gemini', 'stand'), t, {}, G); balloon(G, fx + 100, y0 + 14, fx + 66, fy - 80, 'remembering…', { size: 10 }); } },
      { h: 140, lit: true, bg: '#efe0f7', draw: (fx, y0, fw, fh, fy) => { shelves(fx, y0, fw, fh, fy, true); ink(G, nightTint(G, '#8a5a35'), () => { ctx.beginPath(); ctx.moveTo(fx + fw - 50, fy); ctx.lineTo(fx + fw - 30, y0 + 10); ctx.moveTo(fx + fw - 30, fy); ctx.lineTo(fx + fw - 10, y0 + 10); for (let i = 1; i < 7; i++) { ctx.moveTo(fx + fw - 50 + i * 3, fy - i * 18); ctx.lineTo(fx + fw - 30 + i * 3, fy - i * 18); } }); } },
    ], { wall: '#8a6fb0' });
    ink(G, nightTint(G, '#6b5390'), () => { ctx.beginPath(); ctx.moveTo(x - 26, s.top); ctx.lineTo(x + w / 2, s.top - 46); ctx.lineTo(x + w + 26, s.top); ctx.closePath(); });
    snowCap(G, x - 10, s.top - 6, w + 20);
    text(G, 'LIBRARY', x + w / 2, s.top - 16, 16, '#fff3c4', { stroke: 3 });
    // basement archive: memory boxes reaching down
    rect(G, x, 66, w, 110, nightTint(G, '#4a3d5e', 0.3));
    for (let i = 0; i < 8; i++) rect(G, x + 12 + (i % 4) * 46, 80 + Math.floor(i / 4) * 44, 38, 34, nightTint(G, '#c9b8e6', 0.3), G.lw * 0.6);
    text(G, 'ARCHIVE · memory', x + w / 2, 166, 11, '#fff3c4', { font: COMIC, weight: 700 });
  }
  function harbor(G) {
    const { ctx, t } = G, wx = 2268, ww = 150;
    // the PR warehouse: racks of crates
    const s = section(G, wx, ww, [{ h: 200, lit: true, bg: '#f1e2c6', draw: (fx, y0, fw, fh, fy) => {
      const st = ['#3f9a5b', '#f2c14e', '#3f9a5b', '#e2683c', '#f2c14e', '#fffdf5', '#3f9a5b', '#f2c14e', '#3f9a5b'];
      for (let r = 0; r < 3; r++) { rect(G, fx + 6, y0 + 58 + r * 60, fw - 12, 5, nightTint(G, '#8a5a35', 0.3)); for (let c = 0; c < 3; c++) { const col = st[r * 3 + c]; const cx = fx + 12 + c * 44; rect(G, cx, y0 + 18 + r * 60, 38, 40, nightTint(G, '#c08a5b', 0.3)); rect(G, cx + 6, y0 + 24 + r * 60, 26, 12, col, G.lw * 0.6); text(G, `#${4 + r * 3 + c}${2 * c + 1}`, cx + 19, y0 + 47 + r * 60, 9, INK, { font: COMIC, weight: 700 }); } }
    } }], { wall: '#b88a5a' });
    ink(G, nightTint(G, '#8a5a35'), () => { ctx.beginPath(); ctx.moveTo(wx - 24, s.top); ctx.lineTo(wx + ww / 2, s.top - 30); ctx.lineTo(wx + ww + 24, s.top); ctx.closePath(); });
    snowCap(G, wx - 10, s.top - 6, ww + 20);
    text(G, 'PR WAREHOUSE', wx + ww / 2, s.top - 50, 13, INK, { stroke: 0 });
    // quay and crane
    rect(G, 2420, -6, 120, 1700, nightTint(G, '#a8a29a'));
    hatch(G, 2420, -6, 120, 1700, 10, 0.3);
    const sw = Math.sin(t * 0.4) * 0.12;
    ink(G, '#f6c34a', () => { ctx.beginPath(); ctx.rect(2450, -240, 14, 234); });
    ctx.save(); ctx.translate(2457, -240); ctx.rotate(-0.08 + sw);
    ink(G, '#f6c34a', () => { ctx.beginPath(); ctx.rect(-40, -12, 210, 12); });
    const hookY = 140 + Math.sin(t * 0.7) * 30;
    ink(G, null, () => { ctx.beginPath(); ctx.moveTo(160, 0); ctx.lineTo(160, hookY); });
    rect(G, 144, hookY, 32, 24, '#3f9a5b');
    ctx.restore();
    // the sea in cross-section, ships in three lanes at three depths
    const seaTop = 24;
    const sg = ctx.createLinearGradient(0, seaTop, 0, 400);
    sg.addColorStop(0, nightTint(G, '#5fb4c4')); sg.addColorStop(1, nightTint(G, '#1f5a7a'));
    ctx.fillStyle = sg; ctx.fillRect(2540, seaTop, 800, 380);
    ctx.fillStyle = nightTint(G, '#d9c08a'); ctx.beginPath(); ctx.moveTo(2540, 1700); ctx.lineTo(2540, 340); for (let x = 2540; x <= 3340; x += 40) ctx.lineTo(x, 360 + Math.sin(x * 0.03) * 12); ctx.lineTo(3340, 1700); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = G.lw; ctx.stroke();
    // fish and a release cable on the sea floor
    for (let i = 0; i < 6; i++) { const fx = 2560 + ((t * (14 + i * 3) + i * 90) % 560), fy = 120 + i * 36; ink(G, ['#f2c14e', '#ef7b6b', '#fffdf5'][i % 3], () => { ctx.beginPath(); ctx.ellipse(fx, fy, 10, 5, 0, 0, TAU); ctx.moveTo(fx - 10, fy); ctx.lineTo(fx - 17, fy - 5); ctx.lineTo(fx - 17, fy + 5); ctx.closePath(); }, G.lw * 0.6); }
    const lanes = [{ id: "docs", v: "v1.0", x: 2880, sc: 0.55, y: seaTop - 2 }, { id: "crew", v: "v0.4", x: 2760, sc: 0.75, y: seaTop + 2 }, { id: "world", v: "v2.1", x: 2610 + ((t * 5) % 220), sc: 1, y: seaTop + 6, sail: true }];
    lanes.forEach((ln, i) => ship(G, ln.x, ln.y + Math.sin(t * 1.4 + i) * 2, ln.sc, PROJ[ln.id], `${ln.id} ${ln.v}`, ln.sail));
    // wave line on top
    ctx.strokeStyle = INK; ctx.lineWidth = G.lw; ctx.beginPath();
    for (let x = 2540; x <= 3340; x += 10) ctx.lineTo(x, seaTop + Math.sin(x * 0.05 + t * 2) * 3);
    ctx.stroke();
    // lighthouse on the breakwater at the far right
    const lx = 2990;
    ink(G, nightTint(G, '#fffdf5'), () => { ctx.beginPath(); ctx.moveTo(lx - 18, seaTop - 4); ctx.lineTo(lx - 10, -170); ctx.lineTo(lx + 10, -170); ctx.lineTo(lx + 18, seaTop - 4); ctx.closePath(); });
    for (let i = 0; i < 3; i++) ink(G, '#d0614e', () => { ctx.beginPath(); ctx.rect(lx - 16 + i * 2, -40 - i * 50, 32 - i * 4, 18); }, G.lw * 0.6);
    rect(G, lx - 14, -196, 28, 26, G.dark ? '#ffe58a' : '#bfe6f0');
    ink(G, '#d0614e', () => { ctx.beginPath(); ctx.moveTo(lx - 18, -196); ctx.lineTo(lx, -214); ctx.lineTo(lx + 18, -196); ctx.closePath(); });
    if (G.dark) {
      const a = t * 0.8;
      G.lights.push((c, d) => { c.save(); c.translate(lx, -183); c.rotate(Math.sin(a) * 0.5); const g = c.createLinearGradient(0, 0, -700, 0); g.addColorStop(0, `rgba(255,240,170,${0.55 * d})`); g.addColorStop(1, 'rgba(255,240,170,0)'); c.fillStyle = g; c.beginPath(); c.moveTo(0, 0); c.lineTo(-700, -70); c.lineTo(-700, 70); c.closePath(); c.fill(); c.restore(); });
      glowAt(G, lx, -183, 60, '#ffe58a', 1);
    }
  }
  function ship(G, x, y, sc, col, label, sailing) {
    const { ctx } = G;
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
    const lw = G.lw / sc;
    const st = () => { ctx.strokeStyle = INK; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke(); };
    ctx.beginPath(); ctx.moveTo(-90, -20); ctx.lineTo(90, -20); ctx.lineTo(70, 18); ctx.lineTo(-74, 18); ctx.closePath(); ctx.fillStyle = nightTint(G, '#fffdf5'); ctx.fill(); st();
    ctx.beginPath(); ctx.rect(-90, -6, 175, 8); ctx.fillStyle = col; ctx.fill(); st();
    ctx.beginPath(); ctx.rect(-50, -54, 60, 34); ctx.fillStyle = nightTint(G, '#e9dfca'); ctx.fill(); st();
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(-38 + i * 18, -38, 5, 0, TAU); ctx.fillStyle = G.dark ? '#ffe58a' : '#bfe6f0'; ctx.fill(); st(); }
    ctx.beginPath(); ctx.moveTo(30, -20); ctx.lineTo(30, -150); st();
    ctx.beginPath(); ctx.moveTo(34, -146); ctx.quadraticCurveTo(sailing ? 100 : 80, -90, 34, -30); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); st();
    ctx.beginPath(); ctx.moveTo(30, -150); ctx.lineTo(54, -144); ctx.lineTo(30, -138); ctx.fillStyle = INK; ctx.fill();
    ctx.restore();
    text(G, label, x - 10 * sc, y - 180 * sc, 22 * sc + 4, '#fffdf5', { font: COMIC, weight: 700, stroke: 3 });
    if (sailing) text(G, 'shipping →', x - 10 * sc, y - 150 * sc, 15 * sc + 3, '#fff3c4', { font: COMIC, weight: 700, stroke: 3 });
  }
  function arrival(G) {
    // a new host arrives by airship, lowering a building module onto the lot
    const { ctx, t } = G, x = 40, w = 220;
    const k = (t % 16) / 16;
    const drop = ease(clamp(k / 0.55, 0, 1)), shipUp = ease(clamp((k - 0.62) / 0.3, 0, 1));
    // the empty lot with a dashed outline
    ctx.save(); ctx.setLineDash([10, 8]); ctx.strokeStyle = 'rgba(31,27,43,0.5)'; ctx.lineWidth = G.lw; ctx.strokeRect(x, -260, w, 260); ctx.restore();
    const modY = lerp(-520, -260, drop);
    const shipY = modY - 120 - shipUp * 140;
    // cables
    if (k < 0.65) ink(G, null, () => { ctx.beginPath(); ctx.moveTo(x + 40, shipY + 40); ctx.lineTo(x + 30, modY); ctx.moveTo(x + w - 40, shipY + 40); ctx.lineTo(x + w - 30, modY); });
    // the module: a ready-made office block with its first lit room
    rect(G, x, modY, w, 260, nightTint(G, '#9fd0a6'));
    hatch(G, x, modY, w, 260, 14, 0.2);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) { const lit = (r + c) % 3 === 0; rect(G, x + 20 + c * 50, modY + 30 + r * 70, 32, 40, lit ? '#ffe9a8' : nightTint(G, '#bfe6f0'), G.lw * 0.7); if (lit) glowAt(G, x + 36 + c * 50, modY + 50 + r * 70, 34, '#ffcf73', 0.7); }
    rect(G, x - 10, modY - 14, w + 20, 14, nightTint(G, '#5c8f60'));
    text(G, 'PINE', x + w / 2, modY - 34, 26, '#fff3c4', { stroke: 3 });
    // the airship
    const sx = x + w / 2 + Math.sin(t * 0.5) * 8;
    ink(G, nightTint(G, '#e9dfca'), () => { ctx.beginPath(); ctx.ellipse(sx, shipY, 150, 46, 0, 0, TAU); });
    ctx.save(); ctx.beginPath(); ctx.ellipse(sx, shipY, 150, 46, 0, 0, TAU); ctx.clip();
    ctx.strokeStyle = 'rgba(31,27,43,0.3)'; ctx.lineWidth = G.lw * 0.7; for (let i = -4; i <= 4; i++) { ctx.beginPath(); ctx.ellipse(sx, shipY, Math.abs(i) * 34 + 2, 46, 0, 0, TAU); ctx.stroke(); }
    ctx.fillStyle = '#5c8f60'; ctx.fillRect(sx - 160, shipY - 6, 320, 12);
    ctx.restore();
    ink(G, '#5c8f60', () => { ctx.beginPath(); ctx.moveTo(sx - 140, shipY - 10); ctx.lineTo(sx - 185, shipY - 48); ctx.lineTo(sx - 170, shipY); ctx.lineTo(sx - 185, shipY + 46); ctx.lineTo(sx - 140, shipY + 10); ctx.closePath(); });
    rect(G, sx - 40, shipY + 44, 80, 22, nightTint(G, '#c08a5b'));
    // spinning prop
    const pr = Math.sin(t * 20) * 18;
    ink(G, null, () => { ctx.beginPath(); ctx.moveTo(sx - 170, shipY - pr); ctx.lineTo(sx - 170, shipY + pr); });
    text(G, 'new host: pine', sx, shipY, 18, INK, { font: COMIC, weight: 700 });
    if (G.dark) glowAt(G, sx, shipY + 55, 60, '#ffd27a', 0.6);
  }
  function tubes(G) {
    // pneumatic tubes under the street carry each question to the post office
    const { ctx, t } = G;
    const routes = [[[1000, 0], [1000, 120], [1300, 120], [1300, 0]], [[1880, 0], [1880, 150], [1340, 150], [1340, 0]], [[700, 0], [700, 90], [1260, 90], [1260, 0]]];
    for (const r of routes) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = INK; ctx.lineWidth = 16; ctx.beginPath(); r.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      ctx.strokeStyle = nightTint(G, '#cfe6ea', 0.3); ctx.lineWidth = 11; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2.5; ctx.stroke();
    }
    // capsules
    const segLen = (r) => r.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - r[i][0], p[1] - r[i][1]), 0);
    routes.forEach((r, j) => {
      const L = segLen(r), d = ((t * 140 + j * 300) % (L + 200));
      if (d > L) return;
      let acc = 0;
      for (let i = 1; i < r.length; i++) {
        const sl = Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]);
        if (acc + sl >= d) { const k = (d - acc) / sl, x = lerp(r[i - 1][0], r[i][0], k), y = lerp(r[i - 1][1], r[i][1], k); ink(G, '#f6c34a', () => { ctx.beginPath(); ctx.ellipse(x, y, 9, 6, r[i][0] === r[i - 1][0] ? Math.PI / 2 : 0, 0, TAU); }, G.lw * 0.7); glowAt(G, x, y, 22, '#ffcf3c', 1); break; }
        acc += sl;
      }
    });
    text(G, 'question tubes → post', 1120, 110, 12, '#fff3c4', { font: COMIC, weight: 700, stroke: 3 });
  }
  function street(G, cam) {
    const { ctx, t } = G;
    // lamps along the sidewalk
    for (const lx of [280, 540, 776, 1200, 1400, 1740, 2020, 2250]) {
      ink(G, nightTint(G, '#3a3550'), () => { ctx.beginPath(); ctx.rect(lx - 3, -170, 6, 170); });
      ink(G, nightTint(G, '#3a3550'), () => { ctx.beginPath(); ctx.moveTo(lx, -170); ctx.quadraticCurveTo(lx + 2, -186, lx + 18, -182); });
      ink(G, G.dark ? '#ffe58a' : '#fffdf5', () => { ctx.beginPath(); ctx.ellipse(lx + 18, -176, 8, 6, 0, 0, TAU); });
      if (G.dark) { glowAt(G, lx + 18, -176, 60, '#ffd27a', 0.9); G.lights.push((c, d) => { c.save(); c.translate(lx + 18, 6); c.scale(1, 0.25); const g = c.createRadialGradient(0, 0, 0, 0, 0, 90); g.addColorStop(0, `rgba(255,210,122,${0.4 * d})`); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.beginPath(); c.arc(0, 0, 90, 0, TAU); c.fill(); c.restore(); }); }
    }
    // bus stop by the town hall
    ink(G, nightTint(G, '#3a3550'), () => { ctx.beginPath(); ctx.rect(1724, -120, 5, 120); });
    ink(G, '#2f5fb3', () => { ctx.beginPath(); ctx.arc(1726, -126, 14, 0, TAU); });
    text(G, 'B', 1726, -125, 14, '#fff3c4');
    // walkers on the sidewalk
    const walk = (a, x0, x1, T, off) => { const ph = (t / T + off) % 2, k = ph < 1 ? ph : 2 - ph; const x = lerp(x0, x1, ease(k)); person(ctx, x, 0, a, t, { flip: ph >= 1, pose: 'walk' }, G); if (G.rain) umbrella(G, x + (ph >= 1 ? -2 : 2), -96, HARNESS_COL[a.h]); };
    walk(A.fig, 560, 1180, 30, 0);
    walk(A.quill, 1400, 2030, 26, 0.6);
    // the bus: drives the street, pauses at the stop
    const T = 36, k = t % T;
    const keys = [[0, -300], [12, 1600], [16, 1600], [30, 3000], [36, 3000]];
    let bx = -300;
    for (let i = 0; i < keys.length - 1; i++) if (k >= keys[i][0] && k <= keys[i + 1][0]) bx = lerp(keys[i][1], keys[i + 1][1], ease((k - keys[i][0]) / (keys[i + 1][0] - keys[i][0] || 1)));
    bus(G, bx, 44);
  }
  function umbrella(G, x, y, col) {
    const { ctx } = G;
    ink(G, null, () => { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 44); });
    ink(G, col, () => { ctx.beginPath(); ctx.moveTo(x - 30, y + 4); ctx.quadraticCurveTo(x, y - 30, x + 30, y + 4); for (let i = 3; i >= 0; i--) ctx.quadraticCurveTo(x - 30 + (i + 0.5) * 15, y - 2, x - 30 + i * 15, y + 4); ctx.closePath(); });
  }
  function bus(G, x, y) {
    const { ctx, t } = G;
    const b = Math.abs(Math.sin(t * 9)) * 1.5;
    ctx.save(); ctx.translate(x, y - b);
    ink(G, '#f2b632', () => { rrect(ctx, -10, -110, 240, 96, 18); });
    rect(G, -10, -40, 240, 10, '#e2683c');
    const riders = [A.otter, null, A.nova, null];
    for (let i = 0; i < 4; i++) {
      const wx = 14 + i * 50;
      rect(G, wx, -96, 38, 38, G.dark ? '#ffe9a8' : '#cfe9f3');
      if (riders[i]) { ctx.save(); ctx.beginPath(); ctx.rect(wx, -96, 38, 38); ctx.clip(); person(ctx, wx + 18, -34, riders[i], t, { pose: 'sit', s: 0.8 }, G); ctx.restore(); }
      if (G.dark) glowAt(G, x + wx + 19, y - 77, 34, '#ffcf73', 0.7);
    }
    text(G, 'TOWN LOOP', 110, -24, 11, INK);
    for (const wx of [36, 186]) { ink(G, INK, () => { ctx.beginPath(); ctx.arc(wx, -10, 17, 0, TAU); }); ink(G, '#c9c2b4', () => { ctx.beginPath(); ctx.arc(wx, -10, 7, 0, TAU); }); }
    ink(G, '#fffdf5', () => { ctx.beginPath(); ctx.arc(226, -56, 6, 0, TAU); });
    ctx.restore();
    if (G.dark) G.lights.push((c, d) => { const g = c.createLinearGradient(x + 230, 0, x + 520, 0); g.addColorStop(0, `rgba(255,245,200,${0.5 * d})`); g.addColorStop(1, 'rgba(255,245,200,0)'); c.fillStyle = g; c.beginPath(); c.moveTo(x + 230, y - 60); c.lineTo(x + 520, y - 100); c.lineTo(x + 520, y + 10); c.closePath(); c.fill(); });
  }
  function weatherFx(G, cam, w, h) {
    const { ctx, t } = G;
    if (!G.rain && !G.snow) return;
    const x0 = -cam.ox / cam.k, y0 = -cam.oy / cam.k, W = w / cam.k, H = h / cam.k;
    const r = rng(4);
    ctx.save();
    if (G.rain) {
      ctx.strokeStyle = G.dark ? 'rgba(200,220,255,0.55)' : 'rgba(31,27,43,0.45)'; ctx.lineWidth = G.lw * 0.7;
      ctx.beginPath();
      for (let i = 0; i < 260; i++) { const x = x0 + r() * W * 1.2, y = y0 + ((r() * H + t * H * (0.9 + r() * 0.4)) % H), l = 20 / Math.max(0.5, cam.k); ctx.moveTo(x, y); ctx.lineTo(x - l * 0.3, y + l); }
      ctx.stroke();
      for (let i = 0; i < 30; i++) { const kk = (t * 1.2 + r()) % 1, px = x0 + r() * W; ctx.strokeStyle = `rgba(200,225,255,${0.7 * (1 - kk)})`; ctx.beginPath(); ctx.ellipse(px, 34, 4 + kk * 16, 1 + kk * 3, 0, 0, TAU); ctx.stroke(); }
    } else {
      for (let i = 0; i < 200; i++) { const x = x0 + ((r() * W + Math.sin(t * 0.6 + i) * 20 + W) % W), y = y0 + ((r() * H + t * H * (0.06 + r() * 0.08)) % H), rad = (1.5 + r() * 2.5) / Math.max(0.6, cam.k) * 0.8; ctx.fillStyle = '#ffffff'; ctx.strokeStyle = INK; ctx.lineWidth = G.lw * 0.4; ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill(); ctx.stroke(); }
    }
    ctx.restore();
  }
  function caption(ctx, w, h, time, weather) {
    // a comic caption box, the page's only chrome
    const txt = `HERDR TOWN · ${time === 'night' ? '11:48 PM' : time === 'dusk' ? '7:20 PM' : '9:41 AM'}${weather === 'rain' ? ' · RAIN' : weather === 'snow' ? ' · SNOW' : ''}`;
    const size = Math.max(11, Math.min(16, w / 70));
    ctx.save(); ctx.font = `700 ${size}px ${COMIC}`;
    const tw = ctx.measureText(txt).width;
    ctx.fillStyle = '#fbe58a'; ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.fillRect(14, 14, tw + 24, size * 2); ctx.strokeRect(14, 14, tw + 24, size * 2);
    ctx.fillStyle = INK; ctx.textBaseline = 'middle'; ctx.fillText(txt, 26, 14 + size);
    ctx.restore();
  }

  // ---------- character sheet: a model sheet, comic style ----------
  function sheet(ctx, w, h, t) {
    ctx.fillStyle = '#fbf3df'; ctx.fillRect(0, 0, w, h);
    const cols = w > 720 ? 6 : 2;
    const cells = [...Object.keys(HARNESS_COL).map((hk) => ({ hk })), ...['working', 'thinking', 'needs', 'done', 'idle', 'walking', 'bus', 'asleep'].map((st) => ({ st }))];
    const rows = Math.ceil(cells.length / cols), cw = w / cols, ch = h / rows;
    const names = { working: 'Working', thinking: 'Thinking', needs: 'Needs you', done: 'Done · to review', idle: 'Idle at the lounge', walking: 'Walking', bus: 'On the bus', asleep: 'Asleep · resumable' };
    const who = { working: A.scout, thinking: A.pixel, needs: A.maple, done: A.lark, idle: A.fern, walking: A.fig, bus: A.otter, asleep: A.bram };
    cells.forEach((c, i) => {
      const x0 = (i % cols) * cw, y0 = Math.floor(i / cols) * ch;
      const s = Math.min(cw / 150, ch / 170);
      const G = { ctx, t, lw: 2, dark: 0, lights: [] };
      ctx.save();
      // comic panel border
      ctx.fillStyle = c.hk ? mix(HARNESS_COL[c.hk], '#fbf3df', 0.82) : '#fffdf5'; ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
      ctx.fillRect(x0 + 6, y0 + 6, cw - 12, ch - 12); ctx.strokeRect(x0 + 6, y0 + 6, cw - 12, ch - 12);
      ctx.beginPath(); ctx.rect(x0 + 6, y0 + 6, cw - 12, ch - 12); ctx.clip();
      ctx.translate(x0 + cw / 2, y0 + ch * 0.74); ctx.scale(s, s);
      ctx.strokeStyle = 'rgba(31,27,43,0.35)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-70, 0); ctx.lineTo(70, 0); ctx.stroke();
      G.lw = 2 / s * s;
      if (c.hk) person(ctx, 0, 0, { n: c.hk, h: c.hk, s: 'stand' }, t, { s: 1.2 }, G);
      else {
        const a = who[c.st];
        if (c.st === 'working' || c.st === 'thinking') deskSet(G, -30, 0, a, true, PROJ.world, t);
        else if (c.st === 'idle') { rect(G, -60, -52, 120, 8, '#8a5a35'); ink(G, '#f6c34a', () => { ctx.beginPath(); ctx.rect(-14, -46, 22, 6); }); ink(G, null, () => { ctx.beginPath(); ctx.moveTo(-3, -40); ctx.lineTo(-3, 0); }); person(ctx, -10, 0, a, t, {}, G); }
        else if (c.st === 'bus') { ctx.save(); ctx.translate(-68, 22); ctx.scale(0.6, 0.6); bus({ ...G, ctx }, 0, 0); ctx.restore(); }
        else if (c.st === 'asleep') { rect(G, -56, -26, 112, 14, '#c08a5b'); rect(G, -60, -52, 8, 52, '#c08a5b'); rect(G, -50, -34, 26, 10, '#ffffff'); person(ctx, -30, -26, a, t, {}, G); zzz(G, -40, -50, t); }
        else if (c.st === 'needs') { person(ctx, -20, 0, a, t, {}, G); balloon(G, 22, -112, -10, -82, 'Ship v2.1?', { size: 13, fill: '#fff6d6' }); }
        else if (c.st === 'done') { person(ctx, -16, 0, a, t, {}, G); balloon(G, 30, -112, -10, -84, 'Done!', { size: 13, fill: '#e3f7e6', color: '#22663a' }); }
        else if (c.st === 'walking') { const dx = Math.sin(t * 0.7) * 40; person(ctx, dx, 0, a, t, { flip: Math.cos(t * 0.7) < 0, pose: 'walk' }, G); }
      }
      ctx.restore();
      // caption strip
      const label = c.hk ? c.hk[0].toUpperCase() + c.hk.slice(1) : names[c.st];
      ctx.save(); ctx.font = `700 ${Math.max(11, Math.min(15, cw / 11))}px ${COMIC}`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = '#fbe58a'; ctx.strokeStyle = INK; ctx.lineWidth = 2;
      ctx.fillRect(x0 + 6, y0 + 6, tw + 16, 22); ctx.strokeRect(x0 + 6, y0 + 6, tw + 16, 22);
      ctx.fillStyle = INK; ctx.textBaseline = 'middle'; ctx.fillText(label, x0 + 14, y0 + 17);
      ctx.restore();
    });
  }
}
