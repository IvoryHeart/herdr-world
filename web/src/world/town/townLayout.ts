/**
 * Pure Office town layout.
 *
 * Hosts become buildings, workspaces become rooms on carpets and tabs become
 * team tables in desk cells. Desk slots follow Herdr's tab order. The
 * placement memory keeps each room's size while a scene is live, and every
 * room capacity step contains the previous one.
 */

export const TOWN_TILE = 16;

/**
 * The usual expanded presentation target. Admission can exceed it for protected
 * desks; layout extends downward for every admitted desk and one free cell.
 */
export const TOWN_DEFAULT_RENDERED_DESKS = 8 * 16 - 1;

/**
 * Capacity steps as [columns, rows] for rooms at most `maxCols` desks wide;
 * each step contains the previous one. A room grows square until it is that
 * wide, then extends downward, until it holds every drawn desk and its free
 * spot, so agents that spawn agents never run out of desks at real scale.
 */
export function townRoomTiers(
  maxCols: number,
  desks = TOWN_DEFAULT_RENDERED_DESKS,
  minimumTier = 0,
): readonly (readonly [number, number])[] {
  const tiers = tierCache.get(maxCols) ?? [[2, 1] as const];
  let [cols, rows] = tiers[tiers.length - 1]!;
  const need = Math.max(TOWN_DEFAULT_RENDERED_DESKS + 1, desks + 1);
  while (cols * rows < need || tiers.length <= minimumTier) {
    if (rows < cols || cols >= maxCols) rows += 1;
    else cols += 1;
    tiers.push([cols, rows]);
  }
  tierCache.set(maxCols, tiers);
  return tiers;
}
const tierCache = new Map<number, (readonly [number, number])[]>();

/** The wide shape's steps: eight desks wide, then downward. */
export const TOWN_ROOM_TIERS = townRoomTiers(8);

/**
 * How the town fits its container: how many columns of rooms a building has,
 * how wide a room may grow before it extends downward, and whether buildings
 * stand side by side on one street (`wide`) or stack (`narrow`).
 */
export type TownShape = {
  formFactor: TownFormFactor;
  roomColumns: number;
  deskColumns: number;
};

export const TOWN_SHAPES = {
  /** Phones: one column of rooms, four desks wide, buildings stacked. */
  phone: { formFactor: "narrow", roomColumns: 1, deskColumns: 4 },
  /** Portrait monitors and half-width windows: two columns, stacked. */
  portrait: { formFactor: "narrow", roomColumns: 2, deskColumns: 6 },
  /** Mid-width landscape windows: buildings on one street, two columns. */
  medium: { formFactor: "wide", roomColumns: 2, deskColumns: 6 },
  /** Wide screens: three columns of rooms up to eight desks wide. */
  wide: { formFactor: "wide", roomColumns: 3, deskColumns: 8 },
} as const satisfies Record<string, TownShape>;

/** The shape for a container of this size in CSS pixels. */
export function townShapeFor(width: number, height: number): TownShape {
  if (width < 640) return TOWN_SHAPES.phone;
  if (height > width * 1.05) return TOWN_SHAPES.portrait;
  if (width < 1200) return TOWN_SHAPES.medium;
  return TOWN_SHAPES.wide;
}

const shapeOf = (shape: TownFormFactor | TownShape): TownShape =>
  typeof shape === "string"
    ? shape === "narrow"
      ? TOWN_SHAPES.phone
      : TOWN_SHAPES.wide
    : shape;

/** A shape's identity: placement memory is kept per shape. */
export const townShapeKey = (shape: TownShape) =>
  `${shape.formFactor}:${shape.roomColumns}:${shape.deskColumns}`;

