/**
 * Baked town layers: ground, building interiors, façades and roofs. Each is
 * painted once per layout into a canvas that the renderer uploads as one
 * texture, so per-frame work is limited to desks, agents and effects.
 */

import {
  TOWN_FACADE,
  TOWN_TILE as T,
  TownGround,
  type TownBuilding,
  type TownLayout,
} from "./townLayout";
import {
  townCanvas,
  townHash,
  townRandom,
  townShade,
  type TownCanvas,
} from "./townSprites";

export type TownHostTheme = {
  roof: string;
  wall: string;
  floor: string;
  brick: string;
};

export const TOWN_HOST_THEMES: readonly TownHostTheme[] = [
  { roof: "#55669a", wall: "#ebe0ca", floor: "#b98a5b", brick: "#a65a44" },
  { roof: "#9a5a4c", wall: "#dde3e4", floor: "#a18766", brick: "#6f6a86" },
  { roof: "#5b7a55", wall: "#e6dccb", floor: "#a98b6a", brick: "#8a6248" },
  { roof: "#7a5a92", wall: "#e9e2d4", floor: "#b4875f", brick: "#5f7a86" },
  { roof: "#a07a3c", wall: "#e3e0d2", floor: "#9c8466", brick: "#8a4e4e" },
  { roof: "#3d7c88", wall: "#ece4cf", floor: "#b08a60", brick: "#7d6a52" },
];

export const TOWN_CARPETS = [
  "#3d7c77",
  "#7a4f80",
  "#4e5e95",
  "#80693c",
  "#8b4e4e",
  "#4d7f56",
  "#6b5a8f",
  "#5c7a8c",
] as const;

export const townCarpetFor = (roomKey: string) =>
  TOWN_CARPETS[townHash(roomKey) % TOWN_CARPETS.length]!;

function ellipse(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
) {
  for (let y = -ry; y <= ry; y += 1) {
    const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))));
    g.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2, 1);
  }
}

export type TownRegion = { x: number; y: number; w: number; h: number };

const prepared = new Map<string, TownCanvas>();
/** Draw a small reusable canvas once per key. */
function preparedCanvas(
  key: string,
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D) => void,
) {
  let canvas = prepared.get(key);
  if (!canvas) {
    const [created, g] = townCanvas(w, h);
    draw(g);
    prepared.set(key, (canvas = created));
  }
  return canvas;
}

const GRASS_VARIANTS = 8;
function grassTile(variant: number) {
  return preparedCanvas(`grass:${variant}`, T, T, (g) => {
    const random = townRandom(variant * 7919 + 13);
    g.fillStyle = "#5c9a48";
    g.fillRect(0, 0, T, T);
    for (let i = 0; i < 7; i += 1) {
      g.fillStyle = random() < 0.5 ? "#538e41" : "#69a855";
      g.fillRect((random() * T) | 0, (random() * T) | 0, 1, 1);
    }
    if (variant % 3 === 0) {
      g.fillStyle = "#4a8239";
      const gx = (random() * 13) | 0;
      const gy = (random() * 12) | 0;
      g.fillRect(gx, gy, 1, 3);
      g.fillRect(gx + 2, gy + 1, 1, 2);
    }
    if (variant === 5 || variant === 7) {
      const colors = ["#fff5d6", "#f5e27a", "#f2a5c4", "#b9d4ff"];
      g.fillStyle = colors[variant % colors.length]!;
      const fx = 3 + ((random() * 8) | 0);
      const fy = 3 + ((random() * 8) | 0);
      g.fillRect(fx, fy, 1, 1);
      g.fillRect(fx + 3, fy + 2, 1, 1);
      g.fillRect(fx + 1, fy + 4, 1, 1);
    }
  });
}

function roadTile(variant: number) {
  return preparedCanvas(`road:${variant}`, T, T, (g) => {
    const random = townRandom(variant * 104729 + 7);
    g.fillStyle = "#4d5059";
    g.fillRect(0, 0, T, T);
    for (let i = 0; i < 6; i += 1) {
      g.fillStyle = random() < 0.5 ? "#575a63" : "#44474f";
      g.fillRect((random() * T) | 0, (random() * T) | 0, 1, 1);
    }
  });
}

const walkTile = () =>
  preparedCanvas("walk", T, T, (g) => {
    g.fillStyle = "#c9c0ab";
    g.fillRect(0, 0, T, T);
    g.fillStyle = "#b4aa93";
    g.fillRect(T - 1, 0, 1, T);
    g.fillRect(0, T - 1, T, 1);
    g.fillStyle = "#d6cfbc";
    g.fillRect(0, 0, T - 1, 1);
  });

