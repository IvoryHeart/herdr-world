/**
 * Generated pixel art for the Office town.
 *
 * Every sprite is drawn from a compact definition into a canvas with a dark
 * one-pixel outline. There are no binary assets: appearance is a pure function
 * of identity and the definitions below.
 */

export type TownCanvas = HTMLCanvasElement;
type Rect = (x: number, y: number, w: number, h: number, color: string) => void;
type Disc = (cx: number, cy: number, r: number, color: string) => void;

export const TOWN_OUTLINE = "#1c1722";

export function townHash(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function townRandom(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgb(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255] as const;
}

export function townShade(hex: string, amount: number) {
  let [r, g, b] = rgb(hex);
  if (amount < 0) {
    r *= 1 + amount;
    g *= 1 + amount;
    b *= 1 + amount;
  } else {
    r += (255 - r) * amount;
    g += (255 - g) * amount;
    b += (255 - b) * amount;
  }
  const n =
    (1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
  return `#${n.toString(16).slice(1)}`;
}

export function townCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  // CPU-backed: these canvases are painted once and uploaded to WebGL, and a
  // GPU-backed canvas would force a synchronous readback on every upload.
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.imageSmoothingEnabled = false;
  return [canvas, context] as const;
}

/**
 * Add a one-pixel outline by stamping the sprite's silhouette at four offsets
 * beneath it. Pure compositing: no pixel readback from the canvas.
 */
function outline(canvas: TownCanvas, color = TOWN_OUTLINE) {
  const [silhouette, s] = townCanvas(canvas.width, canvas.height);
  s.drawImage(canvas, 0, 0);
  s.globalCompositeOperation = "source-in";
  s.fillStyle = color;
  s.fillRect(0, 0, canvas.width, canvas.height);
  const [result, r] = townCanvas(canvas.width, canvas.height);
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const)
    r.drawImage(silhouette, dx, dy);
  r.drawImage(canvas, 0, 0);
  return result;
}

/** Draw a sprite with a one-pixel border reserved for its outline. */
export function townSprite(
  width: number,
  height: number,
  draw: (rect: Rect, disc: Disc) => void,
  outlineColor: string | null = TOWN_OUTLINE,
) {
  const [canvas, context] = townCanvas(width + 2, height + 2);
  const rect: Rect = (x, y, w, h, color) => {
    context.fillStyle = color;
    context.fillRect(x + 1, y + 1, w, h);
  };
  const disc: Disc = (cx, cy, r, color) => {
    context.fillStyle = color;
    for (let y = -r; y <= r; y += 1)
      for (let x = -r; x <= r; x += 1)
        if (x * x + y * y <= r * r + r * 0.6)
          context.fillRect(cx + x + 1, cy + y + 1, 1, 1);
  };
  draw(rect, disc);
  return outlineColor ? outline(canvas, outlineColor) : canvas;
}

export function townFlip(source: TownCanvas) {
  const [canvas, context] = townCanvas(source.width, source.height);
  context.translate(source.width, 0);
  context.scale(-1, 1);
  context.drawImage(source, 0, 0);
  return canvas;
}

/* ---------- characters ---------- */

const SKINS = ["#f2c9a0", "#e3ad80", "#c68a5c", "#8d5a3b", "#f7d9bb"];
const HAIRS = [
  "#2b2026",
  "#5a3825",
  "#a0522d",
  "#e8c26a",
  "#c94f4f",
  "#3d4f8f",
  "#ece4da",
  "#1f3b2c",
];
const SHIRTS = [
  "#4f7cc9",
  "#d9644a",
  "#59a86b",
  "#9b6ad6",
  "#e0b33c",
  "#3fa7a3",
  "#d65c8e",
  "#6b7a8f",
];
const PANTS = ["#2e3447", "#4a3b2f", "#30404a", "#3b3247"];

export type TownLook = {
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  style: 0 | 1 | 2;
};

/** Deterministic appearance for an identity. */
export function townLookFor(identity: string): TownLook {
  const random = townRandom(townHash(identity) * 7 + 1);
  const pick = <T>(values: readonly T[]) =>
    values[Math.floor(random() * values.length)]!;
  return {
    skin: pick(SKINS),
    hair: pick(HAIRS),
    shirt: pick(SHIRTS),
    pants: pick(PANTS),
    style: Math.floor(random() * 3) as 0 | 1 | 2,
  };
}

export type TownDirection = "down" | "up" | "left" | "right";
export type TownPose = "stand" | "sit" | "carry";