const CELL = 5; // tiles per desk cell: aisle column plus a four-tile table
const LOUNGE = { x: 2, y: 2, w: 12, h: 6 } as const;
const ROOM_TOP = 9;
const LOBBY_HEIGHT = 7;
const MIN_BUILDING_WIDTH = 38;
/** A phone's one-column building: the lounge, counter and queue still fit. */
const MIN_PHONE_BUILDING_WIDTH = 26;
const MARGIN = 3;
const ROAD_GAP = 5;
export const TOWN_FACADE = 2;

/**
 * Agents are drawn larger than the furniture's pixel grid so they read as the
 * subject of a room, not as props. Hit-testing and drawing share it.
 */
export const TOWN_AGENT_SCALE = 1.4;
const YARD = 2;
const PARK_HEIGHT = 12;
const QUEUE_OFFSETS = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5];

export type TownFormFactor = "wide" | "narrow";

export const TownGround = {
  grass: 0,
  road: 1,
  walk: 2,
  plaza: 3,
  building: 4,
  facade: 5,
} as const;

export type TownPoint = { x: number; y: number };
export type TownSpot = TownPoint & { face: "up" | "down" | "left" | "right" };

export type TownCell = {
  col: number;
  row: number;
  /** Absolute tile coordinate of the cell's top-left (its aisle column). */
  x: number;
  y: number;
  deskKey: string | null;
  /** Seats at the desk's table: 1 solo, 2 face to face, 3-4 a team table. */
  seats: number;
};

export type TownRoom = {
  key: string;
  hostKey: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cols: number;
  rows: number;
  cells: TownCell[];
  /** Two adjacent bottom-right cells reserved for the seat and fold controls. */
  foldActionCells?: readonly [TownCell, TownCell];
  /** Desks beyond the rendered capacity, reachable through the chooser. */
  overflowDeskKeys: string[];
};

export type TownBuilding = {
  hostKey: string;
  x: number;
  y: number;
  w: number;
  h: number;
  doorX: number;
  lobbyY: number;
  roadY: number;
  lounge: { x: number; y: number; w: number; h: number; spots: TownSpot[] };
  /** Reception counter tiles (left x, row y, width). */
  counter: { x: number; y: number; w: number };
  queue: TownSpot[];
  plants: TownPoint[];
  rooms: TownRoom[];
};

export type TownTree = TownPoint & { variant: number; seed: number };

export type TownLayout = {
  formFactor: TownFormFactor;
  /** The container shape the town was laid out for. */
  shape: TownShape;
  /** Size in tiles. */
  width: number;
  height: number;
  ground: Uint8Array;
  buildings: TownBuilding[];
  roads: number[];
  verticalRoads: { x: number; y0: number; y1: number }[];
  plaza: TownPoint;
  board: TownPoint;
  benches: TownPoint[];
  lamps: TownPoint[];
  bushes: TownPoint[];
  trees: TownTree[];
  /** Desk key to room key and cell index. */
  deskCells: ReadonlyMap<string, { roomKey: string; cellIndex: number }>;
};

export type TownInputRoom = {
  /** Explicit Fold may shrink a room; ordinary tab closures keep its tier. */
  deskFold?: "folded" | "expanded";
  key: string;
  hostKey: string;
  order: number;
  /** Desk keys in native tab order. */
  deskKeys: readonly string[];
  /** Seats per desk (its panes, at most four); a desk without one has four. */
  deskSeats?: readonly number[];
};

export type TownInputHost = { key: string; displayOrder: number };

export type TownInput = {
  hosts: readonly TownInputHost[];
  rooms: readonly TownInputRoom[];
};

type RoomMemory = {
  deskFold?: "folded" | "expanded";
  tier: number;
  cells: Map<string, { col: number; row: number }>;
  /** The building column the room keeps while the scene is live. */
  column?: number;
};

/**
 * Pinned desks' cells by desk key. A null cell (a desk just pinned) keeps the
 * cell the desk has in this scene until Town saves it.
 */
export type TownPinnedCells = ReadonlyMap<
  string,
  { col: number; row: number } | null
>;

