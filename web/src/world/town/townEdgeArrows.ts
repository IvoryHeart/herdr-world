/**
 * Arrows at the edge of the Town view to what needs you off screen, as
 * strategy games point to events beyond the map. At room and desk zoom each
 * agent with a mark (! needs you, ? asks you, ✓ done) outside the visible
 * map gets an arrow on the view's edge, pointing at it; arrows pointing the
 * same way, or at the same building nearby, merge into one with a count.
 * Pure: the canvas feeds it the camera and the marked agents each frame.
 */

import type { TownLevel, TownViewport } from "./townCamera";

export type TownEdgeMark = "needs" | "asks" | "done";

/** A marked agent and where it is drawn, in world pixels. */
export type TownEdgeTarget = {
  key: string;
  mark: TownEdgeMark;
  hostKey: string;
  x: number;
  y: number;
};

/** The camera as the canvas draws it (townCamera.ts). */
export type TownEdgeCamera = {
  x: number;
  y: number;
  z: number;
  viewport: TownViewport;
};

/** A screen rectangle arrows keep out of (the Town board, the zoom group). */
export type TownEdgeRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type TownEdgeArrow = {
  /** Stable while the same agents merge into it. */
  id: string;
  /** The most urgent mark among its agents. */
  mark: TownEdgeMark;
  /** How many agents of each mark it points at. */
  counts: Record<TownEdgeMark, number>;
  count: number;
  /** Its agents, most urgent and nearest first: a tap goes to the first. */
  keys: string[];
  /** Their buildings, in the order their agents come. */
  hostKeys: string[];
  /** Its centre on screen. */
  x: number;
  y: number;
  /** Where it points, in radians (0 east, π/2 south: screen y grows down). */
  angle: number;
  compass: TownCompass;
};

export type TownCompass =
  | "east"
  | "south-east"
  | "south"
  | "south-west"
  | "west"
  | "north-west"
  | "north"
  | "north-east";

/** Most urgent first, as Needs you orders them. */
export const TOWN_EDGE_MARKS: readonly TownEdgeMark[] = [
  "needs",
  "asks",
  "done",
];

/** Screen pixels between an arrow's centre and the view's edge. */
export const TOWN_EDGE_MARGIN = 26;
/** Arrows closer than this along the edge point the same way: one arrow. */
export const TOWN_EDGE_MERGE = 48;
/** Arrows to the same building within this distance merge too. */
export const TOWN_EDGE_MERGE_BUILDING = 160;

const COMPASS: readonly TownCompass[] = [
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
  "north",
  "north-east",
];

export function townCompass(angle: number): TownCompass {
  const step = Math.round(angle / (Math.PI / 4));
  return COMPASS[((step % 8) + 8) % 8]!;
}

/** Arrows exist only zoomed into rooms and desks; zoomed out, all shows. */
export const townEdgeArrowsShown = (level: TownLevel) =>
  level === "room" || level === "desk";

/** The visible map: the view less the chrome along its sides. */
export function townEdgeVisibleRect(viewport: TownViewport): TownEdgeRect {
  const { width, height, inset } = viewport;
  return {
    left: inset.left,
    top: inset.top,
    right: width - inset.right,
    bottom: height - inset.bottom,
  };
}

/** Where a screen point lies on the camera's view. */
export function townEdgeScreen(camera: TownEdgeCamera, x: number, y: number) {
  return {
    x: (x - camera.x) * camera.z + camera.viewport.width / 2,
    y: (y - camera.y) * camera.z + camera.viewport.height / 2,
  };
}

const inside = (rect: TownEdgeRect, x: number, y: number) =>
  x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

/**
 * The point where a ray from the rectangle's centre at `angle` meets the
 * rectangle shrunk by the margin.
 */
function edgePoint(rect: TownEdgeRect, angle: number) {
  const cx = (rect.left + rect.right) / 2;
  const cy = (rect.top + rect.bottom) / 2;
  const hw = Math.max(1, (rect.right - rect.left) / 2 - TOWN_EDGE_MARGIN);
  const hh = Math.max(1, (rect.bottom - rect.top) / 2 - TOWN_EDGE_MARGIN);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const t = Math.min(
    Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity,
    Math.abs(dy) > 1e-9 ? hh / Math.abs(dy) : Infinity,
  );
  return { x: cx + dx * t, y: cy + dy * t };
}

/** Slide a point along its edge out of the rectangles it lands in. */
function avoid(
  point: { x: number; y: number },
  rect: TownEdgeRect,
  keepOut: readonly TownEdgeRect[],
) {
  const r = TOWN_EDGE_MARGIN;
  let { x, y } = point;
  for (let pass = 0; pass < 3; pass += 1) {
    const hit = keepOut.find(
      (box) =>
        x + r > box.left &&
        x - r < box.right &&
        y + r > box.top &&
        y - r < box.bottom,
    );
    if (!hit) break;
    const onSide =
      Math.abs(x - (rect.left + r)) < 1 || Math.abs(x - (rect.right - r)) < 1;
    if (onSide) {
      // Down past the box, or up when that leaves the view.
      const below = hit.bottom + r;
      y = below <= rect.bottom - r ? below : hit.top - r;
    } else {
      const right = hit.right + r;
      x = right <= rect.right - r ? right : hit.left - r;
    }
  }
  return { x, y };
}