function drawCharacter(
  R: Rect,
  look: TownLook,
  dir: TownDirection,
  frame: number,
  pose: TownPose,
  blink: boolean,
) {
  const { skin, hair, shirt, pants, style } = look;
  const sd = townShade(shirt, -0.28);
  const sl = townShade(shirt, 0.25);
  const hl = townShade(hair, 0.3);
  const hd = townShade(hair, -0.25);
  const sk2 = townShade(skin, -0.18);
  const shoe = "#2b2433";
  const eye = "#231d2b";
  const cap = townShade(shirt, -0.42);
  if (dir !== "right") {
    if (pose !== "sit") {
      const lUp = frame === 1;
      const rUp = frame === 3;
      R(3, 13, 6, 1, pants);
      R(3, 14, 2, lUp ? 1 : 2, pants);
      R(7, 14, 2, rUp ? 1 : 2, pants);
      R(5, 14, 2, 1, townShade(pants, -0.2));
      R(3, lUp ? 15 : 16, 2, 1, shoe);
      R(7, rUp ? 15 : 16, 2, 1, shoe);
    }
    R(2, 8, 8, 5, shirt);
    R(9, 8, 1, 5, sd);
    R(2, 12, 8, 1, sd);
    if (dir === "down") R(5, 8, 2, 2, sl);
    if (pose === "sit") {
      R(1, 8, 1, 2, shirt);
      R(10, 8, 1, 2, sd);
      R(2, frame ? 9 : 10, 1, 1, skin);
      R(9, frame ? 10 : 9, 1, 1, skin);
    } else if (pose === "carry") {
      R(1, 4, 1, 5, shirt);
      R(10, 4, 1, 5, sd);
      R(1, 3, 1, 1, skin);
      R(10, 3, 1, 1, skin);
    } else {
      const lh = frame === 3 ? 12 : 11;
      const rh = frame === 1 ? 12 : 11;
      R(1, 8, 1, lh - 8, shirt);
      R(10, 8, 1, rh - 8, sd);
      R(1, lh, 1, 1, skin);
      R(10, rh, 1, 1, skin);
    }
    R(5, 7, 2, 1, sk2);
    if (dir === "down") {
      R(3, 3, 6, 3, skin);
      R(4, 6, 4, 1, skin);
      R(4, 4, 1, 1, blink ? sk2 : eye);
      R(7, 4, 1, 1, blink ? sk2 : eye);
      R(3, 5, 1, 1, "#e9a3a0");
      R(8, 5, 1, 1, "#e9a3a0");
      if (style === 2) {
        R(3, 0, 6, 1, cap);
        R(2, 1, 8, 2, cap);
        R(2, 3, 9, 1, townShade(cap, -0.25));
        R(4, 1, 2, 1, townShade(cap, 0.25));
      } else {
        R(3, 0, 6, 1, hair);
        R(2, 1, 8, 2, hair);
        R(2, 3, 1, 1, hair);
        R(9, 3, 1, 1, hair);
        R(3, 3, 3, 1, hair);
        R(4, 1, 2, 1, hl);
        if (style === 1) {
          R(2, 4, 1, 4, hair);
          R(9, 4, 1, 4, hair);
        }
      }
    } else {
      R(3, 0, 6, 1, hair);
      R(2, 1, 8, 5, hair);
      R(3, 6, 6, 1, hd);
      R(4, 1, 2, 1, hl);
      if (style === 1) R(2, 6, 8, 2, hair);
      if (style === 2) {
        R(3, 0, 6, 1, cap);
        R(2, 1, 8, 2, cap);
      }
    }
    return;
  }
  if (pose !== "sit") {
    if (frame % 2 === 0) {
      R(4, 13, 4, 3, pants);
      R(4, 16, 5, 1, shoe);
    } else {
      R(3, 13, 2, 2, townShade(pants, -0.2));
      R(2, 15, 3, 1, shoe);
      R(6, 13, 2, 3, pants);
      R(6, 16, 3, 1, shoe);
    }
  }
  R(3, 8, 6, 5, shirt);
  R(3, 12, 6, 1, sd);
  R(8, 8, 1, 4, sd);
  if (pose === "carry") {
    R(6, 3, 2, 6, sd);
    R(7, 3, 1, 1, skin);
  } else if (frame === 1) {
    R(6, 8, 2, 3, sd);
    R(7, 11, 1, 1, skin);
  } else if (frame === 3) {
    R(4, 8, 2, 3, sd);
    R(3, 11, 1, 1, skin);
  } else {
    R(5, 8, 2, 4, sd);
    R(5, 12, 2, 1, skin);
  }
  R(5, 7, 2, 1, sk2);
  R(4, 3, 5, 4, skin);
  R(9, 4, 1, 1, skin);
  R(5, 4, 1, 1, sk2);
  R(7, 4, 1, 1, blink ? sk2 : eye);
  if (style === 2) {
    R(4, 0, 5, 1, cap);
    R(3, 1, 7, 2, cap);
    R(8, 3, 3, 1, townShade(cap, -0.25));
    R(3, 3, 2, 2, hair);
  } else {
    R(4, 0, 5, 1, hair);
    R(3, 1, 7, 2, hair);
    R(3, 3, 2, 3, hair);
    R(6, 3, 2, 1, hair);
    R(5, 1, 2, 1, hl);
    if (style === 1) R(3, 6, 2, 2, hair);
  }
}