/** Placement memory carried between layouts of one live scene. */
export type TownPlacementMemory = Map<string, RoomMemory>;

export function townTierFor(
  desks: number,
  minimumTier = 0,
  tiers = townRoomTiers(8, desks, minimumTier),
) {
  const need = desks + 1;
  let tier = Math.min(Math.max(0, minimumTier), tiers.length - 1);
  while (tier < tiers.length - 1 && tiers[tier]![0] * tiers[tier]![1] < need)
    tier += 1;
  return tier;
}

/**
 * Assign desks to grid coordinates. Desk slots follow Herdr's tab order: the
 * i-th tab takes the i-th cell in reading order, so a reorder in Herdr, Spaces
 * or Town moves desks, and a closed desk leaves no gap. The room only grows
 * while a scene is live, so its walls never jump when a desk closes.
 *
 * A pinned desk keeps its cell whatever the tab order or room size, and the
 * room grows to hold it; the other desks take the free cells in tab order.
 */
function placeRoomDesks(
  deskKeys: readonly string[],
  previous: RoomMemory | undefined,
  maxCols: number,
  pins: TownPinnedCells | undefined,
  reserveFoldActions: boolean,
): { memory: RoomMemory; overflow: string[]; cols: number; rows: number } {
  const fixed = new Map<string, { col: number; row: number }>();
  if (pins?.size)
    for (const key of deskKeys) {
      if (!pins.has(key)) continue;
      const cell = pins.get(key) ?? previous?.cells.get(key);
      if (cell && cell.col < maxCols) fixed.set(key, cell);
    }
  const needed = Math.max(
    deskKeys.length + (reserveFoldActions ? 2 : 1),
    ...[...fixed.values()].map(({ row }) => (row + 1) * maxCols - 1),
  );
  const tiers = townRoomTiers(maxCols, needed, previous?.tier ?? 0);
  let tier = townTierFor(
    deskKeys.length + (reserveFoldActions ? 1 : 0),
    previous?.tier ?? 0,
    tiers,
  );
  const outside = (tier: number) =>
    [...fixed.values()].some(
      ({ col, row }) => col >= tiers[tier]![0] || row >= tiers[tier]![1],
    );
  while (
    tier < tiers.length - 1 &&
    (outside(tier) ||
      (reserveFoldActions &&
        [...fixed.values()].some(
          ({ col, row }) =>
            row * tiers[tier]![0] + col >=
            tiers[tier]![0] * tiers[tier]![1] - 2,
        )))
  )
    tier += 1;
  const [cols, rows] = tiers[tier]!;
  const capacity = cols * rows - (reserveFoldActions ? 2 : 1);
  const cells = new Map<string, { col: number; row: number }>();
  const taken = new Set<number>();
  for (const [key, { col, row }] of fixed) {
    const index = row * cols + col;
    if (col >= cols || row >= rows || taken.has(index)) continue;
    if (cells.size >= capacity) break;
    cells.set(key, { col, row });
    taken.add(index);
  }
  const overflow: string[] = [];
  let index = 0;
  for (const key of deskKeys) {
    if (cells.has(key)) continue;
    if (cells.size >= capacity) {
      overflow.push(key);
      continue;
    }
    while (taken.has(index)) index += 1;
    cells.set(key, { col: index % cols, row: Math.floor(index / cols) });
    taken.add(index);
  }
  return { memory: { tier, cells }, overflow, cols, rows };
}

function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type DraftBuilding = Omit<TownBuilding, "x" | "y" | "roadY" | "rooms"> & {
  rooms: (Omit<TownRoom, "x" | "y" | "cells"> & {
    deskFold?: "folded" | "expanded";
    rx: number;
    ry: number;
    placement: Map<string, { col: number; row: number }>;
  })[];
};