const plazaTile = (odd: number) =>
  preparedCanvas(`plaza:${odd}`, T, T, (g) => {
    g.fillStyle = "#d5c8a9";
    g.fillRect(0, 0, T, T);
    g.fillStyle = "#c0b393";
    for (let yy = 0; yy < T; yy += 8) {
      g.fillRect(0, yy + 7, T, 1);
      const offset = ((odd * 2 + yy / 8) % 2) * 4;
      for (let xx = offset; xx < T; xx += 8) g.fillRect(xx, yy, 1, 7);
    }
  });

const tileHash = (tx: number, ty: number) =>
  (Math.imul(tx + 1, 73856093) ^ Math.imul(ty + 1, 19349663)) >>> 0;

/**
 * Paint one rectangular region (in pixels) of the ground. Each tile seeds its
 * own randomness, so regions paint identically in any order or size.
 */
export function paintTownGround(
  layout: TownLayout,
  region: TownRegion = {
    x: 0,
    y: 0,
    w: layout.width * T,
    h: layout.height * T,
  },
) {
  const { width, height, ground } = layout;
  const [canvas, g] = townCanvas(Math.max(1, region.w), Math.max(1, region.h));
  g.translate(-region.x, -region.y);
  const at = (tx: number, ty: number) => ground[ty * width + tx];
  const tx0 = Math.max(0, Math.floor(region.x / T));
  const ty0 = Math.max(0, Math.floor(region.y / T));
  const tx1 = Math.min(width, Math.ceil((region.x + region.w) / T));
  const ty1 = Math.min(height, Math.ceil((region.y + region.h) / T));
  for (let ty = ty0; ty < ty1; ty += 1)
    for (let tx = tx0; tx < tx1; tx += 1) {
      const type = at(tx, ty);
      const x = tx * T;
      const y = ty * T;
      const hash = tileHash(tx, ty);
      const tile =
        type === TownGround.grass || type === TownGround.building
          ? grassTile(hash % GRASS_VARIANTS)
          : type === TownGround.road
            ? roadTile(hash % 4)
            : type === TownGround.plaza
              ? plazaTile(ty % 2)
              : walkTile();
      g.drawImage(tile, x, y);
      if (
        ty > 0 &&
        type !== TownGround.grass &&
        type !== TownGround.building &&
        at(tx, ty - 1) === TownGround.grass
      ) {
        g.fillStyle = "rgba(30,50,20,.35)";
        g.fillRect(x, y, T, 2);
      }
    }
  const inRegion = (x0: number, y0: number, x1: number, y1: number) =>
    x1 >= region.x &&
    x0 <= region.x + region.w &&
    y1 >= region.y &&
    y0 <= region.y + region.h;
  for (const roadY of layout.roads) {
    if (!inRegion(0, roadY * T, width * T, (roadY + 5) * T)) continue;
    const cy = (roadY + 2) * T + 7;
    g.fillStyle = "#e8c75a";
    for (
      let x = Math.floor(region.x / 16) * 16;
      x < region.x + region.w;
      x += 16
    )
      g.fillRect(x + 3, cy, 9, 2);
    g.fillStyle = "#3f424a";
    g.fillRect(region.x, (roadY + 1) * T, region.w, 1);
    g.fillRect(region.x, (roadY + 4) * T - 1, region.w, 1);
  }
  g.fillStyle = "#e8c75a";
  for (const road of layout.verticalRoads) {
    if (!inRegion(road.x * T, road.y0 * T, (road.x + 5) * T, road.y1 * T))
      continue;
    for (let ty = Math.max(road.y0, ty0); ty < Math.min(road.y1, ty1); ty += 1)
      g.fillRect((road.x + 2) * T + 7, ty * T + 3, 2, 9);
  }
  for (const b of layout.buildings) {
    if (
      !inRegion(
        b.x * T,
        b.y * T - 4,
        (b.x + b.w) * T + 10,
        (b.y + b.h + TOWN_FACADE) * T + 8,
      )
    )
      continue;
    g.fillStyle = "rgba(0,0,0,.2)";
    g.fillRect(b.x * T + 10, b.y * T - 4, b.w * T, (b.h + TOWN_FACADE) * T + 8);
    g.fillStyle = "rgba(60,40,30,.55)";
    g.fillRect(b.doorX * T + 1, (b.y + b.h + TOWN_FACADE) * T, 14, 4);
  }
  g.fillStyle = "rgba(10,30,10,.22)";
  for (const tree of layout.trees) {
    const x = tree.x * T + 11;
    const y = tree.y * T + 15;
    if (inRegion(x - 13, y - 5, x + 13, y + 5)) ellipse(g, x, y, 13, 5);
  }
  return canvas;
}