const characterCache = new Map<string, TownCanvas>();

export function townLookKey(look: TownLook) {
  return `${look.skin}${look.hair}${look.shirt}${look.pants}${look.style}`;
}

/** A 14x20 character frame, cached by appearance. */
export function townCharacter(
  look: TownLook,
  dir: TownDirection,
  frame: number,
  pose: TownPose,
  blink: boolean,
): TownCanvas {
  const key = `${townLookKey(look)}|${dir}|${frame}|${pose}|${blink ? 1 : 0}`;
  let canvas = characterCache.get(key);
  if (canvas) return canvas;
  canvas =
    dir === "left"
      ? townFlip(townCharacter(look, "right", frame, pose, blink))
      : townSprite(12, 18, (R) =>
          drawCharacter(R, look, dir, frame, pose, blink),
        );
  characterCache.set(key, canvas);
  return canvas;
}

/* ---------- furniture and scenery ---------- */

export const TOWN_WOODS = ["#c48d57", "#b07a4a", "#d2a46e", "#a36f47"] as const;
export const TOWN_KIND_LOGOS: Record<string, string> = {
  claude: "#e0835f",
  codex: "#f0f0f0",
  gemini: "#7aa5ff",
};

export type TownStaticSprites = ReturnType<typeof buildTownSprites>;