function draftBuilding(
  hostKey: string,
  rooms: readonly TownInputRoom[],
  memory: TownPlacementMemory,
  nextMemory: TownPlacementMemory,
  shape: TownShape,
  pins: TownPinnedCells | undefined,
): DraftBuilding {
  const placed = rooms.map((room) => {
    const previous = memory.get(room.key);
    const folded =
      previous?.deskFold === "expanded" && room.deskFold !== "expanded";
    const {
      memory: roomMemory,
      overflow,
      cols,
      rows,
    } = placeRoomDesks(
      room.deskKeys,
      folded ? { ...previous, tier: 0 } : previous,
      shape.deskColumns,
      pins,
      !!room.deskFold,
    );
    roomMemory.deskFold = room.deskFold;
    nextMemory.set(room.key, roomMemory);
    return {
      key: room.key,
      hostKey,
      deskFold: room.deskFold,
      cols,
      rows,
      w: cols * CELL + 1,
      h: rows * CELL + 1,
      overflowDeskKeys: overflow,
      placement: roomMemory.cells,
      rx: 0,
      ry: 0,
    };
  });
  // Rooms stack in columns, in workspace order. Each room keeps the column it
  // was given while the scene is live (a new one joins the shortest), so a
  // room that grows moves only the rooms below it in its own column.
  const columnCount = Math.max(1, Math.min(shape.roomColumns, placed.length));
  const columns: (typeof placed)[] = Array.from(
    { length: columnCount },
    () => [],
  );
  const heights = new Array<number>(columnCount).fill(0);
  for (const room of placed) {
    const kept = memory.get(room.key)?.column;
    const column =
      kept !== undefined && kept < columnCount
        ? kept
        : heights.indexOf(Math.min(...heights));
    columns[column]!.push(room);
    heights[column]! += room.h + 2;
    nextMemory.get(room.key)!.column = column;
  }
  let x = 2;
  let bottom = ROOM_TOP;
  for (const column of columns) {
    let y = ROOM_TOP;
    let widest = 0;
    for (const room of column) {
      room.rx = x;
      room.ry = y;
      y += room.h + 2;
      widest = Math.max(widest, room.w);
    }
    bottom = Math.max(bottom, y);
    if (column.length) x += widest + 2;
  }
  const w = Math.max(
    x,
    shape.formFactor === "narrow" && shape.roomColumns === 1
      ? MIN_PHONE_BUILDING_WIDTH
      : MIN_BUILDING_WIDTH,
  );
  const lobbyY = bottom;
  const doorX = Math.floor(w / 2);
  return {
    hostKey,
    w,
    h: lobbyY + LOBBY_HEIGHT,
    doorX,
    lobbyY,
    lounge: { ...LOUNGE, spots: [] },
    counter: { x: doorX - 3, y: lobbyY + 1, w: 5 },
    queue: [],
    plants: [],
    rooms: placed,
  };
}