type Group = {
  members: (TownEdgeTarget & { angle: number; distance: number })[];
  x: number;
  y: number;
  angle: number;
};

const rank = (mark: TownEdgeMark) => TOWN_EDGE_MARKS.indexOf(mark);

/**
 * The arrows for this camera: none at town and building zoom, else one per
 * direction or building for the marked agents outside the visible map.
 */
export function townEdgeArrows(
  targets: readonly TownEdgeTarget[],
  camera: TownEdgeCamera,
  level: TownLevel,
  keepOut: readonly TownEdgeRect[] = [],
): TownEdgeArrow[] {
  if (!townEdgeArrowsShown(level) || !targets.length) return [];
  const rect = townEdgeVisibleRect(camera.viewport);
  const cx = (rect.left + rect.right) / 2;
  const cy = (rect.top + rect.bottom) / 2;
  // Arrows sit where they draw, clear of the chrome, before they merge: two
  // arrows the chrome pushed to one spot then merge rather than overlap.
  const place = (angle: number) => avoid(edgePoint(rect, angle), rect, keepOut);
  let groups: Group[] = [];
  for (const target of targets) {
    const at = townEdgeScreen(camera, target.x, target.y);
    if (inside(rect, at.x, at.y)) continue;
    const angle = Math.atan2(at.y - cy, at.x - cx);
    const point = place(angle);
    groups.push({
      members: [
        { ...target, angle, distance: Math.hypot(at.x - cx, at.y - cy) },
      ],
      ...point,
      angle,
    });
  }
  // Merge until no two arrows point the same way or at one building nearby.
  const sameBuilding = (a: Group, b: Group) =>
    a.members.some((m) => b.members.some((n) => n.hostKey === m.hostKey));
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < groups.length; i += 1)
      for (let j = i + 1; j < groups.length; j += 1) {
        const a = groups[i]!;
        const b = groups[j]!;
        const gap = Math.hypot(a.x - b.x, a.y - b.y);
        if (
          gap < TOWN_EDGE_MERGE ||
          (gap < TOWN_EDGE_MERGE_BUILDING && sameBuilding(a, b))
        ) {
          const members = [...a.members, ...b.members];
          // The mean direction of its agents.
          const sx = members.reduce((sum, m) => sum + Math.cos(m.angle), 0);
          const sy = members.reduce((sum, m) => sum + Math.sin(m.angle), 0);
          const angle = Math.atan2(sy, sx);
          groups = [
            ...groups.slice(0, i),
            { members, angle, ...place(angle) },
            ...groups.slice(i + 1, j),
            ...groups.slice(j + 1),
          ];
          merged = true;
          break outer;
        }
      }
  }
  return groups
    .map((group): TownEdgeArrow => {
      const members = [...group.members].sort(
        (a, b) => rank(a.mark) - rank(b.mark) || a.distance - b.distance,
      );
      const counts: Record<TownEdgeMark, number> = {
        needs: 0,
        asks: 0,
        done: 0,
      };
      for (const member of members) counts[member.mark] += 1;
      const keys = members.map((member) => member.key);
      return {
        id: [...keys].sort().join(" "),
        mark: members[0]!.mark,
        counts,
        count: members.length,
        keys,
        hostKeys: [...new Set(members.map((member) => member.hostKey))],
        x: group.x,
        y: group.y,
        angle: group.angle,
        compass: townCompass(group.angle),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Whether two arrow lists draw the same, to whole pixels. */
export function townEdgeArrowsEqual(
  a: readonly TownEdgeArrow[],
  b: readonly TownEdgeArrow[],
) {
  return (
    a.length === b.length &&
    a.every((arrow, index) => {
      const other = b[index]!;
      return (
        arrow.id === other.id &&
        arrow.mark === other.mark &&
        arrow.keys[0] === other.keys[0] &&
        Math.round(arrow.x) === Math.round(other.x) &&
        Math.round(arrow.y) === Math.round(other.y) &&
        Math.abs(arrow.angle - other.angle) < 0.02
      );
    })
  );
}

const PHRASES: Record<TownEdgeMark, [string, string]> = {
  needs: ["needs you", "need you"],
  asks: ["asks you", "ask you"],
  done: ["is done", "are done"],
};

/**
 * The arrow's accessible name: "3 need you in north-host, to the north, go
 * there". `buildingLabel` names a building by its host key.
 */
export function townEdgeArrowLabel(
  arrow: Pick<TownEdgeArrow, "counts" | "hostKeys" | "compass">,
  buildingLabel: (hostKey: string) => string,
) {
  const parts = TOWN_EDGE_MARKS.filter((mark) => arrow.counts[mark] > 0).map(
    (mark) => {
      const n = arrow.counts[mark];
      return `${n} ${PHRASES[mark][n === 1 ? 0 : 1]}`;
    },
  );
  const what =
    parts.length > 1
      ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
      : parts[0];
  const names = arrow.hostKeys.map(buildingLabel);
  const where =
    names.length > 1
      ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
      : names[0];
  return `${what} in ${where}, to the ${arrow.compass}, go there`;
}