function paintWindow(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  g.fillStyle = "#5b4535";
  g.fillRect(x, y, w, h);
  const sky = ["#8fd0f2", "#a9dcf5", "#c8eaf9"];
  for (let i = 0; i < h - 4; i += 1) {
    g.fillStyle = sky[Math.min(2, Math.floor(i / ((h - 4) / 3)))]!;
    g.fillRect(x + 2, y + 2 + i, w - 4, 1);
  }
  g.fillStyle = "rgba(255,255,255,.6)";
  g.fillRect(x + 4, y + 3, 1, 3);
  g.fillStyle = "#5b4535";
  g.fillRect(x + (w >> 1), y, 1, h);
  g.fillStyle = "#7a6250";
  g.fillRect(x - 1, y + h, w + 2, 2);
}

function carpet(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  stripes: boolean,
) {
  g.fillStyle = "rgba(0,0,0,.18)";
  g.fillRect(x + 1, y + 2, w, h);
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
  const dots = preparedCanvas(`carpet:${color}`, 4, 8, (p) => {
    p.fillStyle = townShade(color, -0.09);
    p.fillRect(0, 0, 1, 1);
    p.fillRect(2, 4, 1, 1);
  });
  g.save();
  g.translate(x + 6, y + 6);
  g.fillStyle = g.createPattern(dots, "repeat")!;
  g.fillRect(0, 0, Math.max(0, w - 12), Math.max(0, h - 12));
  g.restore();
  g.fillStyle = townShade(color, 0.2);
  g.fillRect(x + 2, y + 2, w - 4, 1);
  g.fillRect(x + 2, y + h - 3, w - 4, 1);
  g.fillRect(x + 2, y + 2, 1, h - 4);
  g.fillRect(x + w - 3, y + 2, 1, h - 4);
  g.fillStyle = townShade(color, -0.3);
  g.fillRect(x, y + h - 1, w, 1);
  g.clearRect(x, y, 1, 1);
  g.clearRect(x + w - 1, y, 1, 1);
  g.clearRect(x, y + h - 1, 1, 1);
  g.clearRect(x + w - 1, y + h - 1, 1, 1);
  if (stripes) {
    g.fillStyle = townShade(color, 0.12);
    for (let yy = 10; yy < h - 8; yy += 8) g.fillRect(x + 6, y + yy, w - 12, 2);
  }
}

/** Floor, back wall, carpets, lounge rug and reception lobby. */
export type TownFurniture = {
  table: Record<string, TownCanvas>;
  chair: TownCanvas;
  chairBack: TownCanvas;
  woodFor: (deskKey: string) => string;
};