/** Lay out the whole town; returns the layout and the memory for the next pass. */
export function layoutTown(
  input: TownInput,
  shapeOrFormFactor: TownShape | TownFormFactor,
  memory: TownPlacementMemory = new Map(),
  pins?: TownPinnedCells,
): { layout: TownLayout; memory: TownPlacementMemory } {
  const shape = shapeOf(shapeOrFormFactor);
  const formFactor = shape.formFactor;
  const nextMemory: TownPlacementMemory = new Map();
  const hosts = [...input.hosts].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.key.localeCompare(b.key),
  );
  const drafts = hosts.map((host) =>
    draftBuilding(
      host.key,
      input.rooms
        .filter((room) => room.hostKey === host.key)
        .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key)),
      memory,
      nextMemory,
      shape,
      pins,
    ),
  );
  const seatsOf = new Map<string, number>();
  for (const room of input.rooms)
    room.deskKeys.forEach((key, index) =>
      seatsOf.set(key, room.deskSeats?.[index] ?? 4),
    );
  // Up to four hosts share one street; larger towns wrap into a grid of streets.
  const perRow =
    formFactor === "narrow"
      ? 1
      : drafts.length <= 4
        ? Math.max(1, drafts.length)
        : Math.ceil(Math.sqrt(drafts.length * 1.6));
  const rowsOfBuildings: DraftBuilding[][] = [];
  for (let i = 0; i < drafts.length; i += perRow)
    rowsOfBuildings.push(drafts.slice(i, i + perRow));
  const placedBuildings: (DraftBuilding & {
    x: number;
    y: number;
    roadY: number;
  })[] = [];
  const roads: number[] = [];
  const verticalRoads: TownLayout["verticalRoads"] = [];
  const widestDraft = Math.max(0, ...drafts.map((draft) => draft.w));
  let y = MARGIN + 2;
  let width = MARGIN;
  for (const row of rowsOfBuildings) {
    if (!row.length) continue;
    const tallest = Math.max(...row.map((b) => b.h));
    const roadY = y + tallest + TOWN_FACADE + YARD;
    // A single stacked building is centred on the street so every floor plan
    // shares one vertical axis on phones.
    let x =
      row.length === 1
        ? MARGIN + Math.floor((widestDraft - row[0]!.w) / 2)
        : MARGIN;
    row.forEach((draft, index) => {
      placedBuildings.push({ ...draft, x, y: y + (tallest - draft.h), roadY });
      x += draft.w;
      if (index < row.length - 1) {
        verticalRoads.push({ x, y0: y - 1, y1: roadY });
        x += ROAD_GAP;
      }
    });
    width = Math.max(width, x);
    roads.push(roadY);
    // Stacked phone streets leave room for the reception board under each building.
    y = roadY + ROAD_GAP + (formFactor === "narrow" ? 8 : 2);
  }
  if (!roads.length) roads.push(MARGIN + 2);
  width = Math.max(width + MARGIN, 40);
  const lastRoad = roads[roads.length - 1]!;
  const height = lastRoad + ROAD_GAP + PARK_HEIGHT + MARGIN;
  const ground = new Uint8Array(width * height);
  const set = (tx: number, ty: number, type: number) => {
    if (tx >= 0 && ty >= 0 && tx < width && ty < height)
      ground[ty * width + tx] = type;
  };
  const get = (tx: number, ty: number) =>
    tx >= 0 && ty >= 0 && tx < width && ty < height
      ? ground[ty * width + tx]!
      : -1;
  // Sidewalks first, then carriageways, so crossings stay road.
  const strip = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    type: number,
  ) => {
    for (let ty = Math.max(0, y0); ty < Math.min(height, y1); ty += 1)
      for (let tx = Math.max(0, x0); tx < Math.min(width, x1); tx += 1) {
        if (
          type === TownGround.walk &&
          ground[ty * width + tx] === TownGround.road
        )
          continue;
        ground[ty * width + tx] = type;
      }
  };
  for (const ry of roads) {
    strip(0, ry, width, ry + 1, TownGround.walk);
    strip(0, ry + 4, width, ry + 5, TownGround.walk);
  }
  for (const v of verticalRoads) {
    strip(v.x, v.y0, v.x + 1, v.y1, TownGround.walk);
    strip(v.x + 4, v.y0, v.x + 5, v.y1, TownGround.walk);
  }
  for (const ry of roads) strip(0, ry + 1, width, ry + 4, TownGround.road);
  for (const v of verticalRoads)
    strip(v.x + 1, v.y0, v.x + 4, v.y1, TownGround.road);

  const bushes: TownPoint[] = [];
  const buildings: TownBuilding[] = placedBuildings.map((draft) => {
    const { x: bx, y: by } = draft;
    for (let ty = by; ty < by + draft.h + TOWN_FACADE; ty += 1)
      for (let tx = bx; tx < bx + draft.w; tx += 1)
        set(
          tx,
          ty,
          ty < by + draft.h ? TownGround.building : TownGround.facade,
        );
    for (let tx = bx - 1; tx <= bx + draft.w; tx += 1)
      set(tx, by + draft.h + TOWN_FACADE, TownGround.walk);
    const doorX = bx + draft.doorX;
    for (let ty = by + draft.h + TOWN_FACADE; ty < draft.roadY; ty += 1)
      set(doorX, ty, TownGround.walk);
    bushes.push(
      { x: doorX - 2, y: by + draft.h + TOWN_FACADE },
      { x: doorX + 2, y: by + draft.h + TOWN_FACADE },
    );
    const lounge = {
      x: bx + LOUNGE.x,
      y: by + LOUNGE.y,
      w: LOUNGE.w,
      h: LOUNGE.h,
      spots: (
        [
          [1, 3, "up"],
          [3, 3, "up"],
          [5, 3, "right"],
          [7, 2, "up"],
          [8, 2, "up"],
          [9, 3, "left"],
          [2, 4, "down"],
          [4, 4, "right"],
          [6, 4, "left"],
          [8, 4, "down"],
          [10, 4, "left"],
          [10, 2, "down"],
        ] as const
      ).map(([dx, dy, face]) => ({
        x: bx + LOUNGE.x + dx,
        y: by + LOUNGE.y + dy,
        face,
      })),
    };
    const lobbyY = by + draft.lobbyY;
    const rooms: TownRoom[] = draft.rooms.map((room) => {
      const rx = bx + room.rx;
      const ry = by + room.ry;
      const byCoordinate = new Map<string, string>();
      for (const [deskKey, at] of room.placement)
        byCoordinate.set(`${at.col},${at.row}`, deskKey);

      const cells: TownCell[] = [];
      for (let row = 0; row < room.rows; row += 1)
        for (let col = 0; col < room.cols; col += 1)
          cells.push({
            col,
            row,
            x: rx + col * CELL,
            y: ry + 1 + row * CELL,
            deskKey: byCoordinate.get(`${col},${row}`) ?? null,
            seats: seatsOf.get(byCoordinate.get(`${col},${row}`) ?? "") ?? 4,
          });
      const foldActionCells = room.deskFold
        ? ([cells[cells.length - 2]!, cells[cells.length - 1]!] as const)
        : undefined;
      return {
        key: room.key,
        hostKey: room.hostKey,
        x: rx,
        y: ry,
        w: room.w,
        h: room.h,
        cols: room.cols,
        rows: room.rows,
        cells,
        foldActionCells,
        overflowDeskKeys: room.overflowDeskKeys,
      };
    });
    return {
      hostKey: draft.hostKey,
      x: bx,
      y: by,
      w: draft.w,
      h: draft.h,
      doorX,
      lobbyY,
      roadY: draft.roadY,
      lounge,
      counter: { x: bx + draft.counter.x, y: lobbyY + 1, w: draft.counter.w },
      queue: QUEUE_OFFSETS.map((offset) => ({
        x: doorX - 1 + offset,
        y: lobbyY + 4,
        face: "up" as const,
      })),
      plants: [
        { x: bx + 1, y: by + 2 },
        { x: bx + draft.w - 2, y: by + 2 },
        { x: bx + 1, y: by + draft.h - 1 },
        { x: bx + draft.w - 2, y: by + draft.h - 1 },
        { x: bx + 15, y: by + 2 },
        { x: bx + draft.w - 5, y: by + 2 },
        { x: doorX - 8, y: lobbyY + 1 },
        { x: doorX + 7, y: lobbyY + 1 },
      ],
      rooms,
    };
  });

  const plaza = { x: Math.floor(width / 2), y: lastRoad + ROAD_GAP + 6 };
  for (let ty = plaza.y - 5; ty <= plaza.y + 5; ty += 1)
    for (let tx = plaza.x - 8; tx <= plaza.x + 8; tx += 1)
      if (((tx - plaza.x) / 8) ** 2 + ((ty - plaza.y) / 5.2) ** 2 <= 1)
        set(tx, ty, TownGround.plaza);
  for (let ty = lastRoad + ROAD_GAP; ty < plaza.y - 4; ty += 1)
    set(plaza.x, ty, TownGround.walk);
  for (let tx = MARGIN; tx < width - MARGIN; tx += 1)
    if (get(tx, plaza.y) === TownGround.grass)
      set(tx, plaza.y, TownGround.walk);

  const lamps: TownPoint[] = [];
  for (const ry of roads)
    for (let tx = 6; tx < width - 4; tx += 11) {
      if (verticalRoads.some((v) => tx >= v.x - 1 && tx <= v.x + 5)) continue;
      if (get(tx, ry) === TownGround.walk) lamps.push({ x: tx, y: ry });
    }

  const random = mulberry32(42);
  const trees: TownTree[] = [];
  const treeAt = new Set<number>();
  const nearBuilding = (tx: number, ty: number) =>
    buildings.some(
      (b) =>
        tx >= b.x - 2 &&
        tx <= b.x + b.w + 1 &&
        ty >= b.y - 3 &&
        ty <= b.y + b.h + TOWN_FACADE + YARD,
    );
  const clearAround = (tx: number, ty: number) => {
    for (let dy = -1; dy <= 1; dy += 1)
      for (let dx = -1; dx <= 1; dx += 1) {
        const type = get(tx + dx, ty + dy);
        if (type !== -1 && type !== TownGround.grass) return false;
      }
    return true;
  };
  for (let ty = 1; ty < height; ty += 1)
    for (let tx = 0; tx < width; tx += 1) {
      const edge = tx < 2 || ty < 2 || tx > width - 3 || ty > height - 3;
      if (random() > (edge ? 0.42 : 0.07)) continue;
      if (!clearAround(tx, ty) || nearBuilding(tx, ty)) continue;
      if (Math.hypot((tx - plaza.x) / 1.2, (ty - plaza.y) * 1.25) < 10)
        continue;
      const spacing = edge ? 1.8 : 3.2;
      let crowded = false;
      for (let dy = -3; dy <= 3 && !crowded; dy += 1)
        for (let dx = -3; dx <= 3 && !crowded; dx += 1)
          if (
            treeAt.has((ty + dy) * width + tx + dx) &&
            Math.hypot(dx, dy) < spacing
          )
            crowded = true;
      if (crowded) continue;
      const variant = random() < 0.12 ? 2 : random() < 0.5 ? 1 : 0;
      trees.push({ x: tx, y: ty, variant, seed: random() * 10 });
      treeAt.add(ty * width + tx);
    }

  const deskCells = new Map<string, { roomKey: string; cellIndex: number }>();
  for (const building of buildings)
    for (const room of building.rooms)
      room.cells.forEach((cell, cellIndex) => {
        if (cell.deskKey)
          deskCells.set(cell.deskKey, { roomKey: room.key, cellIndex });
      });

  return {
    layout: {
      formFactor,
      shape,
      width,
      height,
      ground,
      buildings,
      roads,
      verticalRoads,
      plaza,
      board: { x: plaza.x + 4, y: plaza.y - 2 },
      benches: [
        { x: plaza.x - 6, y: plaza.y + 2 },
        { x: plaza.x + 3, y: plaza.y + 3 },
      ],
      lamps,
      bushes,
      trees,
      deskCells,
    },
    memory: nextMemory,
  };
}