/** Build every non-character sprite once. */
export function buildTownSprites() {
  const table = Object.fromEntries(
    TOWN_WOODS.map((w) => [
      w,
      townSprite(64, 32, (R) => {
        R(0, 0, 64, 24, w);
        R(0, 0, 64, 1, townShade(w, 0.28));
        R(0, 11, 64, 2, townShade(w, -0.16));
        R(0, 13, 64, 1, townShade(w, 0.12));
        R(0, 23, 64, 1, townShade(w, -0.1));
        R(0, 24, 64, 6, townShade(w, -0.24));
        R(0, 24, 64, 1, townShade(w, -0.42));
        R(2, 30, 3, 2, townShade(w, -0.55));
        R(59, 30, 3, 2, townShade(w, -0.55));
        R(30, 30, 4, 2, townShade(w, -0.55));
      }),
    ]),
  ) as Record<string, TownCanvas>;
  const lid = (logo: string) =>
    townSprite(14, 7, (R) => {
      R(0, 0, 14, 5, "#5d6574");
      R(0, 0, 14, 1, "#7d8697");
      R(6, 2, 2, 2, logo);
      R(1, 5, 12, 2, "#3a404b");
    });
  const bubble = (draw: (R: Rect) => void) =>
    townSprite(11, 12, (R) => {
      const w = "#fffaf0";
      R(1, 0, 9, 10, w);
      R(0, 1, 11, 8, w);
      R(4, 10, 3, 1, w);
      R(5, 11, 1, 1, w);
      R(1, 9, 9, 1, "#e3dac8");
      draw(R);
    });
  const tree = (c1: string, c2: string, c3: string, c4: string) =>
    townSprite(
      32,
      42,
      (R, D) => {
        R(13, 28, 6, 13, "#6b4a2f");
        R(13, 28, 2, 13, "#86603e");
        D(16, 17, 13, c1);
        D(10, 19, 8, c2);
        D(22, 20, 8, c2);
        D(15, 12, 9, c3);
        D(11, 9, 5, c4);
        D(21, 12, 4, c3);
        R(9, 7, 2, 1, townShade(c4, 0.3));
        R(19, 9, 1, 1, townShade(c4, 0.3));
      },
      "#1b2a1f",
    );
  return {
    table,
    chair: townSprite(14, 11, (R) => {
      R(1, 0, 12, 8, "#3b4354");
      R(2, 1, 10, 1, "#56617b");
      R(0, 5, 2, 5, "#2a303d");
      R(12, 5, 2, 5, "#2a303d");
      R(1, 8, 12, 2, "#30374a");
    }),
    chairBack: townSprite(14, 10, (R) => {
      R(1, 0, 12, 7, "#343b4b");
      R(2, 1, 10, 1, "#4c566d");
      R(5, 7, 4, 3, "#262c38");
    }),
    lid: Object.fromEntries(
      Object.entries(TOWN_KIND_LOGOS).map(([kind, logo]) => [kind, lid(logo)]),
    ) as Record<string, TownCanvas>,
    lidOff: lid("#6a707b"),
    counter: townSprite(80, 30, (R) => {
      const w = "#6d4a8e";
      R(0, 0, 80, 10, "#d9c7a6");
      R(0, 0, 80, 1, "#efe2c9");
      R(0, 10, 80, 16, w);
      R(0, 10, 80, 1, townShade(w, -0.35));
      for (let x = 6; x < 80; x += 12) R(x, 13, 6, 10, townShade(w, 0.12));
      R(30, 14, 20, 7, "#ffd166");
      R(31, 15, 18, 5, "#e3aa3a");
      R(60, 0, 5, 1, "#e9c75a");
      R(0, 26, 80, 2, townShade(w, -0.4));
    }),
    mug: townSprite(3, 4, (R) => {
      R(0, 0, 3, 4, "#f1ece2");
      R(1, 0, 1, 1, "#7a4a2c");
    }),
    cactus: townSprite(5, 7, (R) => {
      R(1, 0, 3, 4, "#5aa857");
      R(0, 1, 1, 2, "#5aa857");
      R(2, 1, 1, 1, "#86cc72");
      R(0, 4, 5, 3, "#b5623d");
    }),
    plant: townSprite(14, 22, (R, D) => {
      D(7, 6, 5, "#2f7a3c");
      D(4, 9, 4, "#3e8f45");
      D(10, 9, 4, "#3e8f45");
      D(7, 4, 3, "#5aae55");
      R(6, 12, 2, 3, "#2f6b3a");
      R(2, 15, 10, 2, "#c97a52");
      R(3, 17, 8, 5, "#b5623d");
      R(3, 17, 8, 1, "#93492b");
    }),
    sofa: townSprite(48, 21, (R) => {
      const c = "#5d6fae";
      R(0, 1, 48, 9, c);
      R(0, 1, 48, 1, townShade(c, 0.25));
      R(4, 9, 40, 7, townShade(c, 0.12));
      R(4, 9, 40, 1, townShade(c, 0.32));
      R(24, 9, 1, 7, townShade(c, -0.15));
      R(0, 4, 5, 13, townShade(c, -0.18));
      R(43, 4, 5, 13, townShade(c, -0.18));
      R(0, 16, 48, 2, townShade(c, -0.35));
      R(2, 18, 3, 3, "#3a2b22");
      R(43, 18, 3, 3, "#3a2b22");
    }),
    coffee: townSprite(14, 24, (R) => {
      R(0, 0, 14, 24, "#414857");
      R(0, 0, 14, 2, "#5a6274");
      R(2, 3, 10, 6, "#1f232c");
      R(3, 4, 3, 1, "#ff6b5b");
      R(7, 4, 4, 1, "#6fc3ff");
      R(5, 11, 4, 3, "#2a2f3a");
      R(4, 17, 6, 4, "#f1ece2");
      R(1, 21, 12, 2, "#30353f");
    }),
    cooler: townSprite(12, 26, (R) => {
      R(2, 0, 8, 10, "#9fd8f5");
      R(3, 1, 2, 7, "#d2efff");
      R(1, 10, 10, 16, "#e7ecef");
      R(1, 10, 10, 1, "#ffffff");
      R(3, 13, 2, 2, "#4f7cc9");
      R(7, 13, 2, 2, "#d9644a");
      R(1, 24, 10, 2, "#b9c0c6");
    }),
    trees: [
      tree("#2e6a39", "#357a40", "#428f48", "#5aa857"),
      tree("#2a5f3a", "#2f6e44", "#3a8150", "#4f9a5c"),
      tree("#8a4a6a", "#a5587c", "#c7739a", "#e7a2bf"),
    ],
    bush: townSprite(
      18,
      12,
      (R, D) => {
        D(5, 7, 5, "#3a8044");
        D(12, 7, 5, "#3a8044");
        D(9, 5, 5, "#4b9a4d");
        R(7, 3, 2, 1, "#6fbd62");
        R(4, 6, 1, 1, "#f5e27a");
        R(13, 5, 1, 1, "#f2a5c4");
      },
      "#1b2a1f",
    ),
    lamp: townSprite(6, 30, (R) => {
      R(2, 6, 2, 22, "#2d333d");
      R(0, 0, 6, 6, "#2d333d");
      R(1, 1, 4, 4, "#ffe7a3");
      R(1, 28, 4, 2, "#2d333d");
    }),
    bench: townSprite(24, 12, (R) => {
      R(0, 0, 24, 3, "#8a5a3c");
      R(0, 4, 24, 3, "#a06a45");
      R(0, 4, 24, 1, "#b98256");
      R(2, 7, 2, 5, "#3a332e");
      R(20, 7, 2, 5, "#3a332e");
    }),
    board: townSprite(30, 30, (R) => {
      R(2, 8, 2, 22, "#5a3d28");
      R(26, 8, 2, 22, "#5a3d28");
      R(0, 0, 30, 18, "#7a5536");
      R(1, 1, 28, 16, "#c9a06a");
      R(3, 3, 8, 6, "#fffaf0");
      R(13, 3, 7, 8, "#ffe79a");
      R(22, 4, 6, 5, "#bfe3ff");
      R(4, 11, 9, 4, "#ffd0d0");
      R(16, 12, 10, 3, "#fffaf0");
    }),
    bubble: {
      // A question mark: the agent is asking you something.
      blocked: bubble((R) => {
        const c = "#e8820c";
        R(4, 1, 3, 1, c);
        R(3, 2, 1, 2, c);
        R(7, 2, 1, 2, c);
        R(6, 4, 1, 1, c);
        R(5, 5, 1, 2, c);
        R(5, 8, 1, 1, c);
      }),
      // Typing dots, one frame per lit dot.
      typing0: bubble((R) => {
        R(2, 5, 1, 1, "#4f7cc9");
        R(5, 5, 1, 1, "#b9c3d1");
        R(8, 5, 1, 1, "#b9c3d1");
      }),
      typing1: bubble((R) => {
        R(2, 5, 1, 1, "#b9c3d1");
        R(5, 5, 1, 1, "#4f7cc9");
        R(8, 5, 1, 1, "#b9c3d1");
      }),
      typing2: bubble((R) => {
        R(2, 5, 1, 1, "#b9c3d1");
        R(5, 5, 1, 1, "#b9c3d1");
        R(8, 5, 1, 1, "#4f7cc9");
      }),
      done: bubble((R) => {
        for (const [x, y] of [
          [2, 5],
          [3, 6],
          [4, 7],
          [5, 6],
          [6, 5],
          [7, 4],
          [8, 3],
        ] as const)
          R(x, y, 1, 2, "#2f9e55");
      }),
      idle: bubble((R) => {
        R(3, 4, 5, 4, "#8a5a3c");
        R(8, 5, 1, 2, "#8a5a3c");
        R(4, 4, 3, 1, "#c9925f");
        R(4, 2, 1, 1, "#b9b9b9");
        R(6, 1, 1, 1, "#b9b9b9");
      }),
    },
  };
}