export function paintTownInterior(
  building: TownBuilding,
  theme: TownHostTheme,
  furniture?: TownFurniture,
) {
  const Wp = building.w * T;
  const Hp = building.h * T;
  const [canvas, g] = townCanvas(Wp, Hp);
  const planks = preparedCanvas(`floor:${theme.floor}`, 78, 12, (p) => {
    const random = townRandom(townHash(theme.floor));
    for (let row = 0; row < 3; row += 1) {
      const y = row * 4;
      for (let x = -row * 9; x < 78; x += 26) {
        p.fillStyle = townShade(theme.floor, (random() - 0.5) * 0.09);
        p.fillRect(x, y, 26, 4);
        p.fillStyle = townShade(theme.floor, -0.24);
        p.fillRect(x, y, 1, 4);
      }
      p.fillStyle = townShade(theme.floor, -0.15);
      p.fillRect(0, y + 3, 78, 1);
    }
  });
  g.save();
  g.translate(0, 32);
  g.fillStyle = g.createPattern(planks, "repeat")!;
  g.fillRect(0, 0, Wp, Hp - 32);
  g.restore();
  g.fillStyle = theme.wall;
  g.fillRect(0, 0, Wp, 32);
  g.fillStyle = townShade(theme.wall, -0.045);
  for (let x = 0; x < Wp; x += 6) g.fillRect(x, 6, 2, 18);
  g.fillStyle = townShade(theme.wall, -0.45);
  g.fillRect(0, 24, Wp, 8);
  g.fillStyle = townShade(theme.wall, -0.28);
  g.fillRect(0, 24, Wp, 1);
  g.fillStyle = "#3a2f2b";
  g.fillRect(0, 0, Wp, 5);
  g.fillStyle = "#57483f";
  g.fillRect(0, 4, Wp, 1);
  let k = 0;
  for (let x = 26; x < Wp - 34; x += 54) {
    if (k % 3 === 1) {
      g.fillStyle = "#f4f6f7";
      g.fillRect(x, 8, 26, 13);
      g.fillStyle = "#9aa3ad";
      g.fillRect(x, 21, 26, 1);
      g.fillStyle = "#4f7cc9";
      g.fillRect(x + 3, 11, 9, 1);
      g.fillStyle = "#d9644a";
      g.fillRect(x + 3, 14, 14, 1);
      g.fillStyle = "#59a86b";
      g.fillRect(x + 3, 17, 7, 1);
    } else paintWindow(g, x, 8, 22, 14);
    k += 1;
  }
  g.fillStyle = "rgba(0,0,0,.18)";
  g.fillRect(0, 32, Wp, 3);
  const L = building.lounge;
  carpet(
    g,
    (L.x - building.x) * T + 3,
    (L.y - building.y) * T + 3,
    L.w * T - 6,
    L.h * T - 6,
    "#a35f46",
    true,
  );
  for (const room of building.rooms)
    carpet(
      g,
      (room.x - building.x) * T + 3,
      (room.y - building.y) * T + 3,
      room.w * T - 6,
      room.h * T - 6,
      townCarpetFor(room.key),
      false,
    );
  const lobby = (building.lobbyY - building.y) * T;
  g.fillStyle = "#d8d2c4";
  g.fillRect(6, lobby, Wp - 12, Hp - lobby);
  g.fillStyle = "#cdc6b6";
  for (let y = lobby; y < Hp; y += 16)
    for (let x = 6 + ((y / 16) % 2) * 16; x < Wp - 6; x += 32)
      g.fillRect(x, y, 16, 16);
  g.fillStyle = "rgba(0,0,0,.15)";
  g.fillRect(6, lobby, Wp - 12, 2);
  const queueX = (building.doorX - building.x - 6) * T;
  const queueY = (building.lobbyY - building.y + 4) * T - 2;
  g.fillStyle = "#8a2f2f";
  g.fillRect(queueX, queueY, 12 * T, 18);
  g.fillStyle = "#b44a3f";
  g.fillRect(queueX + 2, queueY + 2, 12 * T - 4, 14);
  g.fillStyle = "#e3aa3a";
  for (let x = queueX + 6; x < queueX + 12 * T - 6; x += 8)
    g.fillRect(x, queueY + 8, 4, 2);
  if (furniture)
    for (const room of building.rooms)
      for (const cell of room.cells) {
        if (!cell.deskKey) continue;
        const X = (cell.x + 1 - building.x) * T;
        const Y = (cell.y - building.y) * T;
        g.fillStyle = "rgba(0,0,0,.2)";
        g.fillRect(X + 3, Y + 50, 62, 4);
        g.drawImage(furniture.chair, X + 9, Y + 2);
        g.drawImage(furniture.chair, X + 41, Y + 2);
        const table = furniture.table[furniture.woodFor(cell.deskKey)];
        if (table) g.drawImage(table, X - 1, Y + 17);
        g.drawImage(furniture.chairBack, X + 9, Y + 45);
        g.drawImage(furniture.chairBack, X + 41, Y + 45);
      }
  g.fillStyle = "#3a2f2b";
  g.fillRect(0, 0, 6, Hp);
  g.fillRect(Wp - 6, 0, 6, Hp);
  g.fillStyle = "#57483f";
  g.fillRect(5, 5, 1, Hp - 5);
  g.fillRect(Wp - 6, 5, 1, Hp - 5);
  return canvas;
}