export type TownDeskSlot = {
  /** A top seat faces the viewer; a bottom seat shows its back. */
  top: boolean;
  /** Chair's left edge, in pixels from the table's left edge. */
  chairX: number;
};

const SOLO: readonly TownDeskSlot[] = [{ top: true, chairX: 25 }];
const PAIR: readonly TownDeskSlot[] = [
  { top: true, chairX: 25 },
  { top: false, chairX: 25 },
];
const TEAM: readonly TownDeskSlot[] = [
  { top: true, chairX: 9 },
  { top: true, chairX: 41 },
  { top: false, chairX: 9 },
  { top: false, chairX: 41 },
];

/**
 * A desk's furniture follows its panes: one pane is a solo desk, two sit face
 * to face at a small table, and three or four share a team table.
 */
export function townDeskSlots(seats: number): readonly TownDeskSlot[] {
  return seats <= 1 ? SOLO : seats === 2 ? PAIR : TEAM;
}

/** The table's left edge and width, in pixels from the desk's left edge. */
export function townDeskTable(seats: number) {
  return seats <= 2 ? { x: 14, w: 36 } : { x: -1, w: 64 };
}

/** Seat geometry for one desk cell, in pixels. Top seats face the viewer. */
export function townSeat(cell: TownCell, seat: number) {
  const X = (cell.x + 1) * TOWN_TILE;
  const Y = cell.y * TOWN_TILE;
  const slot = townDeskSlots(cell.seats)[seat] ?? TEAM[seat % 4]!;
  const top = slot.top;
  const cx = X + slot.chairX + 7;
  return {
    tableX: X,
    tableY: Y,
    cx,
    top,
    /** Aisle tile the agent walks to before sliding into the seat. */
    entry: {
      x: slot.chairX > 25 ? cell.x + 5 : cell.x,
      y: top ? cell.y : cell.y + 3,
    },
    /** Feet position while seated. */
    seatedY: top ? Y + 12 : Y + 60,
  };
}

