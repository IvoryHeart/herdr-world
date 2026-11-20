// Pop-Up in real 3D: the papercraft town as a three.js scene you can orbit.
// Layout and cast match the Pop-Up stills (old iso x → X, y → Z, z → Y).
// Agents and labels are paper cards on stands that turn to face the camera,
// so they read at every angle. Tall walls between the camera and a room fold
// away (fade), so rooms stay open toward you whichever way you turn.
// Themes: Papercraft day, Papercraft night, and Lumen, a glass-and-light skin
// over the same geometry.
import * as THREE from '../vendor/three.module.js';
import { createPaper } from '../paper/paper.js';
import { createLumen } from '../lumen/lumen.js';
import { TownControls } from './controls.js';

const paper2d = createPaper(), lumen2d = createLumen();
const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => t * t * (3 - 2 * t);
const HC = { claude: '#e07a5f', codex: '#4361a8', gemini: '#8a6fdf', rex: '#5fa86a' };
const LC = { claude: '#ff8a5c', codex: '#5ab0ff', gemini: '#b98cff', rex: '#5ff0a6' };
const PROJ = { world: '#f2c14e', crew: '#ef8354', docs: '#4fa3a3', lab: '#a66e93', site: '#7bb07f', api: '#8fa3b8', ops: '#e9b949' };
const FONT = '"Fraunces", Georgia, serif';
const SANS = '"Space Grotesk", Inter, sans-serif';
const BOOK = { x0: -0.8, y0: -0.8, x1: 31.6, y1: 21.8 };

const AG = (n, h, s) => ({ n, h, s });
const A = {
  scout: AG('scout', 'claude', 'working'), wren: AG('wren', 'codex', 'working'), juniper: AG('juniper', 'claude', 'thinking'),
  otter: AG('otter', 'gemini', 'working'), pixel: AG('pixel', 'codex', 'thinking'), maple: AG('maple', 'claude', 'needs'),
  sable: AG('sable', 'codex', 'needs'), kite: AG('kite', 'rex', 'working'), moss: AG('moss', 'claude', 'idle'), ember: AG('ember', 'codex', 'idle'),
  fig: AG('fig', 'gemini', 'walking'), quill: AG('quill', 'claude', 'walking'), tansy: AG('tansy', 'codex', 'asleep'),
  bram: AG('bram', 'claude', 'asleep'), olive: AG('olive', 'gemini', 'asleep'), lark: AG('lark', 'rex', 'done'), hazel: AG('hazel', 'codex', 'working'),
};

const THEMES = {
  day: {
    css: 'radial-gradient(120% 90% at 30% 10%, #7a5639 0%, #3a271c 70%)', fog: 0x3a271c, hemi: [0xfff3df, 0x8a6a50, 0.62], sun: [0xfff0d6, 0.8], spot: 0,
    edge: [0xfffaf0, 0.6], tint: 0xffffff, glow: 0, emis: 0, roomLight: 0, desk: true, lumen: false, grain: 0.42,
  },
  night: {
    css: 'radial-gradient(120% 90% at 30% 10%, #2a2f55 0%, #0d0f1f 70%)', fog: 0x0d0f1f, hemi: [0x7080c0, 0x241a30, 0.42], sun: [0x9fb0ff, 0.38], spot: 1.15,
    edge: [0xfffaf0, 0.28], tint: 0x9aa3cf, glow: 1, emis: 1, roomLight: 1.25, desk: true, lumen: false, grain: 0.32,
  },
  lumen: {
    css: 'radial-gradient(120% 90% at 70% 0%, #141b45 0%, #04050d 65%)', fog: 0x04050d, hemi: [0x5070c0, 0x05070f, 0.38], sun: [0x8fb8ff, 0.22], spot: 0,
    edge: [0x8fe9ff, 0.85], tint: 0xffffff, glow: 1.25, emis: 1, roomLight: 1.4, desk: false, lumen: true, grain: 0.06,
  },
};