/** Laptop facing the viewer (14x9), showing a status screen. */
export function townScreen(state: string, frame: number) {
  return townSprite(
    14,
    9,
    (R) => {
      R(0, 0, 14, 9, "#1c1722");
      R(1, 7, 12, 2, "#3a404b");
      R(
        1,
        1,
        12,
        6,
        state === "shell" ? "#102016" : state === "off" ? "#11161d" : "#0f1a26",
      );
      if (state === "working") {
        for (let i = 0; i < 3; i += 1)
          R(2, 2 + i * 2, 3 + ((frame + i * 3) % 7), 1, "#6fc3ff");
      } else if (state === "blocked") {
        R(6, 2, 2, 3, frame % 2 ? "#ffb547" : "#c98a2c");
        R(6, 6, 2, 1, frame % 2 ? "#ffb547" : "#c98a2c");
      } else if (state === "done") {
        for (const [x, y] of [
          [4, 4],
          [5, 5],
          [6, 4],
          [7, 3],
          [8, 2],
        ] as const)
          R(x, y, 1, 1, "#7be08f");
      } else if (state === "shell") {
        R(2, 2, 2, 1, "#7fbf7a");
        R(5, 2, 5, 1, "#7fbf7a");
        R(2, 4, 6, 1, "#7fbf7a");
        if (frame % 2) R(2, 5, 2, 1, "#7fbf7a");
      }
    },
    null,
  );
}

const portraits = new Map<string, string>();
/** A standing, front-facing portrait of an agent as an image URL. */
export function townPortrait(key: string) {
  let url = portraits.get(key);
  if (!url) {
    url = townCharacter(
      townLookFor(key),
      "down",
      0,
      "stand",
      false,
    ).toDataURL();
    portraits.set(key, url);
  }
  return url;
}