/**
 * Where rooms and buildings stand, ignoring which desk sits where: two
 * layouts with the same key differ only inside rooms.
 */
export function townGeometryKey(layout: TownLayout): string {
  return layout.buildings
    .map(
      (b) =>
        `${b.hostKey}@${b.x},${b.y},${b.w},${b.h}:${b.rooms.map((r) => `${r.key}@${r.x},${r.y},${r.w},${r.h}`).join("|")}`,
    )
    .join(";");
}

/**
 * How far (in world pixels) the room nearest world point `at` moved between
 * two layouts, so the camera can follow it and what the user watches stays
 * put when the town reflows. Zero when that room is gone.
 */
export function townReflowShift(
  previous: TownLayout,
  next: TownLayout,
  at: TownPoint,
): TownPoint {
  let nearest: TownRoom | null = null;
  let best = Infinity;
  for (const building of previous.buildings)
    for (const room of building.rooms) {
      const distance = Math.hypot(
        Math.max(
          room.x * TOWN_TILE - at.x,
          0,
          at.x - (room.x + room.w) * TOWN_TILE,
        ),
        Math.max(
          room.y * TOWN_TILE - at.y,
          0,
          at.y - (room.y + room.h) * TOWN_TILE,
        ),
      );
      if (distance < best) {
        best = distance;
        nearest = room;
      }
    }
  const moved = nearest
    ? next.buildings
        .flatMap((b) => b.rooms)
        .find((room) => room.key === nearest!.key)
    : undefined;
  return nearest && moved
    ? {
        x: (moved.x - nearest.x) * TOWN_TILE,
        y: (moved.y - nearest.y) * TOWN_TILE,
      }
    : { x: 0, y: 0 };
}

/**
 * The cell a desk being pinned keeps: where the user sees it. While a reflow
 * is held (TownCanvas) that is the visible layout, not the pending one; a
 * desk the visible layout lacks takes its pending cell.
 */
export function townPinCell(
  visible: TownLayout,
  pending: TownLayout,
  deskKey: string,
): { col: number; row: number } | null {
  for (const layout of [visible, pending]) {
    const at = layout.deskCells.get(deskKey);
    const cell = at
      ? layout.buildings
          .flatMap((building) => building.rooms)
          .find((room) => room.key === at.roomKey)?.cells[at.cellIndex]
      : undefined;
    if (cell) return { col: cell.col, row: cell.row };
  }
  return null;
}