export function createTown3D(host, ui = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 700 ? 1.6 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x3a271c, 70, 150);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 400);

  // ---------- shared textures ----------
  const texCanvas = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t; };
  const grain = texCanvas(128, 128, (g) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 700; i++) { const v = 236 + Math.random() * 19; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random(), 1 + Math.random()); }
  });
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  const glowTex = texCanvas(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.3, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });

  // ---------- material registry: every material restyles itself per theme ----------
  const recs = [];
  const cache = new Map();
  function mat(color, role = 'paper', o = {}) {
    const key = `${color}|${role}`;
    if (!o.own && !o.map && cache.has(key)) return cache.get(key).mat;
    const m = new THREE.MeshLambertMaterial({ color, map: o.map || grain, side: o.side || THREE.FrontSide });
    if (o.emissiveMap) m.emissiveMap = o.emissiveMap;
    const rec = { mat: m, color, role, fade: 1, base: 1 };
    m.userData.rec = rec;
    recs.push(rec);
    if (!o.own && !o.map) cache.set(key, rec);
    return m;
  }
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xfffaf0, transparent: true, opacity: 0.6 });

  let crane, hook, pullTab, sunBoard;
  const root = new THREE.Group();
  scene.add(root);
  const P = (x, y, z = 0) => new THREE.Vector3(x, z, y); // old (x, y, height) → three

  function addMesh(geo, m, pos, o = {}) {
    const mesh = new THREE.Mesh(geo, m);
    if (pos) mesh.position.copy(pos);
    mesh.castShadow = o.cast !== false; mesh.receiveShadow = true;
    if (o.edges !== false) { const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeMat); mesh.add(e); }
    (o.parent || root).add(mesh);
    return mesh;
  }
  // box in old coordinates: x0..x1 across, y0..y1 deep, z0..z1 up
  function box(x0, y0, x1, y1, z0, z1, color, role, o = {}) {
    const geo = new THREE.BoxGeometry(Math.max(0.001, x1 - x0), Math.max(0.001, z1 - z0), Math.max(0.001, y1 - y0));
    const m = o.mats || mat(color, role, o);
    return addMesh(geo, m, P((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), o);
  }

  // ---------- billboards: paper cards that turn to face you ----------
  const boards = [];
  function board(cw, ch, ww, foot, draw, o = {}) {
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4;
    const wh = (ww * ch) / cw;
    const geo = new THREE.PlaneGeometry(ww, wh); geo.translate(0, (foot / ch) * wh - wh / 2, 0);
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, depthWrite: true });
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = o.cast !== false;
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.3 });
    if (o.pos) mesh.position.copy(o.pos);
    (o.parent || root).add(mesh);
    const b = { mesh, c, g: c.getContext('2d'), tex, draw, fps: o.fps || 0, last: -1, lod: o.lod || 0, phase: Math.random(), static: !o.fps };
    boards.push(b);
    return b;
  }
  function redraw(b, t) { b.g.clearRect(0, 0, b.c.width, b.c.height); b.draw(b.g, b.c.width, b.c.height, t); b.tex.needsUpdate = true; b.last = t; }

  // an agent: the paper sticker figure, or a wisp of light in Lumen
  function agent(a, x, y, z, o = {}) {
    const st = o.state || a.s;
    const b = board(200, 280, 2.0, 250, (g, w, h, t) => {
      if (theme.lumen) {
        lumen2d.drawWisp(g, 100, 250, 52, a, t, { state: st, beam: 70, noZ: false }, null);
      } else {
        paper2d.drawFigure(g, 100, 250, 55, a, t, { state: st, noStand: o.noStand, noZ: false });
      }
    }, { pos: P(x, y, z), fps: 12 });
    b.agent = a; b.state = st; b.baseScale = o.scale || 1.15;
    if (st === 'needs') beams.push({ b, x, y, z });
    return b;
  }
  // a paper tag on a pin carrying a label
  const tags = [];
  function tag(text, x, y, z, o = {}) {
    const size = o.size || 1, col = o.color || '#c8553d';
    const mk = (g, w, h) => {
      g.font = `800 ${46 * 1}px ${theme.lumen ? SANS : FONT}`;
      const tw = Math.min(w - 40, g.measureText(text).width);
      const bw = tw + 46, bh = 66, bx = (w - bw) / 2, by = 8;
      if (theme.lumen) {
        g.fillStyle = 'rgba(6,12,30,0.78)'; round(g, bx, by, bw, bh, 33); g.fill();
        g.strokeStyle = o.lcol || '#8fe9ff'; g.lineWidth = 3; g.stroke();
        g.fillStyle = o.lcol || '#d9f6ff';
      } else {
        g.save(); g.shadowColor = 'rgba(60,30,10,0.45)'; g.shadowBlur = 8; g.shadowOffsetX = 3; g.shadowOffsetY = 3;
        g.fillStyle = '#fffaf0'; round(g, bx - 6, by - 6, bw + 12, bh + 12, 14); g.fill(); g.restore();
        g.fillStyle = col; round(g, bx, by, bw, bh, 10); g.fill();
        g.fillStyle = '#fffaf0';
      }
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, by + bh / 2 + 3, w - 40);
      // the pin
      g.strokeStyle = theme.lumen ? 'rgba(143,233,255,0.6)' : '#7a5636'; g.lineWidth = 6; g.beginPath(); g.moveTo(w / 2, by + bh + 6); g.lineTo(w / 2, h); g.stroke();
    };
    const cw = Math.max(200, Math.ceil(text.length * 30 + 80));
    const b = board(cw, 150, (cw / 150) * 0.95 * size, 150, mk, { pos: P(x, y, z), cast: false, lod: o.lod || 0 });
    b.isTag = true; tags.push(b);
    return b;
  }
  function round(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  // glows: additive sprites that only show after dark or in Lumen
  const glows = [];
  function glow(x, y, z, s, color, o = {}) {
    const m = new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 });
    const sp = new THREE.Sprite(m); sp.position.copy(P(x, y, z)); sp.scale.set(s, s, s); root.add(sp);
    glows.push({ sp, a: o.a ?? 0.8, lumenOnly: o.lumenOnly, paperOnly: o.paperOnly, lumenColor: o.lumenColor });
    return sp;
  }
  const roomLights = [];
  function roomLight(x, y, z, color, lcolor) {
    const l = new THREE.PointLight(color, 0, 5.5, 1.6); l.position.copy(P(x, y, z)); root.add(l);
    roomLights.push({ l, color: new THREE.Color(color), lcolor: new THREE.Color(lcolor || color) });
  }
  // tall walls fold away when they stand between you and a room
  const faders = [];
  function fader(obj, nx, ny, cx, cy) {
    const ms = [];
    obj.traverse((o) => { if (!o.isMesh || !o.material) return; for (const m of [].concat(o.material)) if (m.userData && m.userData.rec && !ms.includes(m.userData.rec)) ms.push(m.userData.rec); });
    faders.push({ ms, nx, ny, cx, cy, f: 1 });
  }

  // ---------- facade textures ----------
  function facadeTex(cols, rows, seed, o = {}) {
    const W = 512, H = Math.round((512 * (o.h || 1)) / (o.w || 1));
    const mk = (emis) => texCanvas(W, H, (g) => {
      g.fillStyle = emis ? '#000' : o.wall || '#ece0c8'; g.fillRect(0, 0, W, H);
      if (!emis) { g.globalAlpha = 0.12; g.drawImage(grain.image, 0, 0, W, H); g.globalAlpha = 1; }
      const mx = W * 0.08, my = H * (o.top || 0.1), cw = (W - mx * 2) / cols, rh = (H * (o.bottom || 0.55) - my) / rows;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const lit = ((c * 7 + r * 3 + seed) % 5) < 2;
        const x = mx + c * cw + cw * 0.18, y = my + r * rh + rh * 0.18, w = cw * 0.64, h = rh * 0.64;
        if (emis) { if (lit) { g.fillStyle = '#ffc070'; g.fillRect(x, y, w, h); } continue; }
        g.fillStyle = 'rgba(70,40,20,0.25)'; g.fillRect(x + 4, y + 4, w, h);
        g.fillStyle = lit ? '#ffd98a' : '#9fb3c8'; g.fillRect(x, y, w, h);
        g.strokeStyle = '#fffaf0'; g.lineWidth = 4; g.strokeRect(x, y, w, h);
      }
      if (o.sign && !emis) {
        g.font = `800 ${o.signSize || 70}px ${FONT}`; const tw = g.measureText(o.sign).width;
        const sy = H * (o.signY || 0.82);
        g.fillStyle = o.signBg || '#c8553d'; g.fillRect(W / 2 - tw / 2 - 24, sy - 56, tw + 48, 84);
        g.fillStyle = '#fffaf0'; g.textAlign = 'center'; g.fillText(o.sign, W / 2, sy + 6);
      }
    });
    return { map: mk(false), emis: mk(true) };
  }
  function stripes(color, lit) {
    return texCanvas(256, 128, (g) => {
      const base = lit ? color : '#8892a8';
      g.fillStyle = base; g.fillRect(0, 0, 256, 128);
      g.fillStyle = 'rgba(255,255,255,0.22)'; for (let x = 8; x < 256; x += 28) g.fillRect(x, 0, 10, 128);
      g.globalAlpha = 0.1; g.drawImage(grain.image, 0, 0, 256, 128); g.globalAlpha = 1;
    });
  }

  // ---------- the book and the desk ----------
  const desk = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshLambertMaterial({ map: (() => {
    const t = texCanvas(512, 512, (g) => {
      g.fillStyle = '#5a3d2b'; g.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 90; i++) { g.strokeStyle = `rgba(${30 + Math.random() * 40},${15 + Math.random() * 20},5,0.35)`; g.lineWidth = 1 + Math.random() * 2; g.beginPath(); const y = Math.random() * 512; g.moveTo(0, y); for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 6); g.stroke(); }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 10); return t;
  })() }));
  desk.rotation.x = -Math.PI / 2; desk.position.y = -0.92; desk.receiveShadow = true; scene.add(desk);
  const mirror = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshLambertMaterial({ color: 0x03050c, emissive: 0x02040a, map: (() => {
    const t = texCanvas(256, 256, (g) => { g.fillStyle = '#05070f'; g.fillRect(0, 0, 256, 256); g.strokeStyle = 'rgba(110,200,255,0.18)'; g.lineWidth = 1; for (let i = 0; i <= 256; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); } });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(30, 30); return t;
  })() }));
  mirror.rotation.x = -Math.PI / 2; mirror.position.y = -0.93; mirror.receiveShadow = true; mirror.visible = false; scene.add(mirror);

  const pageSide = texCanvas(512, 32, (g) => { g.fillStyle = '#e9dcc0'; g.fillRect(0, 0, 512, 32); g.strokeStyle = 'rgba(120,95,60,0.4)'; for (let y = 4; y < 32; y += 5) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); } });
  box(BOOK.x0 - 0.5, BOOK.y0 - 0.5, BOOK.x1 + 0.5, BOOK.y1 + 0.5, -0.92, -0.76, '#7a2f2a', 'cover', { edges: false });
  {
    const side = mat('#efe3c9', 'pageside', { map: pageSide, own: true }), top = mat('#f4ecdb', 'page');
    box(BOOK.x0, BOOK.y0, BOOK.x1, BOOK.y1, -0.76, 0, null, null, { mats: [side, side, top, side, side, side], edges: false });
  }
  // spine crease and ribbon bookmark
  {
    const t = texCanvas(64, 4, (g) => { const r = g.createLinearGradient(0, 0, 64, 0); r.addColorStop(0, 'rgba(110,80,40,0)'); r.addColorStop(0.5, 'rgba(110,80,40,0.35)'); r.addColorStop(1, 'rgba(110,80,40,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 4); });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3, BOOK.y1 - BOOK.y0), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.copy(P(15.4, (BOOK.y0 + BOOK.y1) / 2, 0.012)); root.add(m);
    box(22, 20.6, 22.7, BOOK.y1 + 0.02, 0.005, 0.03, '#b8323a', 'ribbon', { edges: false });
    box(22, BOOK.y1, 22.7, BOOK.y1 + 0.03, -2.6, 0.03, '#b8323a', 'ribbon', { edges: false });
  }

  // ---------- ground: a deckled meadow sheet, roads, plaza, quay ----------
  {
    const s = new THREE.Shape(); const r = mulberry(3);
    const pts = []; const edge = (ax, ay, bx, by, n) => { for (let i = 0; i < n; i++) { const k = i / n; pts.push([lerp(ax, bx, k) + (r() - 0.5) * 0.18, lerp(ay, by, k) + (r() - 0.5) * 0.18]); } };
    edge(-0.4, -0.4, 25.2, -0.4, 60); edge(25.2, -0.4, 25.2, 21.4, 40); edge(25.2, 21.4, -0.4, 21.4, 60); edge(-0.4, 21.4, -0.4, -0.4, 40);
    pts.forEach(([x, y], i) => (i ? s.lineTo(x, -y) : s.moveTo(x, -y)));
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: false });
    const m = new THREE.Mesh(geo, mat('#a8c98a', 'ground')); m.rotation.x = -Math.PI / 2; m.receiveShadow = true; root.add(m);
    const r2 = mulberry(11);
    for (let i = 0; i < 26; i++) {
      const x = r2() * 24, y = r2() * 21, rad = 0.6 + r2() * 1.4;
      if ((y > 9.2 && y < 12.4) || (x > 6.5 && x < 9.5) || (x > 14.9 && x < 17.9)) continue;
      const c = new THREE.Mesh(new THREE.CircleGeometry(rad, 12), mat(i % 2 ? '#c5dba0' : '#93b877', 'ground'));
      c.rotation.x = -Math.PI / 2; c.position.copy(P(x, y, 0.056)); c.receiveShadow = true; root.add(c);
    }
  }
  const stitch = texCanvas(512, 64, (g) => { g.fillStyle = '#d8c7a6'; g.fillRect(0, 0, 512, 64); g.globalAlpha = 0.15; g.drawImage(grain.image, 0, 0, 512, 64); g.globalAlpha = 1; g.strokeStyle = '#fffaf0'; g.lineWidth = 5; g.setLineDash([22, 16]); g.beginPath(); g.moveTo(0, 32); g.lineTo(512, 32); g.stroke(); });
  stitch.wrapS = THREE.RepeatWrapping;
  const stitchV = stitch.clone(); stitchV.needsUpdate = true;
  {
    const t1 = stitch.clone(); t1.needsUpdate = true; t1.repeat.set(6, 1);
    box(-0.6, 10, 24.6, 11.6, 0.05, 0.1, '#d8c7a6', 'road', { map: t1, own: true, edges: false });
    for (const x of [7.3, 15.7]) {
      const t2 = stitch.clone(); t2.needsUpdate = true; t2.repeat.set(5, 1); t2.center.set(0.5, 0.5); t2.rotation = Math.PI / 2;
      box(x, -0.6, x + 1.4, 21.6, 0.05, 0.1, '#d8c7a6', 'road', { map: t2, own: true, edges: false });
    }
    box(-0.5, 11.15, 24.5, 11.25, 0.1, 0.104, '#3b2f2a', 'slot', { edges: false, cast: false });
    const doily = texCanvas(256, 256, (g) => { g.translate(128, 128); g.fillStyle = '#fbf5e8'; g.beginPath(); for (let i = 0; i < 48; i++) { const a = (i / 48) * TAU, rr = 124 * (i % 2 ? 0.95 : 1); g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.fill(); g.strokeStyle = 'rgba(200,180,150,0.7)'; g.lineWidth = 3; for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; g.beginPath(); g.arc(Math.cos(a) * 88, Math.sin(a) * 88, 12, 0, TAU); g.stroke(); } });
    const d = new THREE.Mesh(new THREE.CircleGeometry(2.1, 48), new THREE.MeshLambertMaterial({ map: doily, transparent: true, alphaTest: 0.2 }));
    d.rotation.x = -Math.PI / 2; d.position.copy(P(12.2, 8.6, 0.06)); d.receiveShadow = true; root.add(d);
    box(24.4, -0.6, 26.1, 21.6, 0, 0.32, '#d9c8a8', 'quay');
  }

  // ---------- rooms ----------
  function desk3(x, y, z, on, col) {
    box(x - 0.42, y - 0.2, x + 0.42, y + 0.2, z, z + 0.3, '#d7a46a', 'paper');
    box(x - 0.17, y - 0.1, x + 0.17, y + 0.1, z + 0.3, z + 0.33, '#b7c0cc', 'paper', { edges: false });
    const scr = box(x - 0.17, y - 0.12, x + 0.17, y - 0.09, z + 0.33, z + 0.56, on ? '#9fd8ff' : '#2d3550', on ? 'screen' : 'paper', { edges: false });
    scr.rotation.x = -0.18;
    if (on) glow(x, y, z + 0.6, 1.1, 0x8fd3ff, { a: 0.55 });
  }
  function tray(x0, y0, x1, y1, z0, col, lit, name, fill) {
    const g = new THREE.Group(); root.add(g);
    const wallMat = mat(lit ? col : '#8f98ad', 'paper', { map: stripes(col, lit), own: true });
    const floorCol = lit ? '#f7e7c4' : '#c9ccd4';
    box(x0, y0, x1, y1, z0, z0 + 0.06, floorCol, lit ? 'lit' : 'paper');
    const H = 1.05, F = 0.28, T = 0.07;
    // tall walls at the back and left (they fold away when you look from behind)
    const back = new THREE.Group(); root.add(back);
    box(x0, y0, x1, y0 + T, z0, z0 + H, null, null, { mats: wallMat, parent: back, edges: true });
    const left = new THREE.Group(); root.add(left);
    box(x0, y0, x0 + T, y1, z0, z0 + H, null, null, { mats: mat(lit ? col : '#8f98ad', 'paper', { map: stripes(col, lit), own: true }), parent: left });
    fader(back, 0, -1, (x0 + x1) / 2, y0); fader(left, -1, 0, x0, (y0 + y1) / 2);
    // low walls at the front and right
    box(x0, y1 - T, x1, y1, z0, z0 + F, lit ? col : '#9aa3b8', 'paper');
    box(x1 - T, y0, x1, y1, z0, z0 + F, lit ? col : '#9aa3b8', 'paper');
    if (lit) {
      // a paper lamp hanging over the room
      const lx = (x0 + x1) / 2, ly = (y0 + y1) / 2, lz = z0 + H + 0.95;
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 10), mat('#fff1c9', 'lamp'));
      lamp.scale.y = 0.85; lamp.position.copy(P(lx, ly, lz)); lamp.castShadow = false; root.add(lamp);
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.2, 4), mat('#3b2f2a', 'paper')); cord.position.copy(P(lx, ly, lz + 0.8)); root.add(cord);
      glow(lx, ly, lz, 2.2, 0xffc878, { a: 0.9 });
      roomLight(lx, ly, z0 + 1.2, 0xffbf73, col);
    }
    tag(name, x0 + 0.5, y0 + 0.4, z0 + H + 0.05, { size: 0.55, color: lit ? '#3b2f2a' : '#6c7590', lod: 1, lcol: lit ? col : '#8a9bc0' });
    fill && fill();
    return g;
  }
  function office(b) {
    const { x0, y0, name } = b, X1 = x0 + 6.4;
    const fac = facadeTex(9, 4, name.length, { wall: '#ece0c8', top: 0.08, bottom: 0.62, sign: name, signY: 0.86, w: 6.4, h: 5.6 });
    const fg = new THREE.Group(); root.add(fg);
    const fm = mat('#ffffff', 'window', { map: fac.map, emissiveMap: fac.emis, own: true });
    const side = mat('#e6d8bc', 'paper', { own: true });
    box(x0, y0, X1, y0 + 0.7, 0, 5.6, null, null, { mats: [side, side, mat('#f7efdf', 'roof', { own: true }), side, fm, fm], parent: fg });
    box(x0 + 1.6, y0 + 0.05, X1 - 1.6, y0 + 0.65, 5.6, 6.5, '#ece0c8', 'paper', { own: true, parent: fg });
    fader(fg, 0, -1, (x0 + X1) / 2, y0 + 0.35);
    // flag on the roof
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), mat('#8a5a35', 'paper')); pole.position.copy(P(x0 + 3.2, y0 + 0.35, 7.3)); root.add(pole);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.55, 8, 1), mat('#ef8354', 'paper', { side: THREE.DoubleSide, own: true }));
    fl.geometry.translate(0.5, 0, 0); fl.position.copy(P(x0 + 3.2, y0 + 0.35, 7.8)); fl.castShadow = true; root.add(fl);
    flags.push(fl);
    tag(name, x0 + 3.2, y0 + 1.2, 6.9, { size: 1.25, color: '#c8553d' });
    // plinth for the back row of rooms
    box(x0, y0 + 0.8, X1, y0 + 3.8, 0, 1.15, '#d9c3a0', 'paper');
    const slots = [[x0 + 0.1, y0 + 0.9, x0 + 3.1, y0 + 3.7, 1.15], [x0 + 3.3, y0 + 0.9, X1 - 0.1, y0 + 3.7, 1.15], [x0 + 0.1, y0 + 4.1, x0 + 3.1, y0 + 7.1, 0], [x0 + 3.3, y0 + 4.1, X1 - 0.1, y0 + 7.1, 0]];
    b.rooms.forEach((rm, i) => {
      const [a0, b0, a1, b1, z] = slots[i];
      tray(a0, b0, a1, b1, z + (z ? 0 : 0.0), PROJ[rm.id], rm.lit, rm.id, () => {
        [[a0 + 0.85, b0 + 1.1], [a0 + 2.2, b0 + 1.1], [a0 + 0.85, b0 + 2.3], [a0 + 2.2, b0 + 2.3]].forEach(([sx, sy], k) => {
          const who = rm.people[k];
          desk3(sx, sy, z + 0.06, !!who && rm.lit, PROJ[rm.id]);
          if (who) agent(who, sx, sy - 0.42, z + 0.06);
        });
      });
    });
    // reception: counter, bell, queue
    const rx = x0 + 1.4, ry = y0 + 7.6;
    box(rx, ry, rx + 3.4, ry + 0.7, 0, 0.75, '#5e7fa3', 'paper');
    box(rx - 0.05, ry - 0.05, rx + 3.45, ry + 0.75, 0.75, 0.82, '#e9e2d0', 'paper');
    tag('RECEPTION', rx + 1.7, ry + 0.35, 0.95, { size: 0.6, color: '#5e7fa3', lod: 1 });
    b.queue.forEach((a, k) => agent(a, rx + 0.6 + k * 1.05, ry + 1.3 + (k % 2) * 0.12, 0.1));
  }

  // ---------- buildings ----------
  function townHall() {
    const x0 = 9.4, y0 = 1.0, x1 = 15.0, y1 = 5.4;
    box(x0, y0, x1, y1, 0, 3.4, '#f0dfc0', 'paper');
    box(x0 + 2.0, y0 + 0.9, x0 + 3.6, y0 + 2.5, 3.4, 6.6, '#e9d4ae', 'paper');
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.25, 1.4, 4), mat('#c8553d', 'roof')); roof.rotation.y = Math.PI / 4; roof.position.copy(P(x0 + 2.8, y0 + 1.7, 7.3)); roof.castShadow = true; root.add(roof);
    roof.add(new THREE.LineSegments(new THREE.EdgesGeometry(roof.geometry), edgeMat));
    // clock faces on all four sides
    const clockTex = texCanvas(128, 128, (g) => { g.fillStyle = '#fffaf0'; g.beginPath(); g.arc(64, 64, 60, 0, TAU); g.fill(); g.strokeStyle = '#3b2f2a'; g.lineWidth = 4; g.stroke(); for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; g.beginPath(); g.moveTo(64 + Math.cos(a) * 48, 64 + Math.sin(a) * 48); g.lineTo(64 + Math.cos(a) * 56, 64 + Math.sin(a) * 56); g.stroke(); } });
    for (const [dx, dy, ry] of [[0, 0.81, 0], [0.81, 0, Math.PI / 2], [0, -0.81, Math.PI], [-0.81, 0, -Math.PI / 2]]) {
      const c = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), new THREE.MeshLambertMaterial({ map: clockTex }));
      c.position.copy(P(x0 + 2.8 + dx, y0 + 1.7 + dy, 5.6)); c.rotation.y = ry; root.add(c);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.02), mat('#3b2f2a', 'paper')); hand.geometry.translate(0, 0.2, 0); hand.position.set(0, 0, 0.02); c.add(hand); clockHands.push(hand);
    }
    // portico
    box(x0 + 0.6, y1, x1 - 0.6, y1 + 1.2, 0, 0.3, '#e6d6b8', 'paper');
    for (let i = 0; i < 6; i++) { const col = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 2.6, 12), mat('#fffaf0', 'paper')); col.position.copy(P(x0 + 1.14 + i * 0.86, y1 + 0.64, 1.6)); col.castShadow = true; col.receiveShadow = true; root.add(col); }
    box(x0 + 0.5, y1 + 0.2, x1 - 0.5, y1 + 1.0, 2.9, 3.3, '#f4e6c9', 'paper');
    const ped = new THREE.Shape(); ped.moveTo(x0 + 0.5, 0); ped.lineTo(x1 - 0.5, 0); ped.lineTo((x0 + x1) / 2, 1.3); ped.closePath();
    const pg = new THREE.ExtrudeGeometry(ped, { depth: 0.8, bevelEnabled: false });
    addMesh(pg, mat('#f8ecd5', 'paper'), P(0, y1 + 0.2, 3.3));
    // HIRE banner on the side
    const banner = texCanvas(128, 256, (g) => { g.fillStyle = '#2a9d8f'; g.beginPath(); g.moveTo(0, 0); g.lineTo(128, 0); g.lineTo(128, 256); g.lineTo(64, 220); g.lineTo(0, 256); g.fill(); g.fillStyle = '#fffaf0'; g.font = `800 40px ${FONT}`; g.textAlign = 'center'; 'HIRE'.split('').forEach((ch, i) => g.fillText(ch, 64, 52 + i * 46)); });
    const bn = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.4), new THREE.MeshLambertMaterial({ map: banner, transparent: true, alphaTest: 0.3 }));
    bn.position.copy(P(x1 + 0.02, y0 + 2.6, 2.0)); bn.rotation.y = Math.PI / 2; root.add(bn);
    tag('TOWN HALL', 12.2, 6.9, 4.9, { size: 1.0, color: '#2a9d8f' });
    // expenses easel, a card that turns to you
    board(256, 256, 2.2, 240, (g) => {
      g.strokeStyle = '#8a5a35'; g.lineWidth = 8; g.beginPath(); g.moveTo(40, 250); g.lineTo(70, 40); g.moveTo(216, 250); g.lineTo(186, 40); g.stroke();
      if (theme.lumen) { g.fillStyle = 'rgba(6,12,30,0.85)'; round(g, 20, 30, 216, 150, 14); g.fill(); g.strokeStyle = '#8fe9ff'; g.lineWidth = 3; g.stroke(); }
      else { g.fillStyle = '#fffaf0'; g.fillRect(20, 30, 216, 150); }
      g.fillStyle = theme.lumen ? '#d9f6ff' : '#3b2f2a'; g.font = `800 22px ${theme.lumen ? SANS : FONT}`; g.fillText('EXPENSES · $41', 34, 60);
      [0.4, 0.62, 0.5, 0.85, 0.7].forEach((v, i) => { g.fillStyle = i === 3 ? '#e07a5f' : theme.lumen ? '#7fe7ff' : '#4ea3a3'; g.fillRect(40 + i * 38, 170 - v * 95, 26, v * 95); });
    }, { pos: P(10.9, 7.5, 0.06) });
  }
  function bar() {
    const x0 = 0.8, y0 = 13, x1 = 4.8, y1 = 17.4;
    const bg = new THREE.Group(); root.add(bg);
    const signTex = texCanvas(512, 384, (g) => { g.fillStyle = '#7a4b6b'; g.fillRect(0, 0, 512, 384); g.globalAlpha = 0.12; g.drawImage(grain.image, 0, 0, 512, 384); g.globalAlpha = 1; g.fillStyle = '#ffe8a8'; g.font = `italic 800 92px ${FONT}`; g.textAlign = 'center'; g.fillText('The Lounge', 256, 160); });
    const sm = mat('#ffffff', 'paper', { map: signTex, own: true }), sd = mat('#6a3f5d', 'paper', { own: true });
    box(x0, y0, x1, y0 + 0.5, 0, 3.0, null, null, { mats: [sd, sd, mat('#946184', 'roof', { own: true }), sd, sm, sm], parent: bg });
    fader(bg, 0, -1, (x0 + x1) / 2, y0);
    // string lights
    for (let i = 0; i <= 10; i++) {
      const k = i / 10, x = lerp(x0, x1, k), z = 2.7 - Math.sin(k * Math.PI) * 0.35;
      const col = ['#ffd166', '#ef476f', '#06d6a0', '#ffd166'][i % 4];
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), mat(col, 'lamp')); b.position.copy(P(x, y0 + 0.62, z)); root.add(b);
      glow(x, y0 + 0.62, z, 0.9, new THREE.Color(col).getHex(), { a: 0.9 });
    }
    tag('The Lounge', 2.8, y0 + 1.2, 3.6, { size: 0.95, color: '#7a4b6b' });
    tray(x0, y0 + 0.6, x1, y1, 0, '#b07aa1', true, 'bar', () => {
      box(x0 + 0.3, y0 + 1.0, x1 - 0.3, y0 + 1.5, 0.06, 0.66, '#8a5a35', 'paper');
      box(x0 + 0.25, y0 + 0.95, x1 - 0.25, y0 + 1.55, 0.66, 0.72, '#c08a5b', 'paper');
      for (const [sx, a] of [[1.2, A.moss], [2.7, A.ember]]) {
        const st = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.36, 12), mat('#e9b949', 'paper')); st.position.copy(P(x0 + sx, y0 + 2.6, 0.24)); st.castShadow = true; root.add(st);
        agent(a, x0 + sx, y0 + 2.3, 0.06);
      }
      box(x1 - 0.9, y0 + 2.8, x1 - 0.3, y0 + 3.3, 0.06, 1.06, '#ef476f', 'paper');
      glow(x1 - 0.6, y0 + 3.05, 0.8, 1.6, 0xff5c8a, { a: 0.7 });
    });
  }
  function postOffice() {
    const x0 = 5.0, y0 = 13.0, x1 = 7.0, y1 = 16.4;
    const pig = texCanvas(256, 320, (g) => {
      g.fillStyle = '#f2e3c6'; g.fillRect(0, 0, 256, 320); g.globalAlpha = 0.12; g.drawImage(grain.image, 0, 0, 256, 320); g.globalAlpha = 1;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { const x = 30 + c * 68, y = 110 + r * 58; g.fillStyle = '#8a5a35'; g.fillRect(x, y, 56, 46); if ((r * 3 + c) % 4 === 1 || r * 3 + c === 6) { g.fillStyle = r * 3 + c === 6 ? '#ffc93c' : '#fffaf0'; g.fillRect(x + 8, y + 8, 40, 28); } }
      g.fillStyle = '#c8553d'; g.fillRect(56, 26, 144, 60); g.fillStyle = '#fffaf0'; g.font = `800 46px ${FONT}`; g.textAlign = 'center'; g.fillText('POST', 128, 72);
    });
    const pm = mat('#ffffff', 'paper', { map: pig, own: true }), ps = mat('#e8d7b6', 'paper', { own: true });
    box(x0, y0, x1, y1, 0, 2.6, null, null, { mats: [pm, ps, ps, ps, pm, ps] });
    const roof = new THREE.Shape(); roof.moveTo(y0 - 0.1, 0); roof.lineTo(y1 + 0.1, 0); roof.lineTo((y0 + y1) / 2, 1.1); roof.closePath();
    const rg = new THREE.ExtrudeGeometry(roof, { depth: x1 - x0 + 0.2, bevelEnabled: false });
    const rm = addMesh(rg, mat('#d9634a', 'roof'), null);
    rm.rotation.y = -Math.PI / 2; rm.position.copy(P(x1 + 0.1, 0, 2.6));
    // pillar box with the Needs-you count
    const pb = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.1, 20), mat('#c8302f', 'paper')); pb.position.copy(P(x1 + 0.6, y1 + 0.2, 0.55)); pb.castShadow = true; root.add(pb);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.36, 20, 8, 0, TAU, 0, Math.PI / 2), mat('#e04a43', 'paper')); cap.position.copy(P(x1 + 0.6, y1 + 0.2, 1.1)); root.add(cap);
    tag('POST · 3 for you', x1 + 0.6, y1 + 0.2, 1.75, { size: 0.8, color: '#c8302f', lcol: '#ffbf3c' });
    glow(x1 + 0.6, y1 + 0.2, 1.9, 2.4, 0xffc93c, { a: 0.8 });
  }
  function apartments() {
    const x0 = 9.2, y0 = 13.0, x1 = 15.2;
    const at = texCanvas(512, 360, (g) => { g.fillStyle = '#8fa3c8'; g.fillRect(0, 0, 512, 360); g.globalAlpha = 0.12; g.drawImage(grain.image, 0, 0, 512, 360); g.globalAlpha = 1; g.fillStyle = '#fffaf0'; g.font = `italic 800 64px ${FONT}`; g.textAlign = 'center'; g.fillText('Apartments', 220, 120); g.fillStyle = '#ffe9a8'; g.beginPath(); g.arc(430, 210, 46, 0, TAU); g.fill(); g.fillStyle = '#8fa3c8'; g.beginPath(); g.arc(452, 196, 40, 0, TAU); g.fill(); });
    const ag = new THREE.Group(); root.add(ag);
    const am = mat('#ffffff', 'paper', { map: at, own: true }), as = mat('#6d82a8', 'paper', { own: true });
    box(x0, y0, x1, y0 + 0.55, 0, 4.2, null, null, { mats: [as, as, mat('#a9badb', 'roof', { own: true }), as, am, am], parent: ag });
    fader(ag, 0, -1, (x0 + x1) / 2, y0);
    tag('Apartments', 12.2, y0 + 1.0, 4.7, { size: 1.0, color: '#5b6fb5' });
    [[0, 0, A.tansy], [2, 0, A.bram], [4, 0, null], [0, 2.4, A.olive], [2, 2.4, null], [4, 2.4, null]].forEach(([dx, dy, who]) => {
      const a0 = x0 + dx, b0 = y0 + 0.7 + dy;
      tray(a0, b0, a0 + 1.9, b0 + 2.2, 0, '#9fb0d6', !!who, who ? who.n : 'vacant', () => {
        box(a0 + 0.35, b0 + 0.35, a0 + 1.35, b0 + 1.75, 0.06, 0.32, '#fffaf0', 'paper');
        box(a0 + 0.4, b0 + 0.38, a0 + 1.3, b0 + 0.72, 0.32, 0.44, '#ffffff', 'paper');
        if (who) {
          box(a0 + 0.35, b0 + 0.8, a0 + 1.35, b0 + 1.75, 0.32, 0.5, HC[who.h], 'paper');
          agent(who, a0 + 0.85, b0 + 0.6, 0.12, { state: 'asleep', noStand: true });
        } else box(a0 + 0.35, b0 + 0.8, a0 + 1.35, b0 + 1.75, 0.32, 0.4, '#c7cfde', 'paper');
      });
    });
  }
  function library() {
    const x0 = 17.8, y0 = 13.2, x1 = 21.8, y1 = 17.4;
    const lt = facadeTex(4, 1, 1, { wall: '#6a8caf', top: 0.18, bottom: 0.75, sign: 'LIBRARY', signY: 0.93, signBg: '#4e7092', signSize: 56, w: 4, h: 2.8 });
    const lm = mat('#ffffff', 'window', { map: lt.map, emissiveMap: lt.emis, own: true });
    box(x0, y0, x1, y1, 0, 2.8, null, null, { mats: [lm, lm, mat('#86a5c4', 'roof', { own: true }), lm, lm, lm] });
    const dt = texCanvas(256, 128, (g) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#e9b949' : '#f2c66a'; g.fillRect(0, i * 16, 256, 16); } });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.6, 32, 12, 0, TAU, 0, Math.PI / 2), mat('#ffffff', 'paper', { map: dt, own: true }));
    dome.position.copy(P((x0 + x1) / 2, (y0 + y1) / 2, 2.8)); dome.castShadow = true; root.add(dome);
    tag('LIBRARY · memory', (x0 + x1) / 2, (y0 + y1) / 2, 4.8, { size: 0.9, color: '#4e7092' });
    const cols = ['#e07a5f', '#4361a8', '#f2c14e', '#5fa86a'];
    for (let i = 0; i < 5; i++) box(x1 + 0.3, y1 + 0.1, x1 + 1.1, y1 + 0.7, i * 0.18, i * 0.18 + 0.16, cols[i % 4], 'paper');
  }
  function warehouse() {
    const x0 = 22.4, y0 = 13.4, x1 = 25.8, y1 = 19.6;
    tray(x0, y0, x1, y1, 0, '#c08a5b', true, 'PR warehouse', () => {
      const st = ['#5fa86a', '#e9b949', '#5fa86a', '#e07a5f', '#e9b949', '#fffaf0', '#5fa86a', '#e9b949'];
      let k = 0;
      for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) {
        const cx = x0 + 0.5 + c * 1.4, cy = y0 + 0.6 + r * 1.35;
        const stack = (r + c) % 3 === 0 ? 2 : 1;
        for (let s = 0; s < stack; s++) {
          const col = st[k++ % st.length];
          box(cx, cy, cx + 0.95, cy + 0.95, 0.06 + s * 0.7, 0.06 + s * 0.7 + 0.68, '#d6a46e', 'paper');
          box(cx + 0.05, cy + 0.05, cx + 0.9, cy + 0.9, 0.06 + s * 0.7 + 0.68, 0.06 + s * 0.7 + 0.71, col, 'crate', { edges: false });
          if (col !== '#fffaf0') glow(cx + 0.47, cy + 0.47, 0.06 + s * 0.7 + 0.9, 0.9, new THREE.Color(col).getHex(), { a: 0.5, lumenOnly: true });
        }
      }
    });
    tag('PR warehouse · 12', 24.1, 16.5, 2.7, { size: 0.8, color: '#8a5a35' });
    // crane
    box(25.0, 11.9, 25.5, 12.4, 0.3, 4.2, '#e9b949', 'paper');
    crane = new THREE.Group(); crane.position.copy(P(25.25, 12.15, 4.2)); root.add(crane);
    const arm = box(0, -0.12, 3.0, 0.12, -0.12, 0.12, '#e9b949', 'paper', { parent: crane });
    void arm;
    hook = box(2.7, -0.3, 3.3, 0.3, -2.0, -1.5, '#5fa86a', 'paper', { parent: crane });
  }
  function trees() {
    const r = mulberry(42);
    const texs = [0, 1, 2, 3].map((k) => texCanvas(128, 192, (g) => {
      const col = ['#5f9e5d', '#76b06a', '#4d8a5b', '#8dbb6a'][k];
      g.fillStyle = '#8a5a35'; g.fillRect(58, 120, 12, 72);
      g.fillStyle = col;
      if (k % 2) { g.beginPath(); g.arc(64, 78, 54, 0, TAU); g.fill(); g.fillStyle = 'rgba(0,0,0,0.12)'; g.beginPath(); g.arc(74, 92, 34, 0, Math.PI); g.fill(); }
      else for (let i = 0; i < 3; i++) { const y = 150 - i * 44, w = 58 - i * 12; g.beginPath(); g.moveTo(64 - w, y); g.lineTo(64 + w, y); g.lineTo(64, y - 72); g.closePath(); g.fill(); }
    }));
    const blocked = [[-0.6, 10, 24.6, 11.6], [7.3, -0.6, 8.7, 21.6], [15.7, -0.6, 17.1, 21.6], [0.4, 0.4, 7.1, 9.8], [9, 0.6, 15.4, 9.8], [17.4, 0.4, 24.4, 9.8], [0.6, 12.6, 7.4, 17.8], [8.9, 12.6, 15.4, 18.2], [17.4, 12.6, 26, 19.6], [0.5, 18.6, 7.3, 21.6], [24.3, -1, 33, 23]];
    const placed = [];
    for (let i = 0; i < 500 && placed.length < 40; i++) {
      const x = r() * 24.6, y = r() * 21;
      if (blocked.some(([a, b, c, d]) => x > a - 0.5 && x < c + 0.5 && y > b - 0.5 && y < d + 0.5)) continue;
      if (placed.some(([px, py]) => Math.hypot(px - x, py - y) < 1.2)) continue;
      placed.push([x, y]);
      const k = Math.floor(r() * 4), h = 1.4 + r() * 1.1;
      const m = new THREE.MeshLambertMaterial({ map: texs[k], transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
      m.userData.rec = { mat: m, color: '#ffffff', role: 'tree', fade: 1, base: 1 }; recs.push(m.userData.rec);
      const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: texs[k], alphaTest: 0.4 });
      // two cards slotted together, the classic papercraft tree
      for (const ry of [0, Math.PI / 2]) {
        const g = new THREE.PlaneGeometry(h * 0.67, h); g.translate(0, h / 2, 0);
        const t = new THREE.Mesh(g, m); t.rotation.y = ry + r() * 0.3; t.position.copy(P(x, y, 0.05)); t.castShadow = true; t.customDepthMaterial = dm; root.add(t);
      }
    }
  }
  function lamps() {
    for (const [x, y] of [[2, 9.7], [6.8, 9.7], [11, 9.7], [14.8, 12], [19.5, 9.7], [23.5, 12], [9, 2], [9, 16], [17.4, 6], [17.4, 18]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.3, 6), mat('#3b2f2a', 'paper')); post.position.copy(P(x, y, 1.2)); post.castShadow = true; root.add(post);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), mat('#fff1c9', 'lamp')); bulb.position.copy(P(x, y, 2.4)); root.add(bulb);
      glow(x, y, 2.4, 2.4, 0xffd890, { a: 1 });
      glow(x, y, 0.2, 3.0, 0xffc070, { a: 0.35, paperOnly: true });
    }
  }
  function busStop() {
    const x = 11.4, y = 11.9;
    const gm = new THREE.MeshLambertMaterial({ color: 0xa9d6e5, transparent: true, opacity: 0.55 });
    const s = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 0.06), gm); s.position.copy(P(x + 0.8, y + 0.06, 0.8)); root.add(s);
    box(x - 0.1, y - 0.2, x + 1.7, y + 0.5, 1.5, 1.62, '#e9b949', 'roof');
    tag('BUS · Town loop', x + 0.8, y + 0.2, 2.2, { size: 0.65, color: '#4361a8', lod: 1 });
  }
  // the bus
  const busG = new THREE.Group(); root.add(busG);
  {
    const wt = texCanvas(512, 160, (g) => { g.fillStyle = '#f2b632'; g.fillRect(0, 0, 512, 160); for (let i = 0; i < 4; i++) { g.fillStyle = '#cfe9f3'; g.fillRect(28 + i * 118, 26, 90, 70); } g.fillStyle = '#5a3d2b'; g.font = `800 30px ${FONT}`; g.fillText('TOWN LOOP', 30, 140); });
    const we = texCanvas(512, 160, (g) => { g.fillStyle = '#000'; g.fillRect(0, 0, 512, 160); for (let i = 0; i < 4; i++) { g.fillStyle = '#ffd890'; g.fillRect(28 + i * 118, 26, 90, 70); } });
    const sm = mat('#ffffff', 'window', { map: wt, emissiveMap: we, own: true }), em = mat('#f2b632', 'paper', { own: true });
    box(0, -0.3, 2.6, 0.3, 0.32, 1.35, null, null, { mats: [em, em, mat('#f7cf6a', 'roof', { own: true }), em, sm, sm], parent: busG });
    for (const wx of [0.5, 2.1]) for (const wy of [-0.32, 0.32]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 16), mat('#3b2f2a', 'paper')); w.rotation.x = Math.PI / 2; w.position.copy(P(wx, wy, 0.32)); busG.add(w);
      const brass = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.1, 10), mat('#d4a548', 'paper')); brass.rotation.x = Math.PI / 2; brass.position.copy(P(wx, wy * 1.05, 0.32)); busG.add(brass);
    }
  }
  const busLight = glow(0, 0, 0.7, 3, 0xfff0b0, { a: 0.9 });
  function busPos(t) {
    const T = 32, k = t % T, keys = [[0, -0.4], [9, 10.4], [12, 10.4], [18, 21.5], [20, 21.5], [29, -0.4], [32, -0.4]];
    for (let i = 0; i < keys.length - 1; i++) { const [ta, xa] = keys[i], [tb, xb] = keys[i + 1]; if (k >= ta && k <= tb) return { x: lerp(xa, xb, ease((k - ta) / (tb - ta || 1))), dir: xb >= xa ? 1 : -1, moving: xa !== xb }; }
    return { x: 0, dir: 1, moving: false };
  }
  // the new host popping up: a card hinged on the page
  const flap = new THREE.Group(); flap.position.copy(P(1.0, 21.3, 0.06)); root.add(flap);
  {
    const ft = facadeTex(6, 2, 2, { wall: '#7bb07f', top: 0.12, bottom: 0.62, sign: 'PINE', signBg: '#5c8f60', signY: 0.88, signSize: 64, w: 5.6, h: 2.3 });
    const fm = mat('#ffffff', 'window', { map: ft.map, emissiveMap: ft.emis, own: true, side: THREE.DoubleSide });
    const geo = new THREE.PlaneGeometry(5.6, 2.3); geo.translate(2.8, 1.15, 0);
    const card = new THREE.Mesh(geo, fm); card.castShadow = true; flap.add(card);
    card.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat));
    const tabM = new THREE.Mesh(new THREE.CircleGeometry(0.45, 20), mat('#e07a5f', 'paper')); tabM.rotation.x = -Math.PI / 2; tabM.scale.set(1.2, 0.7, 1); tabM.position.copy(P(0.5, 19.7, 0.06)); root.add(tabM);
    pullTab = tabM;
    tag('new host · pine', 3.8, 20.4, 0.3, { size: 0.8, color: '#5c8f60' });
  }
  // sea: theatre wave strips sliding past each other, piers, origami boats
  const strips = [];
  function sea() {
    box(26.1, BOOK.y0 + 0.2, BOOK.x1 - 0.2, BOOK.y1 - 0.2, 0, 0.03, '#3f86a6', 'water', { edges: false });
    const L = BOOK.y1 - BOOK.y0 - 0.6;
    [26.6, 27.5, 28.4, 29.3, 30.2, 31.1].forEach((sx, i) => {
      const geo = new THREE.PlaneGeometry(L, 0.6, 90, 1);
      const m = mat(i % 2 ? '#5a9fbb' : '#77b9cf', 'water', { side: THREE.DoubleSide, own: true });
      const s = new THREE.Mesh(geo, m); s.rotation.y = Math.PI / 2; s.position.copy(P(sx, (BOOK.y0 + BOOK.y1) / 2, 0.3)); s.castShadow = true; s.receiveShadow = true; root.add(s);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat); s.add(e);
      strips.push({ s, i, base: geo.attributes.position.array.slice(), e });
    });
    for (const [y, id, v] of [[2.6, 'world', 'v2.1'], [7.2, 'crew', 'v0.4'], [15.4, 'docs', 'v1.0']]) {
      box(26.1, y - 0.35, 29.8, y + 0.35, 0.05, 0.58, '#a8774c', 'paper');
      boats.push(boat(PROJ[id], y + 1.1, boats.length));
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2, 6), mat('#8a5a35', 'paper')); pole.position.copy(P(26.2, y - 0.9, 1.3)); root.add(pole);
      tag(`${id} ${v}`, 27.6, y + 1.1, 3.0, { size: 0.75, color: PROJ[id] === '#f2c14e' ? '#c99a1c' : PROJ[id], lcol: PROJ[id] });
    }
  }
  const boats = [];
  function boat(col, y, j) {
    const g = new THREE.Group(); root.add(g);
    const hull = new THREE.Shape(); hull.moveTo(-1.3, 0.5); hull.lineTo(1.3, 0.5); hull.lineTo(0.8, -0.15); hull.lineTo(-0.8, -0.15); hull.closePath();
    addMesh(new THREE.ExtrudeGeometry(hull, { depth: 0.7, bevelEnabled: false }), mat('#fffaf0', 'paper'), new THREE.Vector3(0, 0, -0.35), { parent: g });
    const sail = new THREE.Shape(); sail.moveTo(0, 0.5); sail.lineTo(0, 2.4); sail.lineTo(1.0, 0.6); sail.closePath();
    addMesh(new THREE.ShapeGeometry(sail), mat(col, 'sail', { side: THREE.DoubleSide, own: true }), null, { parent: g });
    const sail2 = new THREE.Shape(); sail2.moveTo(0, 0.5); sail2.lineTo(0, 2.0); sail2.lineTo(-0.7, 0.6); sail2.closePath();
    addMesh(new THREE.ShapeGeometry(sail2), mat(col, 'sail', { side: THREE.DoubleSide, own: true }), null, { parent: g });
    glow(0, 0, 0, 1.2, new THREE.Color(col).getHex(), { a: 0.9 });
    g.userData = { y, j, light: glows[glows.length - 1].sp };
    return g;
  }
  // paper planes carry questions to the post office
  const planes = [];
  {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0.8, 0, 0, -0.6, 0, -0.45, -0.3, 0, 0, 0.8, 0, 0, -0.3, 0, 0, -0.6, 0, 0.45, 0.8, 0, 0, -0.3, 0, 0, -0.5, -0.22, 0], 3));
    geo.computeVertexNormals();
    for (const r of [[[3.5, 9.4, 1.4], [6.2, 16.6, 2.6], 0], [[3.5, 9.4, 1.4], [6.2, 16.6, 2.6], 0.5], [[21, 9.4, 1.4], [6.4, 16.6, 2.6], 0.25]]) {
      const m = new THREE.Mesh(geo, mat('#fffaf0', 'plane', { side: THREE.DoubleSide, own: true })); m.castShadow = true; m.scale.setScalar(0.5); root.add(m);
      planes.push({ m, r });
    }
  }
  // the amber beacons over agents who need you (Lumen and night)
  const beams = [];
  // hanging paper clouds and a sun / moon on a stick
  const clouds = [];
  const sunStick = new THREE.Group(); sunStick.position.copy(P(29, -1.6, 0)); root.add(sunStick);
  {
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 10, 6), mat('#9a6a42', 'paper')); stick.position.y = 5; stick.castShadow = true; sunStick.add(stick);
    sunBoard = board(256, 256, 3.4, 128, (g, w, h) => {
      g.translate(128, 128);
      if (theme.name === 'day') { g.fillStyle = '#f6b93b'; g.beginPath(); for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU, rr = i % 2 ? 90 : 120; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.fill(); g.fillStyle = '#fbd25f'; g.beginPath(); g.arc(0, 0, 72, 0, TAU); g.fill(); }
      else if (theme.name === 'night') { g.fillStyle = '#f6efd2'; g.beginPath(); g.arc(0, 0, 90, Math.PI * 0.5, Math.PI * 1.5); g.ellipse(0, 0, 40, 90, 0, Math.PI * 1.5, Math.PI * 0.5, true); g.fill(); }
    }, { parent: sunStick, cast: true });
    sunBoard.mesh.position.y = 10;
  }
  for (let i = 0; i < 5; i++) {
    const c = board(256, 160, 4.5, 80, (g) => {
      if (theme.lumen) return;
      g.fillStyle = theme.name === 'night' ? '#9aa4c4' : '#fffaf0';
      g.shadowColor = 'rgba(40,20,0,0.25)'; g.shadowBlur = 10; g.shadowOffsetY = 6;
      g.beginPath(); for (const [x, y, r] of [[70, 95, 40], [120, 70, 52], [175, 90, 42], [210, 108, 30]]) { g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); } g.rect(70, 100, 140, 34); g.fill();
    }, { pos: P(...[[-4, -4], [9, -6], [21, -6], [35, 3], [-6, 13]][i], 12 + (i % 2) * 2), cast: true });
    const thread = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 30, 3), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
    thread.position.y = 15.5; c.mesh.add(thread);
    clouds.push({ c, thread, i, x: c.mesh.position.x });
  }
  const flags = [], clockHands = [];

  // ---------- build the town ----------
  office({ x0: 0.6, y0: 0.6, name: 'ATLAS', rooms: [
    { id: 'docs', lit: false, people: [] }, { id: 'lab', lit: true, people: [[A.hazel][0]] },
    { id: 'world', lit: true, people: [A.scout, A.wren, A.juniper] }, { id: 'crew', lit: true, people: [A.otter, A.pixel] },
  ], queue: [A.maple, A.sable, A.lark] });
  office({ x0: 17.6, y0: 0.6, name: 'NIMBUS', rooms: [
    { id: 'api', lit: false, people: [] }, { id: 'ops', lit: false, people: [] },
    { id: 'site', lit: true, people: [A.kite] }, { id: 'lab', lit: false, people: [] },
  ], queue: [] });
  townHall(); bar(); postOffice(); apartments(); library(); warehouse(); trees(); lamps(); busStop(); sea();
  const walkers = [agent(A.fig, 8.3, 0.8, 0.1, { state: 'walking' }), agent(A.quill, 1.2, 12.25, 0.1, { state: 'walking' })];
  const riders = [agent(A.fig, 0, 0, 0, { state: 'bus', noStand: true }), agent(A.otter, 0, 0, 0, { state: 'bus', noStand: true })];
  riders.forEach((b) => { root.remove(b.mesh); busG.add(b.mesh); b.baseScale = 0.6; });
  riders[0].mesh.position.copy(P(0.8, 0, 0.75)); riders[1].mesh.position.copy(P(1.8, 0, 0.75));
  // amber beacon columns, one per waiting agent
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffbf3c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const bm of beams) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.2, 9, 10, 1, true), beamMat); c.position.copy(P(bm.x, bm.y, bm.z + 6.5)); root.add(c); }

  // ---------- lights ----------
  const hemi = new THREE.HemisphereLight(0xfff3df, 0x8a6a50, 0.8); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d6, 0.95);
  sun.position.set(15.4 - 18, 30, 10.5 - 6); sun.target.position.set(15.4, 0, 10.5); scene.add(sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02; sun.shadow.radius = 4;
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 22, bottom: -22, near: 5, far: 80 });
  scene.add(sun);
  const spot = new THREE.SpotLight(0xffc98a, 0, 90, 0.6, 0.9, 1); spot.position.set(4, 30, 2); spot.target.position.set(9, 0, 9); scene.add(spot, spot.target);

  // ---------- themes ----------
  let theme = { name: 'day', ...THEMES.day };
  function setTheme(name) {
    theme = { name, ...THEMES[name] };
    const T = theme;
    host.style.background = T.css;
    scene.fog.color.set(T.fog);
    hemi.color.set(T.hemi[0]); hemi.groundColor.set(T.hemi[1]); hemi.intensity = T.hemi[2];
    sun.color.set(T.sun[0]); sun.intensity = T.sun[1]; spot.intensity = T.spot;
    edgeMat.color.set(T.edge[0]); edgeMat.opacity = T.edge[1]; edgeMat.blending = T.lumen ? THREE.AdditiveBlending : THREE.NormalBlending;
    desk.visible = T.desk; mirror.visible = !T.desk;
    for (const r of recs) styleRec(r);
    for (const g of glows) { const on = (g.lumenOnly ? T.lumen : g.paperOnly ? !T.lumen : true); g.sp.material.opacity = on ? g.a * T.glow : 0; g.sp.visible = on && T.glow > 0; }
    for (const rl of roomLights) { rl.l.intensity = T.roomLight; rl.l.color.copy(T.lumen ? rl.lcolor : rl.color); }
    beamMat.opacity = T.lumen ? 0.55 : T.name === 'night' ? 0.25 : 0;
    for (const b of boards) { b.mesh.material.color.set(T.tint); redraw(b, clockT); }
    if (ui.onTheme) ui.onTheme(name);
  }
  function styleRec(r) {
    const m = r.mat, T = theme, c = new THREE.Color(r.color || '#ffffff');
    m.emissive && m.emissive.set(0x000000);
    m.emissiveIntensity = 1;
    let op = 1, dw = true;
    if (!T.lumen) {
      m.color.copy(c);
      if (r.role === 'window' || r.role === 'screen' || r.role === 'lamp') { m.emissive.set(r.role === 'screen' ? 0x6fc3ff : 0xffb860); m.emissiveIntensity = T.emis * (r.role === 'window' ? 0.9 : 0.8); }
      if (r.role === 'lit') { m.emissive.set(0x7a4a10); m.emissiveIntensity = T.emis * 0.35; }
      if (r.role === 'crate' || r.role === 'sail') { m.emissive.copy(c).multiplyScalar(0.35 * T.emis); }
    } else {
      const glassC = c.clone().lerp(new THREE.Color(0xbfe8ff), 0.45);
      switch (r.role) {
        case 'ground': case 'page': case 'cover': m.color.set(0x070b18); m.emissive.set(0x050a18); break;
        case 'pageside': m.color.set(0x0b1430); m.emissive.set(0x0a1c3a); break;
        case 'road': m.color.set(0x0e1b3e); m.emissive.set(0x0f2a5c); break;
        case 'slot': m.color.set(0x7fe7ff); m.emissive.set(0x3fb8ff); break;
        case 'quay': m.color.set(0x0c1734); m.emissive.set(0x0a1a3a); break;
        case 'water': m.color.set(0x0a3a66); m.emissive.set(0x07305a); op = 0.65; dw = false; break;
        case 'lit': m.color.copy(c); m.emissive.set(0xffb070).multiplyScalar(0.25); op = 0.8; break;
        case 'window': m.color.set(0x9fdcff); m.emissive.set(0x6fd0ff); m.emissiveIntensity = 1.2; op = 0.38; dw = false; break;
        case 'screen': m.color.set(0x9fe9ff); m.emissive.set(0x5fd8ff); m.emissiveIntensity = 1.4; break;
        case 'lamp': m.color.set(0xffffff); m.emissive.set(0xffe0a0); break;
        case 'crate': case 'sail': m.color.copy(c); m.emissive.copy(c).multiplyScalar(0.9); break;
        case 'tree': m.color.set(0x7fe7ff); m.emissive.set(0x1f8fb0); op = 0.5; dw = false; break;
        case 'plane': m.color.set(0xffe2a0); m.emissive.set(0xffbf3c); break;
        case 'ribbon': m.color.set(0xff6a8a); m.emissive.set(0xff3a6a); break;
        default: m.color.copy(glassC); m.emissive.copy(c).multiplyScalar(0.18); op = 0.2; dw = false;
      }
    }
    r.base = op;
    m.opacity = op * r.fade; m.transparent = m.opacity < 0.999; m.depthWrite = dw && r.fade > 0.6;
    m.needsUpdate = true;
  }

  // ---------- controls ----------
  const controls = new TownControls(camera, renderer.domElement, {
    bounds: { x0: -1, x1: 31, z0: -1, z1: 21.5 }, x: 13.6, z: 10.2, theta: Math.PI / 4, phi: 0.72, dist: 42, dMin: 6, dMax: 80,
    onChange: (c) => ui.onView && ui.onView(c),
  });

  // ---------- frame loop ----------
  let clockT = 0, lastNow = performance.now(), running = true, dirty = true;
  const camH = new THREE.Vector3();
  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = clamp((now - lastNow) / 1000, 0, 0.05); lastNow = Math.max(lastNow, now);
    clockT += dt;
    const t = clockT;
    controls.update(dt);
    const th = controls.cur.theta, dist = controls.cur.dist;
    camH.copy(camera.position);
    // cards face the camera; labels for rooms appear when you are close
    const grow = clamp(dist / 24, 1, 1.75);
    for (const b of boards) {
      b.mesh.rotation.y = th;
      if (b.agent || b.isTag) b.mesh.scale.setScalar((b.isTag ? grow : 0.4 + grow * 0.6) * (b.baseScale || 1));
      if (b.lod) b.mesh.visible = dist < 30;
      if (b.fps && t - b.last > 1 / b.fps + b.phase * 0.02) redraw(b, t);
    }
    // tall walls fold away when they are between you and a room
    for (const f of faders) {
      const vx = camH.x - f.cx, vz = camH.z - f.cy, l = Math.hypot(vx, vz) || 1;
      const s = (vx * f.nx + vz * f.ny) / l;
      const goal = s > 0.15 ? 0.12 : 1;
      if (Math.abs(f.f - goal) > 0.01) { f.f = clamp(f.f + (goal - f.f) * (1 - Math.exp(-dt * 8)), 0.12, 1); for (const r of f.ms) { r.fade = f.f; r.mat.opacity = r.base * f.f; r.mat.transparent = r.mat.opacity < 0.999; r.mat.depthWrite = f.f > 0.6 && r.base > 0.9; } }
    }
    // animation
    const b = busPos(t);
    busG.position.copy(P(b.x, 10.65, b.moving ? Math.abs(Math.sin(t * 10)) * 0.04 : 0));
    busLight.position.copy(P(b.dir > 0 ? b.x + 2.8 : b.x - 0.2, 10.95, 0.8));
    [[walkers[0], (k) => [8.3, lerp(0.8, 20, k)], 26], [walkers[1], (k) => [lerp(1.2, 7.6, k), 12.25], 14]].forEach(([w, f, T], i) => {
      const ph = (t / T + i * 0.37) % 2, k = ph < 1 ? ph : 2 - ph, [x, y] = f(k);
      w.mesh.position.copy(P(x, y, 0.1));
    });
    for (const p of planes) {
      const [a, bb, off] = p.r, k = (t / 5 + off) % 1;
      const pos = (kk) => P(lerp(a[0], bb[0], kk), lerp(a[1], bb[1], kk), lerp(a[2], bb[2], kk) + Math.sin(kk * Math.PI) * 4);
      p.m.position.copy(pos(k)); p.m.lookAt(pos(Math.min(1, k + 0.02))); p.m.rotateY(-Math.PI / 2);
      p.m.visible = k > 0.03 && k < 0.97;
    }
    for (const s of strips) {
      const arr = s.s.geometry.attributes.position.array;
      for (let i = 0; i < arr.length; i += 3) if (s.base[i + 1] > 0) arr[i + 1] = s.base[i + 1] + 0.12 * Math.sin(s.base[i] * 1.6 + t * 1.3 + s.i * 1.7) + 0.06 * Math.sin(s.base[i] * 0.5 - t * 0.6);
      s.s.geometry.attributes.position.needsUpdate = true;
    }
    boats.forEach((g) => {
      const { y, j, light } = g.userData;
      const x = 27.9 + Math.sin(t * 0.25 + j * 2) * 0.3 + (j === 1 ? 0.9 : 0);
      g.position.copy(P(x, y, 0.32 + Math.sin(t * 1.5 + j * 2) * 0.08)); g.rotation.z = Math.sin(t * 1.2 + j) * 0.05;
      light.position.copy(P(x, y, 2.6));
    });
    for (const f of flags) { const a = f.geometry.attributes.position.array; for (let i = 0; i < a.length; i += 3) a[i + 2] = Math.sin(a[i] * 4 - t * 5) * 0.08 * a[i]; f.geometry.attributes.position.needsUpdate = true; }
    clockHands.forEach((hd, i) => { hd.rotation.z = -(i % 2 ? t * 0.6 : t * 0.6); });
    if (crane) { crane.rotation.y = Math.sin(t * 0.4) * 0.35; hook.position.y = -1.75 + Math.sin(t * 0.8) * 0.3; }
    const cyc = (t % 14) / 14, ang = cyc < 0.45 ? ease(clamp(cyc / 0.38, 0, 1)) : cyc < 0.85 ? 1 : 1 - ease((cyc - 0.85) / 0.15);
    flap.rotation.x = -Math.PI / 2 * (1 - ang);
    pullTab.position.copy(P(0.4 - (1 - ang) * 0.5, 19.7, 0.06));
    clouds.forEach((c) => { c.c.mesh.position.x = c.x + Math.sin(t * 0.08 + c.i) * 1.5; c.c.mesh.visible = !theme.lumen; });
    sunBoard.mesh.visible = !theme.lumen; sunStick.visible = !theme.lumen;
    renderer.render(scene, camera);
  }

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
    camera.aspect = w / h;
    camera.fov = w < h ? 46 : 32;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  resize();
  if (host.clientWidth < host.clientHeight) { controls.home.dist = 74; controls.home.phi = 0.84; Object.assign(controls.cur, controls.home); Object.assign(controls.goal, controls.home); }
  setTheme('day');
  document.fonts && document.fonts.ready.then(() => { for (const b of boards) redraw(b, clockT); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) running = false; else if (!running) { running = true; lastNow = performance.now(); requestAnimationFrame(frame); } });
  requestAnimationFrame(frame);
  void dirty;
  return { setTheme, controls, get theme() { return theme.name; } };
}

function mulberry(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
