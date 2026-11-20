// Direction 1 · Pop-Up: the town is a pop-up book open on a desk.
// Everything is cut paper: buildings are folded card, rooms are open-top
// shoebox dioramas, agents are sticker cut-outs on fold stands, the sea is
// theatre wave strips and notifications fly to the post office as paper planes.
import { TAU, rng, isoCam, poly, rrect, shade, mix, css, lerp, clamp, ease } from '../lib.js';

const C = {
  desk: '#3a271c', desk2: '#5a3d2b', cover: '#7a2f2a', coverEdge: '#5b201d',
  page: '#f4ecdb', pageEdge: '#e2d5ba', grass: '#a8c98a', grass2: '#93b877', meadow: '#c5dba0',
  road: '#d8c7a6', stitch: '#fffaf0', sea: '#77b9cf', sea2: '#5a9fbb', sea3: '#3f86a6', foam: '#f1fafb',
  ink: '#3b2f2a', cream: '#f8efdc', brick: '#df8a68', slate: '#8fa3b8', mustard: '#e9b949',
  plum: '#a66e93', teal: '#4ea3a3', wood: '#c08a5b', roofRed: '#c8553d', paper: '#fffaf0',
};
export const HARNESS_COL = { claude: '#e07a5f', codex: '#4361a8', gemini: '#8a6fdf', rex: '#5fa86a' };
const PROJ = { world: '#f2c14e', crew: '#ef8354', docs: '#4fa3a3', lab: '#a66e93', site: '#7bb07f', api: '#8fa3b8' };

function makeGrain() {
  const c = document.createElement('canvas');
  c.width = c.height = 220;
  const g = c.getContext('2d');
  const r = rng(7);
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 220, 220);
  for (let i = 0; i < 2600; i++) {
    const v = 110 + r() * 60;
    g.fillStyle = `rgba(${v},${v},${v},${0.35 + r() * 0.4})`;
    g.fillRect(r() * 220, r() * 220, 1 + r() * 1.5, 1 + r() * 1.5);
  }
  g.lineWidth = 0.6;
  for (let i = 0; i < 160; i++) {
    const x = r() * 220, y = r() * 220, a = r() * TAU, l = 4 + r() * 10;
    g.strokeStyle = `rgba(${r() < 0.5 ? 70 : 190},${r() < 0.5 ? 70 : 190},${r() < 0.5 ? 70 : 190},0.35)`;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  return c;
}

// ---------- the town plan (world tiles) ----------
const BOOK = { x0: -0.8, y0: -0.8, x1: 31.6, y1: 21.8 };
const ROADS = [
  { x0: -0.6, y0: 10, x1: 24.6, y1: 11.6 }, // main street
  { x0: 7.3, y0: -0.6, x1: 8.7, y1: 21.6 },
  { x0: 15.7, y0: -0.6, x1: 17.1, y1: 21.6 },
];
const AGENTS = [
  // name, harness, state
  ['scout', 'claude', 'working'], ['wren', 'codex', 'working'], ['juniper', 'claude', 'thinking'],
  ['otter', 'gemini', 'working'], ['pixel', 'codex', 'thinking'], ['maple', 'claude', 'needs'],
  ['sable', 'codex', 'needs'], ['kite', 'rex', 'working'], ['moss', 'claude', 'idle'], ['ember', 'codex', 'idle'],
  ['fig', 'gemini', 'walking'], ['quill', 'claude', 'walking'], ['tansy', 'codex', 'asleep'],
  ['bram', 'claude', 'asleep'], ['olive', 'gemini', 'asleep'], ['lark', 'rex', 'done'], ['hazel', 'codex', 'working'],
];
const A = Object.fromEntries(AGENTS.map(([n, h, s]) => [n, { n, h, s }]));

function inRect(x, y, r, pad = 0) { return x > r.x0 - pad && x < r.x1 + pad && y > r.y0 - pad && y < r.y1 + pad; }
const BLOCKED = [
  ...ROADS,
  { x0: 0.4, y0: 0.4, x1: 7.1, y1: 9.8 }, { x0: 9, y0: 0.6, x1: 15.4, y1: 9.8 }, { x0: 17.4, y0: 0.4, x1: 24.4, y1: 9.8 },
  { x0: 0.6, y0: 12.6, x1: 7.2, y1: 17.8 }, { x0: 8.9, y0: 12.6, x1: 15.4, y1: 18.2 }, { x0: 17.4, y0: 12.6, x1: 26, y1: 19.6 },
  { x0: 0.5, y0: 18.6, x1: 7.3, y1: 21.6 }, { x0: 24.3, y0: -1, x1: 33, y1: 23 }, { x0: 8.8, y0: 18.4, x1: 15.4, y1: 21 },
];
const TREES = (() => {
  const r = rng(42), out = [];
  for (let i = 0; i < 400 && out.length < 44; i++) {
    const x = BOOK.x0 + 0.8 + r() * (24.4 - BOOK.x0), y = BOOK.y0 + 0.8 + r() * (BOOK.y1 - BOOK.y0 - 1.6);
    if (BLOCKED.some((b) => inRect(x, y, b, 0.5))) continue;
    if (out.some((o) => Math.hypot(o.x - x, o.y - y) < 1.2)) continue;
    out.push({ x, y, k: r(), h: 1.1 + r() * 0.9, round: r() < 0.55 });
  }
  return out;
})();