/** Front wall below the building footprint, 32 px tall. */
export function paintTownFacade(building: TownBuilding, theme: TownHostTheme) {
  const Wp = building.w * T;
  const [canvas, g] = townCanvas(Wp, 32);
  const random = townRandom(townHash(building.hostKey) + 5);
  g.fillStyle = theme.brick;
  g.fillRect(0, 0, Wp, 32);
  for (let y = 4; y < 29; y += 4) {
    for (let x = ((y / 4) % 2) * 4 - 8; x < Wp; x += 8) {
      g.fillStyle = townShade(theme.brick, (random() - 0.5) * 0.14);
      g.fillRect(x + 1, y - 3, 7, 3);
    }
    g.fillStyle = townShade(theme.brick, -0.28);
    g.fillRect(0, y, Wp, 1);
    for (let x = ((y / 4) % 2) * 4; x < Wp; x += 8) g.fillRect(x, y - 3, 1, 3);
  }
  g.fillStyle = townShade(theme.brick, -0.45);
  g.fillRect(0, 0, Wp, 3);
  g.fillStyle = townShade(theme.brick, 0.22);
  g.fillRect(0, 3, Wp, 1);
  g.fillStyle = "#857a6c";
  g.fillRect(0, 27, Wp, 5);
  g.fillStyle = "#9a8f80";
  g.fillRect(0, 27, Wp, 1);
  const dx = (building.doorX - building.x) * T;
  for (let x = 14; x < Wp - 20; x += 36) {
    if (Math.abs(x - dx) < 26) continue;
    g.fillStyle = "#4a3a30";
    g.fillRect(x - 1, 8, 18, 14);
    g.fillStyle = "#ffe39a";
    g.fillRect(x + 1, 10, 14, 10);
    g.fillStyle = "#f2c46a";
    g.fillRect(x + 1, 16, 14, 4);
    g.fillStyle = "#4a3a30";
    g.fillRect(x + 7, 10, 1, 10);
    g.fillStyle = "#6d5a4a";
    g.fillRect(x - 2, 22, 20, 2);
  }
  g.fillStyle = "#4a3a30";
  g.fillRect(dx - 2, 7, 20, 21);
  g.fillStyle = "#22180f";
  g.fillRect(dx + 1, 10, 14, 18);
  g.fillStyle = theme.roof;
  g.fillRect(dx - 5, 4, 26, 5);
  g.fillStyle = townShade(theme.roof, 0.3);
  for (let x = dx - 5; x < dx + 21; x += 4) g.fillRect(x, 4, 2, 5);
  g.fillStyle = townShade(theme.roof, -0.4);
  g.fillRect(dx - 5, 9, 26, 1);
  return canvas;
}

/** Roof covering the footprint, with a 4 px overhang and 12 px ridge above. */
export function paintTownRoof(
  building: TownBuilding,
  theme: TownHostTheme,
  stale: boolean,
) {
  const Wp = building.w * T + 8;
  const Hp = building.h * T + 12;
  const [canvas, g] = townCanvas(Wp, Hp);
  const base = stale ? townShade(theme.roof, -0.35) : theme.roof;
  for (let y = 0; y < Hp; y += 6) {
    const row = townShade(base, 0.14 - (y / Hp) * 0.3);
    g.fillStyle = row;
    g.fillRect(0, y, Wp, 6);
    g.fillStyle = townShade(row, -0.24);
    g.fillRect(0, y + 5, Wp, 1);
  }
  // Shingle edges and a few lighter tiles, staggered on alternate rows.
  const shingles = preparedCanvas("shingles", 32, 12, (p) => {
    const random = townRandom(11);
    for (let row = 0; row < 2; row += 1)
      for (let x = row * 4; x < 32; x += 8) {
        p.fillStyle = "rgba(0,0,0,.16)";
        p.fillRect(x, row * 6, 1, 5);
        if (random() < 0.12) {
          p.fillStyle = "rgba(255,255,255,.08)";
          p.fillRect(x + 1, row * 6, 7, 5);
        }
      }
  });
  g.fillStyle = g.createPattern(shingles, "repeat")!;
  g.fillRect(0, 0, Wp, Hp);
  g.fillStyle = townShade(base, 0.3);
  g.fillRect(0, 0, Wp, 3);
  g.fillStyle = townShade(base, -0.4);
  g.fillRect(0, 0, 2, Hp);
  g.fillRect(Wp - 2, 0, 2, Hp);
  g.fillRect(0, Hp - 3, Wp, 3);
  const unit = (ax: number, ay: number) => {
    g.fillStyle = "rgba(0,0,0,.25)";
    g.fillRect(ax + 3, ay + 3, 26, 18);
    g.fillStyle = "#b8bec7";
    g.fillRect(ax, ay, 26, 18);
    g.fillStyle = "#d6dbe1";
    g.fillRect(ax, ay, 26, 3);
    g.fillStyle = "#8a919b";
    for (let i = 0; i < 4; i += 1) g.fillRect(ax + 3, ay + 6 + i * 3, 20, 1);
  };
  unit(Wp - 46, 20);
  unit(40, 24);
  for (let i = 0; i < Math.floor(Wp / 140); i += 1) {
    const sx = 30 + i * 140;
    const sy = Hp - 48;
    g.fillStyle = "rgba(0,0,0,.25)";
    g.fillRect(sx + 2, sy + 2, 30, 18);
    g.fillStyle = "#6b5a4a";
    g.fillRect(sx, sy, 30, 18);
    g.fillStyle = "#86c3e2";
    g.fillRect(sx + 2, sy + 2, 26, 14);
  }
  return canvas;
}