export function createPaper() {
  let grain = null, grainPat = null;
  const scene = { render, drawFigure, HARNESS_COL };
  return scene;

  function render(ctx, w, h, t, P) {
    if (!grain) { grain = makeGrain(); grainPat = ctx.createPattern(grain, 'repeat'); }
    const view = P.view || 'hero';
    if (view === 'sheet') return sheet(ctx, w, h, t);
    const time = P.time || (view === 'night' ? 'night' : 'day');
    const weather = P.weather || (view === 'night' ? 'rain' : 'clear');
    const night = time === 'night' ? 1 : time === 'dusk' ? 0.5 : 0;
    const snow = weather === 'snow';
    const cam = camera(w, h, view, P.portrait, P.pan);
    const L = []; // light passes, drawn after the night tint

    // desk
    const bg = ctx.createRadialGradient(w * 0.35, h * 0.2, 10, w * 0.5, h * 0.5, Math.max(w, h) * 0.9);
    bg.addColorStop(0, '#6b4a33'); bg.addColorStop(1, C.desk);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    woodGrain(ctx, w, h);

    sunStick(ctx, cam, t, night);
    book(ctx, cam, snow);
    ground(ctx, cam, t, snow, night, L);

    // depth-sorted objects
    const O = [];
    const add = (k, fn) => O.push({ k, fn });
    office(add, cam, t, { x0: 0.6, y0: 0.6, name: 'ATLAS', rooms: [
      { id: 'docs', lit: false, back: true, people: [] },
      { id: 'lab', lit: true, back: true, people: [[A.hazel]] },
      { id: 'world', lit: true, people: [[A.scout], [A.wren], [A.juniper]] },
      { id: 'crew', lit: true, people: [[A.otter], [A.pixel]] },
    ], queue: [A.maple, A.sable, A.lark] }, snow, L);
    office(add, cam, t, { x0: 17.6, y0: 0.6, name: 'NIMBUS', rooms: [
      { id: 'api', lit: false, back: true, people: [] },
      { id: 'ops', lit: false, back: true, people: [] },
      { id: 'site', lit: true, people: [[A.kite]] },
      { id: 'lab', lit: false, people: [] },
    ], queue: [] }, snow, L);
    townHall(add, cam, t, snow, L);
    bar(add, cam, t, snow, L);
    postOffice(add, cam, t, snow, L);
    apartments(add, cam, t, snow, L);
    library(add, cam, t, snow, L);
    warehouse(add, cam, t, snow, L);
    arrival(add, cam, t, snow);
    for (const tr of TREES) add(tr.x + tr.y, () => tree(ctx, cam, tr, t, snow));
    lamps(add, cam, L);
    busStop(add, cam, snow);
    bus(add, cam, t, snow, L);
    walkers(add, cam, t, weather);
    O.sort((a, b) => a.k - b.k);
    for (const o of O) { ctx.save(); o.fn(ctx); ctx.restore(); }

    sea(ctx, cam, t, snow, L);
    planes(ctx, cam, t);

    // paper grain over everything
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = grainPat; ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // light of the hour
    if (night > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = night >= 1 ? '#4a5aa0' : '#e9a07a';
      ctx.globalAlpha = night >= 1 ? 0.86 : 0.55;
      ctx.fillRect(0, 0, w, h);
      if (night < 1) { ctx.fillStyle = '#7d6aa8'; ctx.globalAlpha = 0.3; ctx.fillRect(0, 0, w, h); }
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const fn of L) fn(ctx, night);
      ctx.restore();
      // a reading lamp pooled on the book
      ctx.save();
      ctx.globalCompositeOperation = 'soft-light';
      const lp = ctx.createRadialGradient(w * 0.3, h * 0.25, 0, w * 0.3, h * 0.25, Math.max(w, h) * 0.7);
      lp.addColorStop(0, `rgba(255,214,150,${0.45 * night})`); lp.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = lp; ctx.fillRect(0, 0, w, h);
      ctx.restore();
    } else {
      const lp = ctx.createRadialGradient(w * 0.25, h * 0.1, 0, w * 0.25, h * 0.1, Math.max(w, h));
      lp.addColorStop(0, 'rgba(255,240,205,0.18)'); lp.addColorStop(1, 'rgba(40,20,0,0.18)');
      ctx.fillStyle = lp; ctx.fillRect(0, 0, w, h);
    }

    if (view === 'hero' || view === 'night' || weather !== 'clear') clouds(ctx, w, h, t, weather, night);
    if (weather === 'rain') rain(ctx, cam, w, h, t);
    if (snow) snowfall(ctx, w, h, t);
    // vignette
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(20,8,0,0.45)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
  }


  // ---------- character sheet: a scrapbook page of sticker cut-outs ----------
  function sheet(ctx, w, h, t) {
    ctx.fillStyle = '#f4ecdb'; ctx.fillRect(0, 0, w, h);
    // cutting-mat grid
    ctx.strokeStyle = 'rgba(80,140,120,0.16)'; ctx.lineWidth = 1;
    const g = Math.max(18, Math.min(w, h) / 22);
    for (let x = 0; x < w; x += g) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += g) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    const cols = w > 720 ? 6 : 2;
    const cells = [
      ...Object.keys(HARNESS_COL).map((hk) => ({ kind: 'harness', hk })),
      ...['working', 'thinking', 'needs', 'done', 'idle', 'walking', 'bus', 'asleep'].map((st) => ({ kind: 'state', st })),
    ];
    const rows = Math.ceil(cells.length / cols);
    const cw = w / cols, ch = h / rows;
    const names = { working: 'Working', thinking: 'Thinking', needs: 'Needs you', done: 'Done · to review', idle: 'Idle at the lounge', walking: 'Walking', bus: 'On the bus', asleep: 'Asleep · resumable' };
    const who = { working: A.scout, thinking: A.juniper, needs: A.maple, done: A.lark, idle: A.ember, walking: A.fig, bus: A.otter, asleep: A.bram };
    cells.forEach((c, i) => {
      const cx = (i % cols) * cw + cw / 2, cy = Math.floor(i / cols) * ch + ch * 0.5;
      const u = Math.min(cw, ch) * 0.2;
      const cam = isoCam(cw, ch, { cx: 0, cy: 0, cz: 0, s: u * 1.8 });
      ctx.save(); ctx.translate(cx - cw / 2, cy - ch / 2);
      // a paper card for each cell, slightly rotated like a scrapbook
      ctx.save(); ctx.translate(cw / 2, ch / 2); ctx.rotate(((i * 37) % 7 - 3) * 0.006);
      ctx.shadowColor = 'rgba(60,30,10,0.25)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
      ctx.fillStyle = c.kind === 'harness' ? mix(HARNESS_COL[c.hk], '#fffaf0', 0.82) : '#fffaf0';
      rrect(ctx, -cw * 0.45, -ch * 0.44, cw * 0.9, ch * 0.88, 6); ctx.fill();
      ctx.restore();
      const fy = ch * 0.72;
      if (c.kind === 'harness') {
        const a = { n: c.hk, h: c.hk, s: 'standing' };
        ctx.fillStyle = 'rgba(70,40,20,0.2)'; ctx.beginPath(); ctx.ellipse(cw / 2 + u * 0.2, fy, u * 0.7, u * 0.2, 0, 0, TAU); ctx.fill();
        drawFigure(ctx, cw / 2, fy, u, a, t, {});
        caption(ctx, cw / 2, ch * 0.86, `${c.hk[0].toUpperCase() + c.hk.slice(1)}`, HARNESS_COL[c.hk], u);
      } else {
        const a = who[c.st];
        const L = [];
        const X = cw / 2;
        ctx.fillStyle = 'rgba(70,40,20,0.18)'; ctx.beginPath(); ctx.ellipse(X + u * 0.2, fy, u * 1.1, u * 0.2, 0, 0, TAU); ctx.fill();
        if (c.st === 'working' || c.st === 'thinking') {
          // front view: seated behind a desk, the laptop lid toward us
          drawFigure(ctx, X, fy - u * 1.0, u, a, t, { noStand: true, noDesk: true });
          ctx.save(); ctx.translate(X, fy);
          ctx.shadowColor = 'rgba(60,30,10,0.3)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
          ctx.fillStyle = '#d7a46a'; rrect(ctx, -u * 1.1, -u * 0.95, u * 2.2, u * 0.95, u * 0.08); ctx.fill();
          ctx.shadowColor = 'transparent';
          ctx.fillStyle = '#e8c08b'; ctx.fillRect(-u * 1.15, -u * 1.0, u * 2.3, u * 0.14);
          ctx.fillStyle = '#b7c0cc'; rrect(ctx, -u * 0.36, -u * 1.36, u * 0.72, u * 0.4, u * 0.05); ctx.fill();
          ctx.fillStyle = c.st === 'working' ? '#8fd3ff' : '#c9d2de'; ctx.beginPath(); ctx.arc(0, -u * 1.16, u * 0.07, 0, TAU); ctx.fill();
          if (c.st === 'working') for (let i = 0; i < 3; i++) { const k = (t * 1.5 + i / 3) % 1; ctx.globalAlpha = 1 - k; ctx.fillStyle = ['#f2c14e', '#8fd3ff', '#e07a5f'][i]; ctx.fillRect(u * (0.5 + i * 0.2), -u * (1.1 + k * 0.9), u * 0.12, u * 0.12); ctx.globalAlpha = 1; }
          ctx.restore();
        } else if (c.st === 'idle') {
          ctx.save(); ctx.translate(X, fy);
          ctx.fillStyle = '#8a5a35'; ctx.fillRect(-u * 0.06, -u * 0.55, u * 0.12, u * 0.55); ctx.fillRect(-u * 0.3, -u * 0.06, u * 0.6, u * 0.06);
          ctx.fillStyle = '#e9b949'; rrect(ctx, -u * 0.45, -u * 0.72, u * 0.9, u * 0.2, u * 0.08); ctx.fill();
          ctx.restore();
          drawFigure(ctx, X, fy - u * 0.62, u, a, t, { noStand: true });
        } else if (c.st === 'bus') {
          ctx.save(); ctx.translate(X, fy);
          ctx.fillStyle = '#f2b632'; rrect(ctx, -u * 1.6, -u * 2.3, u * 3.2, u * 2.0, u * 0.3); ctx.fill();
          ctx.fillStyle = '#cfe9f3'; rrect(ctx, -u * 1.2, -u * 2.0, u * 2.4, u * 1.0, u * 0.15); ctx.fill();
          ctx.save(); rrect(ctx, -u * 1.2, -u * 2.0, u * 2.4, u * 1.0, u * 0.15); ctx.clip();
          drawFigure(ctx, 0, -u * 0.25 + Math.abs(Math.sin(t * 9)) * u * 0.03, u * 0.8, a, t, { state: 'bus', noStand: true });
          ctx.restore();
          for (const wx of [-0.9, 0.9]) { ctx.fillStyle = '#3b2f2a'; ctx.beginPath(); ctx.arc(wx * u, -u * 0.3, u * 0.32, 0, TAU); ctx.fill(); ctx.fillStyle = '#d4a548'; ctx.beginPath(); ctx.arc(wx * u, -u * 0.3, u * 0.12, 0, TAU); ctx.fill(); }
          ctx.restore();
        } else if (c.st === 'asleep') {
          // side view of a bed: headboard, pillow, the sleeper under a quilt
          ctx.save(); ctx.translate(X, fy);
          ctx.shadowColor = 'rgba(60,30,10,0.3)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
          ctx.fillStyle = '#c08a5b'; rrect(ctx, -u * 1.7, -u * 1.5, u * 0.22, u * 1.5, u * 0.08); ctx.fill();
          ctx.fillStyle = '#fffaf0'; ctx.fillRect(-u * 1.5, -u * 0.75, u * 3.1, u * 0.5);
          ctx.fillStyle = '#c08a5b'; ctx.fillRect(-u * 1.5, -u * 0.25, u * 3.1, u * 0.12); ctx.fillRect(-u * 1.45, -u * 0.13, u * 0.12, u * 0.13); ctx.fillRect(u * 1.45, -u * 0.13, u * 0.12, u * 0.13);
          ctx.fillStyle = '#ffffff'; rrect(ctx, -u * 1.45, -u * 1.05, u * 0.8, u * 0.34, u * 0.15); ctx.fill();
          ctx.shadowColor = 'transparent';
          ctx.save(); ctx.translate(-u * 0.95, -u * 0.95); ctx.rotate(-Math.PI / 2); drawFigure(ctx, 0, u * 1.62, u, a, t, { state: 'asleep', noStand: true, noZ: true }); ctx.restore();
          const br = Math.sin(t * 1.4) * u * 0.04;
          ctx.fillStyle = HARNESS_COL[a.h]; ctx.beginPath(); ctx.moveTo(-u * 0.75, -u * 0.72); ctx.quadraticCurveTo(-u * 0.3, -u * 1.2 - br, u * 0.4, -u * 1.0 - br); ctx.quadraticCurveTo(u * 1.2, -u * 0.95, u * 1.6, -u * 0.72); ctx.lineTo(u * 1.6, -u * 0.35); ctx.lineTo(-u * 0.75, -u * 0.35); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = u * 0.04; ctx.setLineDash([u * 0.1, u * 0.08]);
          ctx.beginPath(); ctx.moveTo(-u * 0.6, -u * 0.5); ctx.lineTo(u * 1.5, -u * 0.5); ctx.stroke(); ctx.setLineDash([]);
          ctx.restore();
          zzz(ctx, X - u * 0.6, fy - u * 1.5, u, t, 0);
        } else {
          const walkX = c.st === 'walking' ? Math.sin(t * 0.8) * u * 0.6 : 0;
          drawFigure(ctx, X + walkX, fy, u, a, t, { flip: c.st === 'walking' && Math.cos(t * 0.8) < 0 });
        }
        caption(ctx, cw / 2, ch * 0.86, names[c.st], '#3b2f2a', u);
      }
      ctx.restore();
    });
  }
  function caption(ctx, x, y, text, col, u) {
    ctx.font = `700 ${Math.max(11, u * 0.36)}px Fraunces, Georgia, serif`; ctx.textAlign = 'center';
    ctx.fillStyle = col; ctx.fillText(text, x, y); ctx.textAlign = 'start';
  }

  // ---------- camera ----------
  function camera(w, h, view, portrait, pan) {
    const span = (BOOK.x1 - BOOK.x0) + (BOOK.y1 - BOOK.y0);
    const fit = Math.min(w / (span * 0.866 * 1.0), h / (span * 0.5 + 9));
    const focus = {
      hero: [15.4, 10.4, 2.4, 1], night: [15.4, 10.4, 2.4, 1],
      office: [4.2, 5.6, 1.6, 2.7], hall: [12.4, 5.4, 2, 2.9], post: [4.6, 15, 1, 3],
      harbor: [26.5, 12.5, 0.5, 2.1], apartments: [12, 15.6, 1, 2.9], phone: [5.2, 9.6, 1, 2.2],
    }[view] || [15.4, 10.4, 0.6, 1];
    let s = fit * focus[3];
    if (view === 'phone') s = w / 7.2;
    const cam = isoCam(w, h, { cx: focus[0], cy: focus[1], cz: focus[2], s });
    if (pan && (pan[0] || pan[1])) return isoCam(w, h, { cx: focus[0] - (pan[0] / s / 0.866 + pan[1] / s * 2) / 2, cy: focus[1] - (-pan[0] / s / 0.866 + pan[1] / s * 2) / 2, cz: focus[2], s });
    return cam;
  }

  // ---------- primitives ----------
  function box(ctx, cam, x0, y0, x1, y1, z0, z1, col, o = {}) {
    const p = cam.p.bind(cam);
    const top = o.top || shade(col, 0.16), left = o.left || col, right = o.right || shade(col, -0.18);
    // right face (+x)
    poly(ctx, [p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1)]);
    ctx.fillStyle = right; ctx.fill();
    poly(ctx, [p(x0, y1, z0), p(x1, y1, z0), p(x1, y1, z1), p(x0, y1, z1)]);
    ctx.fillStyle = left; ctx.fill();
    poly(ctx, [p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)]);
    ctx.fillStyle = top; ctx.fill();
    if (o.edge !== false) {
      // cut-paper edges: a bright rim along the top, a soft dark fold below
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255,253,245,0.85)'; ctx.lineWidth = Math.max(0.6, cam.s * 0.045);
      ctx.beginPath(); const a = p(x0, y1, z1), b = p(x1, y1, z1), c = p(x1, y0, z1);
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
      ctx.strokeStyle = 'rgba(60,35,20,0.25)'; ctx.lineWidth = Math.max(0.5, cam.s * 0.03);
      const d = p(x1, y1, z0);
      ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(d[0], d[1]); ctx.stroke();
    }
  }
  function flat(ctx, cam, x0, y0, x1, y1, z, col) {
    const p = cam.p.bind(cam);
    poly(ctx, [p(x0, y0, z), p(x1, y0, z), p(x1, y1, z), p(x0, y1, z)]);
    ctx.fillStyle = col; ctx.fill();
  }
  function shadowRect(ctx, cam, x0, y0, x1, y1, hgt, a = 0.22) {
    // a paper shadow falls down-right; drawn as a soft offset footprint
    const p = cam.p.bind(cam), dx = hgt * 0.55, dy = hgt * 0.12;
    ctx.save();
    ctx.fillStyle = `rgba(70,40,20,${a})`;
    ctx.filter = `blur(${Math.max(1, cam.s * 0.12)}px)`;
    poly(ctx, [p(x0, y0, 0), p(x1 + dx, y0 + dy, 0), p(x1 + dx, y1 + dy, 0), p(x0 + dx * 0.4, y1 + dy, 0), p(x0, y1, 0)]);
    ctx.fill();
    ctx.restore();
  }
  function label(ctx, cam, o, u, v, text, { size = 0.5, color = C.ink, bg = null, w = null, font = '700' } = {}) {
    ctx.save();
    cam.face(ctx, o, u, v);
    ctx.scale(0.01, -0.01);
    const S = size * 100;
    ctx.font = `${font} ${S}px "Fraunces", "Georgia", serif`;
    const tw = ctx.measureText(text).width;
    if (bg) { ctx.fillStyle = bg; rrect(ctx, -18, -S * 0.95, (w ? w * 100 : tw) + 36, S * 1.3, 12); ctx.fill(); }
    ctx.fillStyle = color; ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, 0, 0);
    ctx.restore();
    return tw / 100;
  }

  // ---------- book, desk, ground ----------
  function woodGrain(ctx, w, h) {
    ctx.save();
    ctx.globalAlpha = 0.08; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
    for (let i = 0; i < 40; i++) {
      const y = (i / 40) * h * 1.4 - h * 0.2;
      ctx.beginPath(); ctx.moveTo(0, y);
      for (let x = 0; x <= w; x += 40) ctx.lineTo(x, y + Math.sin(x * 0.004 + i) * 12 + x * 0.12);
      ctx.stroke();
    }
    ctx.restore();
  }
  function sunStick(ctx, cam, t, night) {
    // a sun (or moon) on a wooden stick, like a toy theatre
    const bob = Math.sin(t * 0.4) * 0.15;
    const base = cam.p(29, -0.9, 0), top = cam.p(29, -0.9, 9.5 + bob);
    ctx.strokeStyle = '#9a6a42'; ctx.lineWidth = cam.s * 0.14; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.lineTo(top[0], top[1]); ctx.stroke();
    const r = cam.s * 1.6;
    ctx.save(); ctx.translate(top[0], top[1]);
    ctx.shadowColor = 'rgba(40,20,0,0.35)'; ctx.shadowBlur = cam.s * 0.5; ctx.shadowOffsetX = cam.s * 0.2; ctx.shadowOffsetY = cam.s * 0.2;
    if (night >= 1) {
      ctx.fillStyle = '#f6efd2';
      ctx.beginPath(); ctx.arc(0, 0, r, Math.PI * 0.5, Math.PI * 1.5); ctx.ellipse(0, 0, r * 0.45, r, 0, Math.PI * 1.5, Math.PI * 0.5, true); ctx.fill();
    } else {
      ctx.rotate(t * 0.15);
      ctx.fillStyle = night ? '#f08a4b' : '#f6b93b';
      ctx.beginPath();
      for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU, rr = i % 2 ? r * 1.0 : r * 1.32; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.closePath(); ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = night ? '#f6a55e' : '#fbd25f'; ctx.beginPath(); ctx.arc(0, 0, r * 0.78, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  function book(ctx, cam, snow) {
    const { x0, y0, x1, y1 } = BOOK, p = cam.p.bind(cam);
    // drop shadow of the whole book on the desk
    ctx.save(); ctx.filter = `blur(${cam.s * 0.6}px)`; ctx.fillStyle = 'rgba(10,4,0,0.55)';
    poly(ctx, [p(x0 + 0.5, y0 + 0.5, -1.2), p(x1 + 1.4, y0 + 0.6, -1.2), p(x1 + 1.4, y1 + 1.2, -1.2), p(x0 + 0.6, y1 + 1.2, -1.2)]); ctx.fill();
    ctx.restore();
    // cloth cover
    box(ctx, cam, x0 - 0.5, y0 - 0.5, x1 + 0.5, y1 + 0.5, -0.9, -0.75, C.cover, { top: C.cover, left: C.coverEdge, right: shade(C.coverEdge, -0.2), edge: false });
    // page block with page lines on the two visible sides
    box(ctx, cam, x0, y0, x1, y1, -0.75, 0, C.page, { top: C.page, left: '#e9dcc0', right: '#d8c8a8', edge: false });
    ctx.strokeStyle = 'rgba(120,95,60,0.35)'; ctx.lineWidth = 0.6;
    for (let i = 1; i < 6; i++) {
      const z = -0.75 + (i / 6) * 0.75;
      let a = p(x0, y1, z), b = p(x1, y1, z), c = p(x1, y0, z);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
    }
    // spine crease
    const mid = (x0 + x1) / 2;
    const g = ctx.createLinearGradient(...p(mid - 1.4, y0), ...p(mid + 1.4, y0));
    g.addColorStop(0, 'rgba(120,90,50,0)'); g.addColorStop(0.5, 'rgba(120,90,50,0.28)'); g.addColorStop(1, 'rgba(120,90,50,0)');
    poly(ctx, [p(mid - 1.4, y0), p(mid + 1.4, y0), p(mid + 1.4, y1), p(mid - 1.4, y1)]); ctx.fillStyle = g; ctx.fill();
    // ribbon bookmark hanging over the front edge
    const r0 = p(22, y1, 0), r1 = p(22.7, y1, 0);
    ctx.fillStyle = '#b8323a';
    ctx.beginPath(); ctx.moveTo(r0[0], r0[1]); ctx.lineTo(r1[0], r1[1]); ctx.lineTo(r1[0], r1[1] + cam.s * 2.2); ctx.lineTo((r0[0] + r1[0]) / 2, r1[1] + cam.s * 1.7); ctx.lineTo(r0[0], r0[1] + cam.s * 2.2); ctx.closePath(); ctx.fill();
  }
  function ground(ctx, cam, t, snow, night, L) {
    const p = cam.p.bind(cam);
    // meadow sheet, cut with a deckled edge
    const g0 = snow ? '#eef2f5' : C.grass;
    ctx.save();
    ctx.shadowColor = 'rgba(80,50,20,0.3)'; ctx.shadowBlur = cam.s * 0.3; ctx.shadowOffsetX = cam.s * 0.15; ctx.shadowOffsetY = cam.s * 0.12;
    const pts = [], r = rng(3);
    const edge = (ax, ay, bx, by, n) => { for (let i = 0; i < n; i++) { const k = i / n; pts.push(p(lerp(ax, bx, k) + (r() - 0.5) * 0.18, lerp(ay, by, k) + (r() - 0.5) * 0.18, 0.04)); } };
    edge(-0.4, -0.4, 25.2, -0.4, 60); edge(25.2, -0.4, 25.2, 21.4, 40); edge(25.2, 21.4, -0.4, 21.4, 60); edge(-0.4, 21.4, -0.4, -0.4, 40);
    poly(ctx, pts); ctx.fillStyle = g0; ctx.fill();
    ctx.restore();
    // meadow patches
    const r2 = rng(11);
    for (let i = 0; i < 26; i++) {
      const x = r2() * 24, y = r2() * 21, rad = 0.6 + r2() * 1.4;
      if (BLOCKED.slice(0, 3).some((b) => inRect(x, y, b, rad))) continue;
      ctx.beginPath();
      for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU, rr = rad * (0.8 + r2() * 0.3); const q = p(x + Math.cos(a) * rr, y + Math.sin(a) * rr, 0.05); k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }
      ctx.closePath(); ctx.fillStyle = snow ? '#f7f9fb' : (i % 2 ? C.meadow : C.grass2); ctx.fill();
    }
    // roads: kraft strips raised a hair, with stitched centre lines
    for (const rd of ROADS) {
      ctx.save();
      ctx.shadowColor = 'rgba(80,50,20,0.25)'; ctx.shadowBlur = cam.s * 0.15; ctx.shadowOffsetY = cam.s * 0.06;
      flat(ctx, cam, rd.x0, rd.y0, rd.x1, rd.y1, 0.09, snow ? '#e6e2da' : C.road);
      ctx.restore();
      const horiz = rd.x1 - rd.x0 > rd.y1 - rd.y0;
      ctx.strokeStyle = C.stitch; ctx.lineWidth = Math.max(1, cam.s * 0.06); ctx.setLineDash([cam.s * 0.3, cam.s * 0.22]);
      ctx.beginPath();
      const a = horiz ? p(rd.x0 + 0.2, (rd.y0 + rd.y1) / 2, 0.1) : p((rd.x0 + rd.x1) / 2, rd.y0 + 0.2, 0.1);
      const b = horiz ? p(rd.x1 - 0.2, (rd.y0 + rd.y1) / 2, 0.1) : p((rd.x0 + rd.x1) / 2, rd.y1 - 0.2, 0.1);
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]);
      // the bus slot cut into the main street
      if (horiz) {
        ctx.strokeStyle = 'rgba(60,40,25,0.55)'; ctx.lineWidth = Math.max(1, cam.s * 0.08);
        const s0 = p(rd.x0 + 0.1, rd.y1 - 0.4, 0.1), s1 = p(rd.x1 - 0.1, rd.y1 - 0.4, 0.1);
        ctx.beginPath(); ctx.moveTo(s0[0], s0[1]); ctx.lineTo(s1[0], s1[1]); ctx.stroke();
      }
    }
    // the town-hall plaza: a doily circle
    const c = p(12.2, 8.6, 0.1);
    ctx.save(); ctx.translate(c[0], c[1]); ctx.scale(1, 0.5);
    const R = cam.s * 2.05;
    ctx.fillStyle = '#fbf5e8';
    ctx.beginPath();
    for (let i = 0; i < 48; i++) { const a = (i / 48) * TAU, rr = R * (i % 2 ? 1 : 1.06); ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(200,180,150,0.6)'; ctx.lineWidth = 1;
    for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; ctx.beginPath(); ctx.arc(Math.cos(a) * R * 0.72, Math.sin(a) * R * 0.72, R * 0.1, 0, TAU); ctx.stroke(); }
    ctx.restore();
    // quay
    box(ctx, cam, 24.4, -0.6, 26.1, 21.6, 0, 0.32, '#c9b79a', { top: snow ? '#eef0f2' : '#d9c8a8' });
    ctx.strokeStyle = 'rgba(110,80,50,0.3)'; ctx.lineWidth = 0.7;
    for (let y = 0; y < 21.6; y += 0.9) { const a = p(24.4, y, 0.32), b = p(26.1, y, 0.32); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
  }

  // ---------- figures ----------
  // A sticker cut-out on a fold stand. (x, y) is the feet on screen, u is px per unit.
  function drawFigure(ctx, x, y, u, a, t, o = {}) {
    const col = HARNESS_COL[a.h] || '#888';
    const s = o.state || a.s;
    const seated = s === 'working' || s === 'thinking' || s === 'idle' || o.seated;
    const ph = (a.n.charCodeAt(0) * 0.37) % TAU;
    let bob = 0, lean = 0, step = 0;
    if (s === 'walking') { step = Math.sin(t * 7 + ph); bob = Math.abs(Math.cos(t * 7 + ph)) * 0.08; }
    if (s === 'needs') bob = Math.abs(Math.sin(t * 4 + ph)) * 0.18;
    if (s === 'working') bob = Math.abs(Math.sin(t * 9 + ph)) * 0.025;
    if (s === 'idle') lean = Math.sin(t * 0.9 + ph) * 0.06;
    ctx.save();
    ctx.translate(x, y); ctx.scale(u * (o.flip ? -1 : 1), u);
    ctx.rotate(lean);
    ctx.translate(0, -bob);
    const shapes = [];
    // fold stand
    if (!o.noStand) shapes.push(['stand', () => { ctx.beginPath(); ctx.moveTo(-0.42, 0); ctx.lineTo(0.42, 0); ctx.lineTo(0.3, -0.12); ctx.lineTo(-0.3, -0.12); ctx.closePath(); }]);
    if (!seated) {
      shapes.push(['leg', () => { rrect(ctx, -0.24 + step * 0.08, -0.62, 0.17, 0.6, 0.08); }]);
      shapes.push(['leg', () => { rrect(ctx, 0.07 - step * 0.08, -0.62, 0.17, 0.6, 0.08); }]);
    }
    const by = seated ? 0.42 : 0;
    shapes.push(['body', () => { ctx.beginPath(); ctx.moveTo(-0.38, -0.5 + by); ctx.quadraticCurveTo(-0.32, -1.32 + by, 0, -1.32 + by); ctx.quadraticCurveTo(0.32, -1.32 + by, 0.38, -0.5 + by); ctx.closePath(); }]);
    shapes.push(['head', () => { ctx.beginPath(); ctx.arc(0, -1.62 + by, 0.33, 0, TAU); }]);
    // white sticker border with a cast shadow
    ctx.save();
    ctx.shadowColor = 'rgba(60,30,10,0.35)'; ctx.shadowBlur = 3; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 1;
    ctx.lineJoin = 'round'; ctx.lineWidth = 0.2; ctx.strokeStyle = C.paper; ctx.fillStyle = C.paper;
    for (const [, sh] of shapes) { sh(); ctx.stroke(); ctx.fill(); }
    ctx.restore();
    for (const [k, sh] of shapes) {
      sh();
      ctx.fillStyle = k === 'head' ? '#f7e4cf' : k === 'stand' ? '#d9c6a2' : k === 'leg' ? shade(col, -0.45) : col;
      ctx.fill();
    }
    // a fold crease on the body
    ctx.strokeStyle = shade(col, -0.25); ctx.lineWidth = 0.04;
    ctx.beginPath(); ctx.moveTo(0, -1.25 + by); ctx.lineTo(0, -0.55 + by); ctx.stroke();
    hat(ctx, a.h, col, by, t);
    // face
    const hy = -1.62 + by;
    ctx.fillStyle = C.ink; ctx.strokeStyle = C.ink; ctx.lineWidth = 0.05; ctx.lineCap = 'round';
    if (s === 'asleep') {
      ctx.beginPath(); ctx.arc(-0.12, hy, 0.06, 0.2, Math.PI - 0.2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0.12, hy, 0.06, 0.2, Math.PI - 0.2); ctx.stroke();
    } else {
      const blink = (Math.sin(t * 0.7 + ph * 3) > 0.985) ? 0.15 : 1;
      const look = s === 'thinking' ? -0.06 : 0;
      ctx.save(); ctx.translate(0, hy + look); ctx.scale(1, blink);
      ctx.beginPath(); ctx.arc(-0.12, 0, 0.045, 0, TAU); ctx.arc(0.12, 0, 0.045, 0, TAU); ctx.fill(); ctx.restore();
      ctx.fillStyle = 'rgba(230,110,100,0.45)';
      ctx.beginPath(); ctx.arc(-0.2, hy + 0.12, 0.06, 0, TAU); ctx.arc(0.2, hy + 0.12, 0.06, 0, TAU); ctx.fill();
      ctx.beginPath();
      if (s === 'needs') ctx.arc(0, hy + 0.15, 0.05, 0, TAU);
      else ctx.arc(0, hy + 0.08, 0.08, 0.3, Math.PI - 0.3);
      s === 'needs' ? (ctx.fillStyle = C.ink, ctx.fill()) : ctx.stroke();
    }
    // props by state
    if (s === 'working' && !o.noDesk) {
      ctx.fillStyle = '#d6dde6';
      ctx.fillRect(-0.32, -0.2, 0.64, 0.08);
    }
    if (s === 'idle' && !o.noMug) {
      ctx.save(); ctx.translate(0.36, -0.45 + by * 0.4);
      ctx.fillStyle = C.paper; rrect(ctx, -0.02, -0.02, 0.3, 0.34, 0.06); ctx.fill();
      ctx.fillStyle = '#e9a83b'; rrect(ctx, 0.02, 0.02, 0.22, 0.26, 0.04); ctx.fill();
      ctx.fillStyle = '#fff6df'; rrect(ctx, 0.02, 0.0, 0.22, 0.07, 0.03); ctx.fill();
      ctx.restore();
    }
    if (s === 'done') {
      ctx.save(); ctx.translate(0.45, -1.5); ctx.rotate(Math.sin(t * 2 + ph) * 0.08);
      ctx.fillStyle = C.paper; ctx.beginPath(); ctx.arc(0, 0, 0.3, 0, TAU); ctx.fill();
      ctx.fillStyle = '#4caf6e'; ctx.beginPath(); ctx.arc(0, 0, 0.24, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.07; ctx.beginPath(); ctx.moveTo(-0.11, 0); ctx.lineTo(-0.02, 0.09); ctx.lineTo(0.13, -0.09); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    // props that should not tilt with the figure
    if (s === 'thinking') thought(ctx, x, y - (seated ? 1.55 : 2.0) * u, u, t, ph);
    if (s === 'needs') flag(ctx, x + 0.42 * u, y - 1.2 * u - bob * u, u, t, ph);
    if (s === 'asleep' && !o.noZ) zzz(ctx, x + 0.3 * u, y - 1.9 * u, u, t, ph);
  }
  function hat(ctx, h, col, by, t) {
    const y = -1.62 + by;
    ctx.save();
    if (h === 'claude') { // beret with a stalk
      ctx.fillStyle = shade(col, -0.3);
      ctx.beginPath(); ctx.ellipse(0.04, y - 0.25, 0.36, 0.13, -0.15, 0, TAU); ctx.fill();
      ctx.fillRect(0.0, y - 0.43, 0.05, 0.12);
    } else if (h === 'codex') { // mortarboard
      ctx.fillStyle = '#2a2f45';
      ctx.beginPath(); ctx.moveTo(-0.42, y - 0.3); ctx.lineTo(0, y - 0.44); ctx.lineTo(0.42, y - 0.3); ctx.lineTo(0, y - 0.18); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 0.04; ctx.beginPath(); ctx.moveTo(0, y - 0.31); ctx.lineTo(0.3, y - 0.22); ctx.lineTo(0.3, y - 0.04); ctx.stroke();
    } else if (h === 'gemini') { // twin antennae with stars
      ctx.strokeStyle = shade(col, -0.35); ctx.lineWidth = 0.05;
      for (const sx of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(sx * 0.12, y - 0.28); ctx.quadraticCurveTo(sx * 0.3, y - 0.55, sx * 0.25, y - 0.62); ctx.stroke();
        ctx.fillStyle = '#f6d55c'; star(ctx, sx * 0.25, y - 0.66, 0.1);
      }
    } else if (h === 'rex') { // a little crest of spikes
      ctx.fillStyle = shade(col, -0.25);
      ctx.beginPath(); ctx.moveTo(-0.28, y - 0.2);
      for (let i = 0; i < 4; i++) { ctx.lineTo(-0.2 + i * 0.15, y - 0.46); ctx.lineTo(-0.12 + i * 0.15, y - 0.24); }
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function star(ctx, x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i / 10) * TAU, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
  }
  function thought(ctx, x, y, u, t, ph) {
    // a cloud cut-out on a wire
    const sway = Math.sin(t * 1.6 + ph) * 0.12 * u;
    ctx.strokeStyle = 'rgba(70,60,50,0.6)'; ctx.lineWidth = Math.max(0.6, u * 0.03);
    ctx.beginPath(); ctx.moveTo(x, y + 0.3 * u); ctx.quadraticCurveTo(x + sway * 0.5, y - 0.3 * u, x + sway, y - 0.6 * u); ctx.stroke();
    const cx = x + sway, cy = y - 0.95 * u;
    ctx.save();
    ctx.shadowColor = 'rgba(60,30,10,0.3)'; ctx.shadowBlur = 3; ctx.shadowOffsetX = 1.5; ctx.shadowOffsetY = 1;
    ctx.fillStyle = C.paper;
    ctx.beginPath();
    for (const [dx, dy, r] of [[-0.35, 0.05, 0.3], [0, -0.12, 0.38], [0.36, 0.04, 0.3], [0, 0.16, 0.3]]) { ctx.moveTo(cx + (dx + r) * u, cy + dy * u); ctx.arc(cx + dx * u, cy + dy * u, r * u, 0, TAU); }
    ctx.fill();
    ctx.restore();
    for (let i = 0; i < 3; i++) {
      const on = Math.floor(t * 2.5) % 4 > i;
      ctx.fillStyle = on ? C.ink : 'rgba(59,47,42,0.2)';
      ctx.beginPath(); ctx.arc(cx + (i - 1) * 0.24 * u, cy, 0.065 * u, 0, TAU); ctx.fill();
    }
  }
  function flag(ctx, x, y, u, t, ph) {
    // "?" pennant on a stick, waving
    ctx.strokeStyle = '#8a5a35'; ctx.lineWidth = Math.max(1, u * 0.07); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y + 0.5 * u); ctx.lineTo(x, y - 1.3 * u); ctx.stroke();
    const w = 0.95 * u, hh = 0.62 * u, top = y - 1.3 * u;
    ctx.save();
    ctx.shadowColor = 'rgba(60,30,10,0.3)'; ctx.shadowBlur = 3; ctx.shadowOffsetX = 1.5; ctx.shadowOffsetY = 1;
    ctx.beginPath(); ctx.moveTo(x, top);
    for (let i = 0; i <= 8; i++) { const k = i / 8; ctx.lineTo(x + k * w, top + Math.sin(t * 6 + k * 3 + ph) * 0.07 * u * k); }
    for (let i = 8; i >= 0; i--) { const k = i / 8; ctx.lineTo(x + k * w, top + hh + Math.sin(t * 6 + k * 3 + ph) * 0.07 * u * k); }
    ctx.closePath(); ctx.fillStyle = '#ffc93c'; ctx.fill();
    ctx.restore();
    ctx.fillStyle = C.ink; ctx.font = `800 ${0.55 * u}px "Fraunces", Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('?', x + w * 0.45, top + hh * 0.55 + Math.sin(t * 6 + 1.4 + ph) * 0.03 * u);
    ctx.textAlign = 'start';
  }
  function zzz(ctx, x, y, u, t, ph) {
    ctx.font = `800 ${0.5 * u}px "Fraunces", Georgia, serif`; ctx.textAlign = 'center';
    for (let i = 0; i < 3; i++) {
      const k = ((t * 0.35 + i / 3 + ph) % 1);
      const zx = x + (0.2 + k * 0.6) * u + Math.sin(t * 2 + i) * 0.1 * u, zy = y - k * 1.1 * u;
      ctx.globalAlpha = Math.sin(k * Math.PI);
      ctx.strokeStyle = 'rgba(80,70,60,0.5)'; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(zx, zy - 0.5 * u); ctx.lineTo(zx, zy - 1.6 * u); ctx.stroke();
      ctx.fillStyle = C.paper; ctx.fillText('z', zx + 1, zy + 1);
      ctx.fillStyle = '#5b6fb5'; ctx.fillText('z', zx, zy);
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'start';
  }

  // ---------- rooms and buildings ----------
  function tray(ctx, cam, x0, y0, x1, y1, z0, col, lit, t, fill, L, name) {
    // an open-top shoebox room: back walls, floor, contents, low front walls
    const p = cam.p.bind(cam);
    const wall = lit ? col : mix(col, '#7f8aa0', 0.65), floor = lit ? '#f7e7c4' : '#c9ccd4';
    const H = 1.05, F = 0.28;
    // back walls (inside faces)
    poly(ctx, [p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z0 + H), p(x0, y0, z0 + H)]); ctx.fillStyle = shade(wall, -0.05); ctx.fill();
    poly(ctx, [p(x0, y0, z0), p(x0, y1, z0), p(x0, y1, z0 + H), p(x0, y0, z0 + H)]); ctx.fillStyle = shade(wall, 0.12); ctx.fill();
    // wallpaper stripes
    ctx.save(); poly(ctx, [p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z0 + H), p(x0, y0, z0 + H)]); ctx.clip();
    ctx.strokeStyle = shade(wall, lit ? 0.18 : 0.08); ctx.lineWidth = cam.s * 0.08;
    for (let x = x0 + 0.25; x < x1; x += 0.35) { const a = p(x, y0, z0), b = p(x, y0, z0 + H); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    ctx.restore();
    // floor with plank lines
    flat(ctx, cam, x0, y0, x1, y1, z0, floor);
    ctx.strokeStyle = lit ? 'rgba(170,120,70,0.25)' : 'rgba(80,90,110,0.2)'; ctx.lineWidth = 0.7;
    for (let y = y0 + 0.4; y < y1; y += 0.4) { const a = p(x0, y, z0), b = p(x1, y, z0); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    // nameplate on the back wall
    label(ctx, cam, [x0 + 0.18, y0 + 0.01, z0 + H - 0.42], [1, 0, 0], [0, 0, 1], name, { size: 0.3, color: lit ? C.ink : '#5c6478', bg: lit ? 'rgba(255,250,240,0.9)' : 'rgba(220,224,232,0.8)' });
    if (lit) {
      // hanging paper lamp
      const lx = (x0 + x1) / 2, ly = (y0 + y1) / 2, lz = z0 + H + 0.9;
      const a = p(lx, ly, lz + 0.8), b = p(lx, ly, lz);
      ctx.strokeStyle = 'rgba(60,40,30,0.5)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      ctx.fillStyle = '#fff1c9'; ctx.beginPath(); ctx.ellipse(b[0], b[1] + cam.s * 0.18, cam.s * 0.28, cam.s * 0.24, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(200,150,90,0.6)'; ctx.lineWidth = 0.6;
      for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.ellipse(b[0], b[1] + cam.s * 0.18 + i * cam.s * 0.08, cam.s * 0.27, cam.s * 0.05, 0, 0, TAU); ctx.stroke(); }
      const fl = p(lx, ly, z0);
      L.push((c, n) => {
        const g = c.createRadialGradient(fl[0], fl[1] - cam.s * 0.4, 0, fl[0], fl[1] - cam.s * 0.4, cam.s * 2.4);
        g.addColorStop(0, `rgba(255,190,110,${0.55 * n})`); g.addColorStop(1, 'rgba(255,160,80,0)');
        c.fillStyle = g; c.fillRect(fl[0] - cam.s * 3, fl[1] - cam.s * 3, cam.s * 6, cam.s * 5);
        const g2 = c.createRadialGradient(b[0], b[1] + cam.s * 0.18, 0, b[0], b[1] + cam.s * 0.18, cam.s * 0.9);
        g2.addColorStop(0, `rgba(255,230,170,${0.9 * n})`); g2.addColorStop(1, 'rgba(255,200,120,0)');
        c.fillStyle = g2; c.fillRect(b[0] - cam.s, b[1] - cam.s, cam.s * 2, cam.s * 2.4);
      });
    }
    fill && fill();
    // front walls, low so the room reads from above
    poly(ctx, [p(x0, y1, z0 - 0.02), p(x1, y1, z0 - 0.02), p(x1, y1, z0 + F), p(x0, y1, z0 + F)]); ctx.fillStyle = shade(wall, 0.05); ctx.fill();
    poly(ctx, [p(x1, y0, z0 - 0.02), p(x1, y1, z0 - 0.02), p(x1, y1, z0 + F), p(x1, y0, z0 + F)]); ctx.fillStyle = shade(wall, -0.2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,253,245,0.9)'; ctx.lineWidth = Math.max(0.6, cam.s * 0.04);
    const e = [p(x0, y1, z0 + F), p(x1, y1, z0 + F), p(x1, y0, z0 + F)];
    ctx.beginPath(); ctx.moveTo(...e[0]); ctx.lineTo(...e[1]); ctx.lineTo(...e[2]); ctx.stroke();
    // back wall rims
    const r = [p(x0, y1, z0 + H), p(x0, y0, z0 + H), p(x1, y0, z0 + H)];
    ctx.beginPath(); ctx.moveTo(...r[0]); ctx.lineTo(...r[1]); ctx.lineTo(...r[2]); ctx.stroke();
  }
  function desk(ctx, cam, x, y, z, glow, L) {
    box(ctx, cam, x - 0.42, y - 0.2, x + 0.42, y + 0.2, z, z + 0.3, '#d7a46a', { top: '#e8c08b' });
    // laptop: base plus a screen card facing the viewer
    box(ctx, cam, x - 0.17, y - 0.1, x + 0.17, y + 0.1, z + 0.3, z + 0.33, '#b7c0cc', { edge: false });
    const p = cam.p.bind(cam);
    const sc = [p(x - 0.17, y - 0.1, z + 0.33), p(x + 0.17, y - 0.1, z + 0.33), p(x + 0.17, y - 0.03, z + 0.55), p(x - 0.17, y - 0.03, z + 0.55)];
    poly(ctx, sc); ctx.fillStyle = '#2d3550'; ctx.fill();
    if (glow) {
      ctx.fillStyle = 'rgba(140,220,255,0.5)'; ctx.fill();
      L && L.push((c, n) => { poly(c, sc); c.fillStyle = `rgba(120,200,255,${0.7 * n})`; c.fill(); const m = p(x, y + 0.3, z + 0.6); const g = c.createRadialGradient(m[0], m[1], 0, m[0], m[1], cam.s * 0.9); g.addColorStop(0, `rgba(110,190,255,${0.35 * n})`); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(m[0] - cam.s, m[1] - cam.s, cam.s * 2, cam.s * 2); });
    }
  }
  function figureAt(ctx, cam, a, x, y, z, t, o) {
    const q = cam.p(x, y, z);
    drawFigure(ctx, q[0], q[1], cam.s * ((o && o.scale) || 0.5), a, t, o);
  }
  function office(add, cam, t, b, snow, L) {
    const { x0, y0 } = b, X1 = x0 + 6.4;
    add(x0 + y0 + 0.5, (ctx) => {
      shadowRect(ctx, cam, x0, y0, X1, y0 + 1, 6.2, 0.25);
      // backdrop facade: a tall folded card with windows and the host sign
      box(ctx, cam, x0, y0, X1, y0 + 0.7, 0, 5.6, '#ece0c8', { top: snow ? '#fff' : '#f7efdf', right: '#cdbfa3' });
      const p = cam.p.bind(cam);
      // stepped roofline with a pennant
      box(ctx, cam, x0 + 1.6, y0 + 0.05, X1 - 1.6, y0 + 0.65, 5.6, 6.5, '#ece0c8', { top: snow ? '#fff' : '#f7efdf', right: '#cdbfa3' });
      for (let r = 0; r < 4; r++) for (let c = 0; c < 9; c++) {
        const wx = x0 + 0.4 + c * 0.66, wz = 2.7 + r * 0.7;
        if (wz > 5.1) continue;
        const lit = (c * 7 + r * 3 + b.name.length) % 5 < 2;
        poly(ctx, [p(wx, y0 + 0.71, wz), p(wx + 0.38, y0 + 0.71, wz), p(wx + 0.38, y0 + 0.71, wz + 0.46), p(wx, y0 + 0.71, wz + 0.46)]);
        ctx.fillStyle = lit ? '#ffd98a' : '#9fb3c8'; ctx.fill();
        if (lit) L.push((c2, n) => { poly(c2, [p(wx, y0 + 0.71, wz), p(wx + 0.38, y0 + 0.71, wz), p(wx + 0.38, y0 + 0.71, wz + 0.46), p(wx, y0 + 0.71, wz + 0.46)]); c2.fillStyle = `rgba(255,190,90,${0.8 * n})`; c2.fill(); });
      }
      label(ctx, cam, [x0 + 2.0, y0 + 0.72, 5.62], [1, 0, 0], [0, 0, 1], b.name, { size: 0.62, color: '#fffaf0', bg: '#c8553d' });
      // flag on the roof
      const fp = p(x0 + 3.2, y0 + 0.35, 6.5), ft = p(x0 + 3.2, y0 + 0.35, 7.9);
      ctx.strokeStyle = '#8a5a35'; ctx.lineWidth = Math.max(1, cam.s * 0.06); ctx.beginPath(); ctx.moveTo(...fp); ctx.lineTo(...ft); ctx.stroke();
      ctx.fillStyle = '#ef8354'; ctx.beginPath(); ctx.moveTo(...ft);
      ctx.lineTo(ft[0] + cam.s * 0.9, ft[1] + cam.s * 0.25 + Math.sin(t * 3) * cam.s * 0.08); ctx.lineTo(ft[0], ft[1] + cam.s * 0.5); ctx.fill();
      // plinth for the back row
      box(ctx, cam, x0, y0 + 0.8, X1, y0 + 3.8, 0, 1.15, '#d9c3a0', { top: '#e7d6b6' });
    });
    // rooms as trays: two back on the plinth, two front at ground level
    const slots = [[x0 + 0.1, y0 + 0.9, x0 + 3.1, y0 + 3.7, 1.15], [x0 + 3.3, y0 + 0.9, X1 - 0.1, y0 + 3.7, 1.15], [x0 + 0.1, y0 + 4.1, x0 + 3.1, y0 + 7.1, 0], [x0 + 3.3, y0 + 4.1, X1 - 0.1, y0 + 7.1, 0]];
    b.rooms.forEach((rm, i) => {
      const [a0, b0, a1, b1, z] = slots[i];
      add(a0 + b0 + (a1 - a0 + b1 - b0) * 0.5 + 0.6 + z, (ctx) => {
        tray(ctx, cam, a0, b0, a1, b1, z, PROJ[rm.id] || '#c9a', rm.lit, t, () => {
          const seats = [[a0 + 0.85, b0 + 1.0], [a0 + 2.2, b0 + 1.0], [a0 + 0.85, b0 + 2.2], [a0 + 2.2, b0 + 2.2]];
          seats.forEach(([sx, sy], k) => {
            const who = rm.people[k];
            if (who) figureAt(ctx, cam, who[0], sx - 0.3, sy - 0.3, z, t, { scale: 0.58 });
            desk(ctx, cam, sx, sy, z, !!who && rm.lit, L);
          });
        }, L, rm.id);
      });
    });
    // reception: a counter, a bell, and a little queue in front
    add(x0 + y0 + 8.8, (ctx) => {
      const rx = x0 + 1.4, ry = y0 + 7.6;
      shadowRect(ctx, cam, rx, ry, rx + 3.4, ry + 0.8, 1.2, 0.2);
      box(ctx, cam, rx, ry, rx + 3.4, ry + 0.7, 0, 0.75, '#5e7fa3', { top: '#e9e2d0' });
      label(ctx, cam, [rx + 0.3, ry + 0.71, 0.22], [1, 0, 0], [0, 0, 1], 'RECEPTION', { size: 0.34, color: '#fffaf0' });
      const bell = cam.p(rx + 3.0, ry + 0.35, 0.78);
      ctx.fillStyle = '#e9b949'; ctx.beginPath(); ctx.arc(bell[0], bell[1], cam.s * 0.16, Math.PI, 0); ctx.fill();
      // queue: oldest first, nearest the desk
      b.queue.forEach((a, k) => figureAt(ctx, cam, a, rx + 0.7 + k * 1.05, ry + 1.25 + (k % 2) * 0.12, 0, t));
    });
  }
  function townHall(add, cam, t, snow, L) {
    const x0 = 9.4, y0 = 1.0, x1 = 15.0, y1 = 5.4;
    add(x0 + y0 + 6, (ctx) => {
      const p = cam.p.bind(cam);
      shadowRect(ctx, cam, x0, y0, x1, y1 + 1.4, 6.5, 0.25);
      const roof = snow ? '#fbfbfb' : null;
      box(ctx, cam, x0, y0, x1, y1, 0, 3.4, '#f0dfc0', { top: roof || '#f8ecd5', right: '#d6c2a0' });
      // clock tower
      box(ctx, cam, x0 + 2.0, y0 + 0.9, x0 + 3.6, y0 + 2.5, 3.4, 6.6, '#e9d4ae', { top: roof || '#f3e3c4' });
      const cc = p(x0 + 2.8, y0 + 2.51, 5.6);
      ctx.save(); ctx.translate(cc[0], cc[1]); ctx.transform(1, -0.5, 0, 1, 0, 0);
      ctx.fillStyle = '#fffaf0'; ctx.beginPath(); ctx.arc(0, 0, cam.s * 0.55, 0, TAU); ctx.fill();
      ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(1, cam.s * 0.06); ctx.lineCap = 'round';
      const hr = t * 0.05, mn = t * 0.6;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.sin(hr) * cam.s * 0.3, -Math.cos(hr) * cam.s * 0.3); ctx.moveTo(0, 0); ctx.lineTo(Math.sin(mn) * cam.s * 0.45, -Math.cos(mn) * cam.s * 0.45); ctx.stroke();
      ctx.restore();
      // pyramid roof on the tower
      const tp = p(x0 + 2.8, y0 + 1.7, 7.9);
      poly(ctx, [p(x0 + 1.9, y0 + 2.6, 6.6), p(x0 + 3.7, y0 + 2.6, 6.6), tp]); ctx.fillStyle = '#c8553d'; ctx.fill();
      poly(ctx, [p(x0 + 3.7, y0 + 2.6, 6.6), p(x0 + 3.7, y0 + 0.8, 6.6), tp]); ctx.fillStyle = '#9e3f2c'; ctx.fill();
      // portico with columns and a pediment card
      box(ctx, cam, x0 + 0.6, y1, x1 - 0.6, y1 + 1.2, 0, 0.3, '#e6d6b8');
      for (let i = 0; i < 6; i++) { const cx = x0 + 1.0 + i * 0.86; box(ctx, cam, cx, y1 + 0.5, cx + 0.28, y1 + 0.78, 0.3, 2.9, '#fffaf0', { edge: false }); }
      box(ctx, cam, x0 + 0.5, y1 + 0.2, x1 - 0.5, y1 + 1.0, 2.9, 3.3, '#f4e6c9', { top: roof || '#fbf3e3' });
      poly(ctx, [p(x0 + 0.5, y1 + 1.0, 3.3), p(x1 - 0.5, y1 + 1.0, 3.3), p((x0 + x1) / 2, y1 + 1.0, 4.6)]); ctx.fillStyle = '#f8ecd5'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,253,245,0.9)'; ctx.lineWidth = 1; ctx.stroke();
      label(ctx, cam, [x0 + 1.55, y1 + 1.01, 2.98], [1, 0, 0], [0, 0, 1], 'TOWN  HALL', { size: 0.3 });
      // HIRING banner hanging on the right face
      ctx.save(); cam.face(ctx, [x1 + 0.01, y0 + 3.6, 3.1], [0, -1, 0], [0, 0, 1]); ctx.scale(1, -1);
      ctx.fillStyle = '#2a9d8f'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(1.3, 0); ctx.lineTo(1.3, 2.2); ctx.lineTo(0.65, 1.9); ctx.lineTo(0, 2.2); ctx.closePath(); ctx.fill();
      ctx.scale(0.01, 0.01); ctx.fillStyle = '#fffaf0'; ctx.font = '800 28px Fraunces, Georgia, serif'; ctx.textAlign = 'center';
      'HIRE'.split('').forEach((ch, i) => ctx.fillText(ch, 65, 45 + i * 36));
      ctx.restore();
      if (true) {
        const w1 = [p(x0 + 0.6, y1 + 0.01, 1.4), p(x0 + 1.2, y1 + 0.01, 1.4), p(x0 + 1.2, y1 + 0.01, 2.3), p(x0 + 0.6, y1 + 0.01, 2.3)];
        L.push((c, n) => { for (const dx of [0, 4.0]) { const q = w1.map(([a, b2]) => [a + dx * cam.s * 0.866, b2 + dx * cam.s * 0.5]); poly(c, q); c.fillStyle = `rgba(255,200,110,${0.7 * n})`; c.fill(); } });
      }
    });
    // expenses easel: a paper bar chart in the plaza
    add(10.6 + 7.6 + 0.2, (ctx) => {
      const ex = 10.2, ey = 7.6, p = cam.p.bind(cam);
      const legs = [[ex, ey, 0], [ex + 1.6, ey, 0]];
      ctx.strokeStyle = '#8a5a35'; ctx.lineWidth = Math.max(1, cam.s * 0.07);
      for (const [lx, ly] of legs) { const a = p(lx, ly, 0), b = p(lx + 0.1, ly - 0.15, 2.2); ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); }
      ctx.save(); cam.face(ctx, [ex - 0.1, ey - 0.12, 1.0], [1, 0, 0], [0, -0.05, 1]); ctx.scale(1, -1);
      ctx.fillStyle = '#fffaf0'; ctx.fillRect(0, -1.3, 1.95, 1.3);
      ctx.save(); ctx.scale(0.01, 0.01); ctx.fillStyle = C.ink; ctx.font = '700 20px Fraunces, Georgia, serif'; ctx.fillText('EXPENSES', 12, -106); ctx.restore();
      const bars = [0.4, 0.62, 0.5, 0.85, 0.7];
      bars.forEach((v, i) => { ctx.fillStyle = i === 3 ? '#e07a5f' : '#4ea3a3'; ctx.fillRect(0.18 + i * 0.34, -0.12 - v * 0.75, 0.22, v * 0.75); });
      ctx.restore();
    });
  }
  function bar(add, cam, t, snow, L) {
    const x0 = 0.8, y0 = 13, x1 = 4.8, y1 = 17.4;
    add(x0 + y0 + 3.5, (ctx) => {
      const p = cam.p.bind(cam);
      shadowRect(ctx, cam, x0, y0, x1, y0 + 0.6, 3.2, 0.22);
      box(ctx, cam, x0, y0, x1, y0 + 0.5, 0, 3.0, '#7a4b6b', { top: snow ? '#fff' : '#946184' });
      label(ctx, cam, [x0 + 0.45, y0 + 0.51, 2.0], [1, 0, 0], [0, 0, 1], 'The Lounge', { size: 0.55, color: '#ffe8a8', font: 'italic 800' });
      // string lights along the top
      const bulbs = [];
      for (let i = 0; i <= 10; i++) { const k = i / 10; bulbs.push(p(lerp(x0, x1, k), y0 + 0.55, 2.75 - Math.sin(k * Math.PI) * 0.35)); }
      ctx.strokeStyle = 'rgba(40,30,30,0.6)'; ctx.lineWidth = 0.7; ctx.beginPath(); bulbs.forEach((b, i) => (i ? ctx.lineTo(...b) : ctx.moveTo(...b))); ctx.stroke();
      bulbs.forEach((b, i) => { ctx.fillStyle = ['#ffd166', '#ef476f', '#06d6a0', '#ffd166'][i % 4]; ctx.beginPath(); ctx.arc(b[0], b[1] + 2, cam.s * 0.09, 0, TAU); ctx.fill(); });
      L.push((c, n) => bulbs.forEach((b, i) => { const g = c.createRadialGradient(b[0], b[1] + 2, 0, b[0], b[1] + 2, cam.s * 0.5); g.addColorStop(0, `rgba(255,${180 + (i % 3) * 20},120,${0.9 * n})`); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(b[0] - cam.s, b[1] - cam.s, cam.s * 2, cam.s * 2); }));
    });
    add(x0 + y0 + 4.6, (ctx) => {
      tray(ctx, cam, x0, y0 + 0.6, x1, y1, 0, '#b07aa1', true, t, () => {
        // counter along the back, stools in front
        box(ctx, cam, x0 + 0.3, y0 + 1.0, x1 - 0.3, y0 + 1.5, 0, 0.6, '#8a5a35', { top: '#c08a5b' });
        const glassP = cam.p(x0 + 1.0, y0 + 1.2, 0.62);
        ctx.fillStyle = 'rgba(200,240,255,0.8)'; ctx.fillRect(glassP[0] - 2, glassP[1] - cam.s * 0.25, 4, cam.s * 0.25);
        figureAt(ctx, cam, A.moss, x0 + 1.2, y0 + 2.2, 0, t);
        figureAt(ctx, cam, A.ember, x0 + 2.7, y0 + 2.4, 0, t);
        for (const sx of [1.2, 2.7]) box(ctx, cam, x0 + sx - 0.2, y0 + 2.45, x0 + sx + 0.2, y0 + 2.75, 0, 0.35, '#e9b949', { edge: false });
        // a jukebox
        box(ctx, cam, x1 - 0.9, y0 + 2.8, x1 - 0.3, y0 + 3.3, 0, 1.0, '#ef476f', { top: '#ffd166' });
      }, L, 'bar');
    });
  }
  function postOffice(add, cam, t, snow, L) {
    const x0 = 5.0, y0 = 13.0, x1 = 7.0, y1 = 16.4;
    add(x0 + y0 + 3.2, (ctx) => {
      const p = cam.p.bind(cam);
      shadowRect(ctx, cam, x0, y0, x1, y1, 3.6, 0.24);
      box(ctx, cam, x0, y0, x1, y1, 0, 2.6, '#f2e3c6', { top: snow ? '#fff' : '#c8553d', right: '#d7c19c' });
      // gabled roof
      const rz = 2.6, rp = 3.6;
      poly(ctx, [p(x0, y1, rz), p(x1, y1, rz), p(x1, (y0 + y1) / 2, rp), p(x0, (y0 + y1) / 2, rp)]); ctx.fillStyle = snow ? '#fbfbfb' : '#d9634a'; ctx.fill();
      poly(ctx, [p(x1, y0, rz), p(x1, y1, rz), p(x1, (y0 + y1) / 2, rp)]); ctx.fillStyle = '#e6d3b1'; ctx.fill();
      // pigeonholes on the left face: one slot per item, some with letters
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        const wx = x0 + 0.3 + c * 0.5, wz = 0.9 + r * 0.45;
        poly(ctx, [p(wx, y1 + 0.01, wz), p(wx + 0.4, y1 + 0.01, wz), p(wx + 0.4, y1 + 0.01, wz + 0.35), p(wx, y1 + 0.01, wz + 0.35)]);
        ctx.fillStyle = '#8a5a35'; ctx.fill();
        if ((r * 3 + c) % 4 === 1 || r * 3 + c === 6) { poly(ctx, [p(wx + 0.06, y1 + 0.02, wz + 0.04), p(wx + 0.34, y1 + 0.02, wz + 0.04), p(wx + 0.34, y1 + 0.02, wz + 0.24), p(wx + 0.06, y1 + 0.02, wz + 0.24)]); ctx.fillStyle = r * 3 + c === 6 ? '#ffc93c' : '#fffaf0'; ctx.fill(); }
      }
      label(ctx, cam, [x0 + 0.35, y1 + 0.02, 2.2], [1, 0, 0], [0, 0, 1], 'POST', { size: 0.42, color: '#fffaf0', bg: '#c8553d' });
      // red pillar box with a count badge
      const pb = p(x1 + 0.5, y1 + 0.1, 0);
      const r = cam.s * 0.32, hgt = cam.s * 1.1;
      ctx.fillStyle = '#c8302f'; ctx.fillRect(pb[0] - r, pb[1] - hgt, r * 2, hgt);
      ctx.beginPath(); ctx.ellipse(pb[0], pb[1], r, r * 0.5, 0, 0, Math.PI); ctx.fill();
      ctx.fillStyle = '#e04a43'; ctx.beginPath(); ctx.ellipse(pb[0], pb[1] - hgt, r * 1.1, r * 0.55, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#2b1b1b'; ctx.fillRect(pb[0] - r * 0.6, pb[1] - hgt * 0.7, r * 1.2, cam.s * 0.07);
      const bp = [pb[0] + r, pb[1] - hgt - r * 0.4];
      ctx.fillStyle = '#ffc93c'; ctx.beginPath(); ctx.arc(bp[0], bp[1], cam.s * 0.3, 0, TAU); ctx.fill();
      ctx.fillStyle = C.ink; ctx.font = `800 ${cam.s * 0.38}px Fraunces, Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('2', bp[0], bp[1] + 1); ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
      L.push((c, n) => { const g = c.createRadialGradient(bp[0], bp[1], 0, bp[0], bp[1], cam.s * 1.2); g.addColorStop(0, `rgba(255,200,60,${0.8 * n})`); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(bp[0] - cam.s * 1.3, bp[1] - cam.s * 1.3, cam.s * 2.6, cam.s * 2.6); });
    });
  }
  function apartments(add, cam, t, snow, L) {
    const x0 = 9.2, y0 = 13.0, x1 = 15.2;
    add(x0 + y0 + 0.6, (ctx) => {
      const p = cam.p.bind(cam);
      shadowRect(ctx, cam, x0, y0, x1, y0 + 0.6, 4.4, 0.22);
      box(ctx, cam, x0, y0, x1, y0 + 0.55, 0, 4.2, '#8fa3c8', { top: snow ? '#fff' : '#a9badb', right: '#6d82a8' });
      label(ctx, cam, [x0 + 0.5, y0 + 0.56, 3.3], [1, 0, 0], [0, 0, 1], 'Apartments', { size: 0.52, color: '#fffaf0', font: 'italic 800' });
      // a crescent moon card and stars pinned to the facade
      ctx.save(); cam.face(ctx, [x1 - 1.3, y0 + 0.56, 2.4], [1, 0, 0], [0, 0, 1]); ctx.scale(1, -1);
      ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(0.5, -0.5, 0.42, 0, TAU); ctx.arc(0.68, -0.62, 0.36, 0, TAU, true); ctx.fill('evenodd');
      ctx.restore();
    });
    const units = [[0, 0, A.tansy], [2, 0, A.bram], [4, 0, null], [0, 2.4, A.olive], [2, 2.4, null], [4, 2.4, null]];
    units.forEach(([dx, dy, who]) => {
      const a0 = x0 + dx, b0 = y0 + 0.7 + dy;
      add(a0 + b0 + 2, (ctx) => {
        tray(ctx, cam, a0, b0, a0 + 1.9, b0 + 2.2, 0, '#9fb0d6', !!who, t, () => {
          // bed with a quilt; the sleeper's head on the pillow
          box(ctx, cam, a0 + 0.35, b0 + 0.35, a0 + 1.35, b0 + 1.75, 0, 0.3, '#fffaf0', { edge: false });
          box(ctx, cam, a0 + 0.35, b0 + 0.35, a0 + 1.35, b0 + 0.75, 0.3, 0.42, '#ffffff');
          if (who) {
            const hp = cam.p(a0 + 0.85, b0 + 0.6, 0.55);
            ctx.save(); ctx.translate(hp[0], hp[1]); ctx.rotate(-0.4);
            drawFigure(ctx, 0, cam.s * 0.5 * 1.6, cam.s * 0.5, who, t, { state: 'asleep', noStand: true, noZ: true });
            ctx.restore();
            box(ctx, cam, a0 + 0.35, b0 + 0.85, a0 + 1.35, b0 + 1.75, 0.3, 0.46, HARNESS_COL[who.h], { top: mix(HARNESS_COL[who.h], '#fff', 0.25) });
            zzz(ctx, hp[0] + cam.s * 0.2, hp[1] - cam.s * 0.4, cam.s * 0.5, t, dx);
          } else {
            box(ctx, cam, a0 + 0.35, b0 + 0.85, a0 + 1.35, b0 + 1.75, 0.3, 0.4, '#c7cfde');
          }
        }, who ? [] : L, who ? who.n : 'vacant');
      });
    });
  }
  function library(add, cam, t, snow, L) {
    const x0 = 17.8, y0 = 13.2, x1 = 21.8, y1 = 17.4;
    add(x0 + y0 + 4, (ctx) => {
      const p = cam.p.bind(cam);
      shadowRect(ctx, cam, x0, y0, x1, y1, 5, 0.24);
      box(ctx, cam, x0, y0, x1, y1, 0, 2.8, '#6a8caf', { top: snow ? '#fff' : '#86a5c4', right: '#4e7092' });
      // dome built from paper strips
      const c = p((x0 + x1) / 2, (y0 + y1) / 2, 2.8), R = cam.s * 1.55;
      for (let i = 0; i < 7; i++) {
        const k = i / 7;
        ctx.fillStyle = i % 2 ? '#e9b949' : '#f2c66a';
        ctx.beginPath(); ctx.ellipse(c[0], c[1] - R * Math.sin(k * Math.PI / 2) * 0.9, R * Math.cos(k * Math.PI / 2), R * 0.5 * Math.cos(k * Math.PI / 2), 0, Math.PI, TAU); ctx.fill();
      }
      ctx.fillStyle = '#d9a33c'; ctx.beginPath(); ctx.ellipse(c[0], c[1], R, R * 0.5, 0, 0, Math.PI); ctx.fill();
      // tall windows and a book-spine frieze
      for (let i = 0; i < 4; i++) {
        const wx = x0 + 0.5 + i * 0.85;
        const q = [p(wx, y1 + 0.01, 0.5), p(wx + 0.45, y1 + 0.01, 0.5), p(wx + 0.45, y1 + 0.01, 1.9), p(wx, y1 + 0.01, 1.9)];
        poly(ctx, q); ctx.fillStyle = '#ffe2a0'; ctx.fill();
        L.push((c2, n) => { poly(c2, q); c2.fillStyle = `rgba(255,190,90,${0.85 * n})`; c2.fill(); });
      }
      const spines = ['#e07a5f', '#4361a8', '#f2c14e', '#5fa86a', '#a66e93', '#fffaf0'];
      for (let i = 0; i < 22; i++) {
        const sx = x0 + 0.15 + i * 0.17, hh = 0.25 + ((i * 7) % 5) * 0.03;
        poly(ctx, [p(sx, y1 + 0.02, 2.3), p(sx + 0.13, y1 + 0.02, 2.3), p(sx + 0.13, y1 + 0.02, 2.3 + hh), p(sx, y1 + 0.02, 2.3 + hh)]);
        ctx.fillStyle = spines[i % spines.length]; ctx.fill();
      }
      label(ctx, cam, [x0 + 0.5, y1 + 0.02, 0.12], [1, 0, 0], [0, 0, 1], 'LIBRARY · memory', { size: 0.28, color: '#fffaf0' });
    });
    // stacks of books outside
    add(x1 + y1 + 1.3, (ctx) => {
      const cols = ['#e07a5f', '#4361a8', '#f2c14e', '#5fa86a'];
      for (let i = 0; i < 5; i++) box(ctx, cam, x1 + 0.3, y1 + 0.1, x1 + 1.1, y1 + 0.7, i * 0.18, i * 0.18 + 0.16, cols[i % 4], { top: '#fffaf0' });
    });
  }
  function warehouse(add, cam, t, snow, L) {
    const x0 = 22.4, y0 = 13.4, x1 = 25.8, y1 = 19.6;
    add(x0 + y0 + 4.5, (ctx) => {
      shadowRect(ctx, cam, x0, y0, x1, y0 + 0.5, 3, 0.2);
      tray(ctx, cam, x0, y0, x1, y1, 0, '#c08a5b', true, t, () => {
        // PRs as crates: green ready, amber in review, red failing, white draft
        const st = ['#5fa86a', '#e9b949', '#5fa86a', '#e07a5f', '#e9b949', '#fffaf0', '#5fa86a', '#e9b949'];
        let k = 0;
        for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) {
          const cx = x0 + 0.5 + c * 1.4, cy = y0 + 0.6 + r * 1.35;
          const stack = (r + c) % 3 === 0 ? 2 : 1;
          for (let s = 0; s < stack; s++) {
            const col = st[k++ % st.length];
            box(ctx, cam, cx, cy, cx + 0.95, cy + 0.95, s * 0.7, s * 0.7 + 0.68, col === '#fffaf0' ? '#efe7d6' : '#d6a46e', { top: col });
            if (s === stack - 1) label(ctx, cam, [cx + 0.15, cy + 0.96, s * 0.7 + 0.22], [1, 0, 0], [0, 0, 1], `#${101 + k * 7}`, { size: 0.26, color: C.ink });
          }
        }
      }, L, 'PR warehouse');
    });
    // a little crane leaning over the quay
    add(25.5 + 12.5, (ctx) => {
      const p = cam.p.bind(cam);
      box(ctx, cam, 25.0, 11.9, 25.5, 12.4, 0.3, 4.2, '#e9b949');
      const sw = Math.sin(t * 0.4) * 0.6;
      const a = p(25.25, 12.15, 4.2), b = p(28.0, 12.15 + sw, 4.6);
      ctx.strokeStyle = '#e9b949'; ctx.lineWidth = cam.s * 0.22; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
      const hook = p(28.0, 12.15 + sw, 2.2 + Math.sin(t * 0.8) * 0.4);
      ctx.strokeStyle = C.ink; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(...b); ctx.lineTo(...hook); ctx.stroke();
      ctx.fillStyle = '#5fa86a'; ctx.fillRect(hook[0] - cam.s * 0.35, hook[1], cam.s * 0.7, cam.s * 0.5);
    });
  }
  function arrival(add, cam, t) {
    // a new host pops up: a building card hinged at its base rising from the page
    const x0 = 1.0, x1 = 6.6, yH = 21.3, H = 2.3;
    const cyc = (t % 14) / 14;
    const ang = cyc < 0.45 ? ease(clamp(cyc / 0.38, 0, 1)) : cyc < 0.85 ? 1 : 1 - ease((cyc - 0.85) / 0.15);
    const a = ang * Math.PI / 2;
    add(x0 + yH + 0.2, (ctx) => {
      // the dashed lot outline printed on the page
      const p = cam.p.bind(cam);
      ctx.strokeStyle = 'rgba(80,60,40,0.45)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      poly(ctx, [p(x0, yH - H, 0.1), p(x1, yH - H, 0.1), p(x1, yH, 0.1), p(x0, yH, 0.1)]); ctx.stroke(); ctx.setLineDash([]);
      label(ctx, cam, [x0 + 0.3, yH - 0.4, 0.1], [1, 0, 0], [0, -1, 0], 'new host: pine', { size: 0.42, color: 'rgba(80,60,40,0.6)' });
      // the card
      const o = [x0, yH, 0], u = [1, 0, 0], v = [0, -Math.cos(a), Math.sin(a)];
      ctx.save();
      cam.face(ctx, o, u, v);
      ctx.fillStyle = mix('#7bb07f', '#4d7d51', 0.4 * (1 - ang)); ctx.fillRect(0, 0, x1 - x0, H);
      ctx.fillStyle = '#5c8f60'; ctx.fillRect(0, H - 0.6, x1 - x0, 0.6);
      for (let r = 0; r < 2; r++) for (let c = 0; c < 6; c++) { ctx.fillStyle = (r + c) % 3 ? '#e9f3df' : '#ffd98a'; ctx.fillRect(0.4 + c * 0.85, 0.3 + r * 0.6, 0.5, 0.38); }
      ctx.save(); ctx.translate(0.4, H - 0.14); ctx.scale(0.01, -0.01); ctx.fillStyle = '#fffaf0'; ctx.font = '800 45px Fraunces, Georgia, serif'; ctx.fillText('PINE', 0, 0); ctx.restore();
      ctx.strokeStyle = 'rgba(255,253,245,0.9)'; ctx.lineWidth = 0.05; ctx.strokeRect(0, 0, x1 - x0, H);
      ctx.restore();
      // pull-tab sticking out of the page edge
      const tab = p(x0 - 0.3 - (1 - ang) * 0.5, yH - 1.6, 0.05);
      ctx.fillStyle = '#e07a5f'; ctx.beginPath(); ctx.ellipse(tab[0], tab[1], cam.s * 0.5, cam.s * 0.28, -0.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fffaf0'; ctx.font = `700 ${cam.s * 0.24}px Fraunces, Georgia, serif`; ctx.textAlign = 'center'; ctx.fillText('PULL', tab[0], tab[1] + cam.s * 0.08); ctx.textAlign = 'start';
    });
  }
  function tree(ctx, cam, tr, t, snow) {
    // flat cut-out trees on fold stands, two kinds
    const q = cam.p(tr.x, tr.y, 0.05), u = cam.s;
    const sway = Math.sin(t * 0.8 + tr.k * 9) * 0.02;
    ctx.save(); ctx.translate(q[0], q[1]);
    ctx.fillStyle = 'rgba(70,40,20,0.22)'; ctx.beginPath(); ctx.ellipse(u * 0.4, 0, u * 0.6, u * 0.22, 0, 0, TAU); ctx.fill();
    ctx.rotate(sway);
    ctx.shadowColor = 'rgba(60,30,10,0.3)'; ctx.shadowBlur = 3; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 1;
    ctx.fillStyle = '#8a5a35'; ctx.fillRect(-u * 0.07, -u * 0.6, u * 0.14, u * 0.6);
    const g = snow ? '#f2f6f8' : ['#5f9e5d', '#76b06a', '#4d8a5b', '#8dbb6a'][Math.floor(tr.k * 4)];
    ctx.fillStyle = g;
    if (tr.round) {
      ctx.beginPath(); ctx.arc(0, -u * (0.6 + tr.h * 0.45), u * tr.h * 0.5, 0, TAU); ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = snow ? '#dfe7ec' : shade(g, -0.15);
      ctx.beginPath(); ctx.arc(u * 0.1, -u * (0.6 + tr.h * 0.38), u * tr.h * 0.33, 0, Math.PI); ctx.fill();
    } else {
      for (let i = 0; i < 3; i++) { const yy = -u * (0.4 + i * tr.h * 0.38), ww = u * tr.h * (0.55 - i * 0.12); ctx.beginPath(); ctx.moveTo(-ww, yy); ctx.lineTo(ww, yy); ctx.lineTo(0, yy - u * tr.h * 0.6); ctx.closePath(); ctx.fill(); }
    }
    ctx.restore();
  }
  function lamps(add, cam, L) {
    const spots = [[2, 9.7], [6.8, 9.7], [11, 9.7], [14.8, 12], [19.5, 9.7], [23.5, 12], [9, 2], [9, 16], [17.4, 6], [17.4, 18]];
    for (const [x, y] of spots) add(x + y, (ctx) => {
      const a = cam.p(x, y, 0.1), b = cam.p(x, y, 2.4);
      ctx.strokeStyle = '#3b2f2a'; ctx.lineWidth = Math.max(1, cam.s * 0.08); ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
      ctx.fillStyle = '#fff1c9'; ctx.beginPath(); ctx.arc(b[0], b[1], cam.s * 0.2, 0, TAU); ctx.fill();
      L.push((c, n) => {
        const g = c.createRadialGradient(b[0], b[1], 0, b[0], b[1], cam.s * 0.9); g.addColorStop(0, `rgba(255,220,150,${n})`); g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g; c.fillRect(b[0] - cam.s, b[1] - cam.s, cam.s * 2, cam.s * 2);
        c.save(); c.translate(a[0], a[1]); c.scale(1, 0.5);
        const g2 = c.createRadialGradient(0, 0, 0, 0, 0, cam.s * 1.8); g2.addColorStop(0, `rgba(255,200,120,${0.45 * n})`); g2.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g2; c.beginPath(); c.arc(0, 0, cam.s * 1.8, 0, TAU); c.fill(); c.restore();
      });
    });
  }
  function busStop(add, cam, snow) {
    const x = 11.4, y = 11.9;
    add(x + y, (ctx) => {
      box(ctx, cam, x, y, x + 1.6, y + 0.12, 0.1, 1.5, '#a9d6e5', { left: 'rgba(200,235,250,0.55)', right: 'rgba(160,210,230,0.6)', edge: false });
      box(ctx, cam, x - 0.1, y - 0.2, x + 1.7, y + 0.5, 1.5, 1.62, '#e9b949', { top: snow ? '#fff' : '#f2c66a' });
      const s = cam.p(x - 0.2, y + 0.3, 0.1), s2 = cam.p(x - 0.2, y + 0.3, 2.1);
      ctx.strokeStyle = '#3b2f2a'; ctx.lineWidth = Math.max(1, cam.s * 0.06); ctx.beginPath(); ctx.moveTo(...s); ctx.lineTo(...s2); ctx.stroke();
      ctx.fillStyle = '#4361a8'; ctx.beginPath(); ctx.arc(s2[0], s2[1], cam.s * 0.3, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fffaf0'; ctx.font = `800 ${cam.s * 0.3}px Fraunces, Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('B', s2[0], s2[1] + 1); ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    });
  }
  function busPos(t) {
    // out along the street, pause at the stop, on to the quay, then back
    const T = 32, k = t % T;
    const keys = [[0, -0.4], [9, 10.4], [12, 10.4], [18, 21.5], [20, 21.5], [29, -0.4], [32, -0.4]];
    for (let i = 0; i < keys.length - 1; i++) {
      const [ta, xa] = keys[i], [tb, xb] = keys[i + 1];
      if (k >= ta && k <= tb) return { x: lerp(xa, xb, ease((k - ta) / (tb - ta || 1))), dir: xb >= xa ? 1 : -1, moving: xa !== xb };
    }
    return { x: 0, dir: 1, moving: false };
  }
  function bus(add, cam, t, snow, L) {
    const b = busPos(t), x = b.x, y = 10.95, len = 2.6;
    add(x + len / 2 + y + 0.3, (ctx) => {
      const p = cam.p.bind(cam);
      const bounce = b.moving ? Math.abs(Math.sin(t * 10)) * 0.04 : 0;
      ctx.fillStyle = 'rgba(70,40,20,0.25)'; poly(ctx, [p(x, y, 0.1), p(x + len, y, 0.1), p(x + len + 0.4, y + 0.6, 0.1), p(x + 0.4, y + 0.6, 0.1)]); ctx.fill();
      box(ctx, cam, x, y - 0.05, x + len, y + 0.55, 0.32 + bounce, 1.35 + bounce, '#f2b632', { top: snow ? '#fff' : '#f7cf6a' });
      // windows with riders
      for (let i = 0; i < 4; i++) {
        const wx = x + 0.2 + i * 0.6;
        const q = [p(wx, y + 0.56, 0.8 + bounce), p(wx + 0.45, y + 0.56, 0.8 + bounce), p(wx + 0.45, y + 0.56, 1.2 + bounce), p(wx, y + 0.56, 1.2 + bounce)];
        poly(ctx, q); ctx.fillStyle = '#cfe9f3'; ctx.fill();
        if (i === 1 || i === 2) {
          const hp = p(wx + 0.22, y + 0.56, 0.9 + bounce);
          ctx.save(); ctx.beginPath(); poly(ctx, q); ctx.clip();
          drawFigure(ctx, hp[0], hp[1] + cam.s * 0.5, cam.s * 0.42, i === 1 ? A.fig : A.quill, t, { state: 'bus', noStand: true });
          ctx.restore();
        }
        L.push((c, n) => { poly(c, q); c.fillStyle = `rgba(255,220,140,${0.6 * n})`; c.fill(); });
      }
      label(ctx, cam, [x + 0.15, y + 0.56, 0.42 + bounce], [1, 0, 0], [0, 0, 1], 'TOWN LOOP', { size: 0.22, color: '#5a3d2b' });
      // brass split-pin wheels
      for (const wx of [x + 0.5, x + len - 0.5]) {
        const c = p(wx, y + 0.56, 0.32);
        ctx.fillStyle = '#3b2f2a'; ctx.beginPath(); ctx.ellipse(c[0], c[1], cam.s * 0.3, cam.s * 0.34, -0.5, 0, TAU); ctx.fill();
        ctx.fillStyle = '#d4a548'; ctx.beginPath(); ctx.arc(c[0], c[1], cam.s * 0.11, 0, TAU); ctx.fill();
      }
      const hl = p(b.dir > 0 ? x + len : x, y + 0.25, 0.7);
      L.push((c, n) => { const g = c.createRadialGradient(hl[0], hl[1], 0, hl[0], hl[1], cam.s * 1.6); g.addColorStop(0, `rgba(255,240,180,${0.9 * n})`); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(hl[0] - cam.s * 2, hl[1] - cam.s * 2, cam.s * 4, cam.s * 4); });
    });
  }
  function walkers(add, cam, t, weather) {
    const paths = [
      [A.fig, (k) => [8.3, lerp(0.8, 20, k)], 26],
      [A.quill, (k) => [lerp(1.2, 7.6, k), 12.25], 14],
    ];
    paths.forEach(([a, f, T], i) => {
      const ph = (t / T + i * 0.37) % 2, k = ph < 1 ? ph : 2 - ph, [x, y] = f(k);
      add(x + y + 0.1, (ctx) => {
        const q = cam.p(x, y, 0.1);
        ctx.fillStyle = 'rgba(70,40,20,0.25)'; ctx.beginPath(); ctx.ellipse(q[0] + cam.s * 0.15, q[1], cam.s * 0.35, cam.s * 0.12, 0, 0, TAU); ctx.fill();
        drawFigure(ctx, q[0], q[1], cam.s * 0.5, a, t, { state: 'walking', flip: ph >= 1 });
        if (weather === 'rain') umbrella(ctx, q[0], q[1] - cam.s * 1.15, cam.s * 0.5, a);
      });
    });
  }
  function umbrella(ctx, x, y, u, a) {
    ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(1, u * 0.06); ctx.beginPath(); ctx.moveTo(x + u * 0.3, y + u * 0.6); ctx.lineTo(x + u * 0.3, y - u * 0.4); ctx.stroke();
    ctx.fillStyle = HARNESS_COL[a.h];
    ctx.beginPath(); ctx.moveTo(x - u * 0.6, y - u * 0.35);
    ctx.quadraticCurveTo(x + u * 0.3, y - u * 1.6, x + u * 1.2, y - u * 0.35);
    for (let i = 3; i >= 0; i--) ctx.quadraticCurveTo(x - u * 0.6 + (i + 0.5) * u * 0.45, y - u * 0.15, x - u * 0.6 + i * u * 0.45, y - u * 0.35);
    ctx.fill();
  }
  function planes(ctx, cam, t) {
    // "needs you" flies to the post office as paper planes
    const routes = [[[3.5, 9.4, 1.4], [6.2, 16.6, 2.6], 0], [[3.5, 9.4, 1.4], [6.2, 16.6, 2.6], 0.5], [[21, 9.4, 1.4], [6.4, 16.6, 2.6], 0.25]];
    for (const [a, b, off] of routes) {
      const k = (t / 5 + off) % 1;
      const pos = (kk) => cam.p(lerp(a[0], b[0], kk), lerp(a[1], b[1], kk), lerp(a[2], b[2], kk) + Math.sin(kk * Math.PI) * 4);
      const q = pos(k), q2 = pos(Math.min(1, k + 0.01));
      const ang = Math.atan2(q2[1] - q[1], q2[0] - q[0]);
      ctx.save();
      ctx.globalAlpha = Math.min(1, Math.sin(k * Math.PI) * 3);
      ctx.strokeStyle = 'rgba(255,253,245,0.5)'; ctx.setLineDash([2, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); for (let s = Math.max(0, k - 0.18); s <= k; s += 0.01) { const r = pos(s); s === Math.max(0, k - 0.18) ? ctx.moveTo(...r) : ctx.lineTo(...r); } ctx.stroke(); ctx.setLineDash([]);
      ctx.translate(q[0], q[1]); ctx.rotate(ang);
      const u = cam.s * 0.5;
      ctx.shadowColor = 'rgba(40,20,0,0.3)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = u * 0.8;
      ctx.fillStyle = '#fffaf0'; ctx.beginPath(); ctx.moveTo(u * 0.8, 0); ctx.lineTo(-u * 0.6, -u * 0.45); ctx.lineTo(-u * 0.3, 0); ctx.lineTo(-u * 0.6, u * 0.45); ctx.closePath(); ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = '#e8dcc4'; ctx.beginPath(); ctx.moveTo(u * 0.8, 0); ctx.lineTo(-u * 0.3, 0); ctx.lineTo(-u * 0.6, u * 0.45); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
  function sea(ctx, cam, t, snow, L) {
    const p = cam.p.bind(cam);
    flat(ctx, cam, 26.1, BOOK.y0 + 0.2, BOOK.x1 - 0.2, BOOK.y1 - 0.2, 0.02, C.sea3);
    const strips = [26.6, 27.5, 28.4, 29.3, 30.2, 31.1];
    const lanes = [{ y: 2.6, id: 'world' }, { y: 7.2, id: 'crew' }, { y: 15.4, id: 'docs' }];
    const boatX = (i) => 27.9 + Math.sin(t * 0.25 + i * 2) * 0.3 + (i === 1 ? 0.9 : 0);
    strips.forEach((sx, i) => {
      // pier segments in this band
      for (const ln of lanes) {
        const a = i ? strips[i - 1] : 26.1;
        if (a < 29.8) box(ctx, cam, a, ln.y - 0.35, Math.min(sx, 29.8), ln.y + 0.35, 0.05, 0.55, '#a8774c', { top: snow ? '#fff' : '#c79a6b' });
      }
      // boats sitting in this band
      lanes.forEach((ln, j) => {
        const bx = boatX(j);
        if (bx > (i ? strips[i - 1] : 26) && bx <= sx) boat(ctx, cam, bx, ln.y + 1.1, t, PROJ[ln.id], ln.id, j, L);
      });
      // the wave strip itself: a card with a scalloped top
      ctx.save();
      cam.face(ctx, [sx, BOOK.y1 - 0.3, 0], [0, -1, 0], [0, 0, 1]);
      const Lh = BOOK.y1 - BOOK.y0 - 0.6;
      ctx.beginPath(); ctx.moveTo(0, 0);
      for (let u = 0; u <= Lh; u += 0.2) ctx.lineTo(u, 0.42 + Math.sin(u * 1.6 + t * 1.3 + i * 1.7) * 0.12 + Math.sin(u * 0.5 - t * 0.6) * 0.06);
      ctx.lineTo(Lh, 0); ctx.closePath();
      ctx.fillStyle = [C.sea, C.sea2, C.sea, C.sea2, C.sea, C.sea2][i]; ctx.fill();
      ctx.strokeStyle = C.foam; ctx.lineWidth = 0.05; ctx.stroke();
      ctx.restore();
    });
    // lane buoys and project flags at the quay
    lanes.forEach((ln, j) => {
      const q = p(26.2, ln.y - 0.9, 0.35);
      ctx.strokeStyle = '#8a5a35'; ctx.lineWidth = Math.max(1, cam.s * 0.06);
      const top = p(26.2, ln.y - 0.9, 2.3);
      ctx.beginPath(); ctx.moveTo(...q); ctx.lineTo(...top); ctx.stroke();
      ctx.fillStyle = PROJ[ln.id]; ctx.beginPath(); ctx.moveTo(...top); ctx.lineTo(top[0] + cam.s * 1.1, top[1] + cam.s * 0.3 + Math.sin(t * 3 + j) * 2); ctx.lineTo(top[0], top[1] + cam.s * 0.6); ctx.fill();
      ctx.fillStyle = C.ink; ctx.font = `700 ${cam.s * 0.3}px Fraunces, Georgia, serif`; ctx.fillText(ln.id, top[0] + cam.s * 0.1, top[1] + cam.s * 0.38);
    });
  }
  function boat(ctx, cam, x, y, t, col, id, j, L) {
    // an origami boat with a sail in the project's colour
    const bob = Math.sin(t * 1.5 + j * 2) * 0.08;
    const q = cam.p(x, y, 0.32 + bob), u = cam.s;
    ctx.save(); ctx.translate(q[0], q[1]); ctx.rotate(Math.sin(t * 1.2 + j) * 0.05);
    ctx.shadowColor = 'rgba(20,40,60,0.35)'; ctx.shadowBlur = 4; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
    ctx.fillStyle = '#fffaf0';
    ctx.beginPath(); ctx.moveTo(-u * 1.3, -u * 0.5); ctx.lineTo(u * 1.3, -u * 0.5); ctx.lineTo(u * 0.8, u * 0.15); ctx.lineTo(-u * 0.8, u * 0.15); ctx.closePath(); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#e9dfca'; ctx.beginPath(); ctx.moveTo(-u * 1.3, -u * 0.5); ctx.lineTo(0, -u * 0.5); ctx.lineTo(-u * 0.8, u * 0.15); ctx.closePath(); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, -u * 0.5); ctx.lineTo(0, -u * 2.4); ctx.lineTo(u * 1.0, -u * 0.6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(col, -0.2); ctx.beginPath(); ctx.moveTo(0, -u * 0.5); ctx.lineTo(0, -u * 2.0); ctx.lineTo(-u * 0.7, -u * 0.6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.ink; ctx.font = `700 ${u * 0.32}px Fraunces, Georgia, serif`; ctx.textAlign = 'center'; ctx.fillText(id === 'crew' ? 'v0.4' : id === 'world' ? 'v2.1' : 'v1.0', 0, -u * 0.1);
    ctx.restore();
    const lp = [q[0] + u * 0.05, q[1] - u * 2.4];
    L.push((c, n) => { const g = c.createRadialGradient(lp[0], lp[1], 0, lp[0], lp[1], u * 0.7); g.addColorStop(0, `rgba(255,120,90,${n})`); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(lp[0] - u, lp[1] - u, u * 2, u * 2); });
  }
  function clouds(ctx, w, h, t, weather, night) {
    // paper clouds hanging on threads from the top of the frame
    const n = weather === 'clear' ? 2 : 5;
    const col = weather === 'clear' ? '#fffaf0' : night ? '#8792b0' : '#d2d6dc';
    for (let i = 0; i < n; i++) {
      const bx = ((i * 0.21 + (i % 2 ? 0.62 : 0.06) + Math.sin(t * 0.05 + i) * 0.02) % 1) * w, by = h * (0.05 + (i % 3) * 0.035) + Math.sin(t * 0.7 + i) * 4;
      const s = Math.min(w, h) * (0.035 + (i % 2) * 0.012);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(bx, 0); ctx.lineTo(bx, by - s * 0.6); ctx.stroke();
      ctx.save(); ctx.translate(bx, by); ctx.rotate(Math.sin(t * 0.6 + i) * 0.04);
      ctx.shadowColor = 'rgba(30,15,0,0.35)'; ctx.shadowBlur = s * 0.3; ctx.shadowOffsetX = s * 0.15; ctx.shadowOffsetY = s * 0.25;
      ctx.fillStyle = col;
      ctx.beginPath();
      for (const [dx, dy, r] of [[-1, 0.2, 0.55], [-0.35, -0.2, 0.75], [0.4, -0.05, 0.65], [1.0, 0.25, 0.45]]) { ctx.moveTo(dx * s + r * s, dy * s); ctx.arc(dx * s, dy * s, r * s, 0, TAU); }
      ctx.rect(-1.0 * s, 0.1 * s, 2.0 * s, 0.55 * s);
      ctx.fill();
      ctx.restore();
    }
  }
  function rain(ctx, cam, w, h, t) {
    // blue threads with paper droplets, splashes on the page
    const r = rng(9);
    ctx.save();
    for (let i = 0; i < 160; i++) {
      const x = r() * w * 1.1, sp = 0.6 + r() * 0.4, len = 14 + r() * 18;
      const y = ((r() * h + t * h * sp * 0.9) % (h + 60)) - 30;
      ctx.strokeStyle = 'rgba(170,205,235,0.55)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x - y * 0.12, y); ctx.lineTo(x - (y + len) * 0.12, y + len); ctx.stroke();
      ctx.fillStyle = 'rgba(200,228,250,0.85)'; ctx.beginPath(); ctx.arc(x - (y + len) * 0.12, y + len, 1.6, 0, TAU); ctx.fill();
    }
    for (let i = 0; i < 40; i++) {
      const k = (t * 0.9 + r()) % 1, q = cam.p(r() * 25, r() * 21, 0.1);
      ctx.strokeStyle = `rgba(220,240,255,${0.6 * (1 - k)})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(q[0], q[1], cam.s * 0.5 * k, cam.s * 0.25 * k, 0, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }
  function snowfall(ctx, w, h, t) {
    // hole-punch confetti drifting down
    const r = rng(5);
    for (let i = 0; i < 140; i++) {
      const x = (r() * w + Math.sin(t * 0.8 + i) * 18 + w) % w, sp = 0.15 + r() * 0.2;
      const y = ((r() * h + t * h * sp) % (h + 20)) - 10, rad = 2 + r() * 3;
      ctx.fillStyle = 'rgba(40,30,30,0.25)'; ctx.beginPath(); ctx.arc(x + 1.5, y + 1.5, rad, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fffdf8'; ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill();
    }
  }
}
