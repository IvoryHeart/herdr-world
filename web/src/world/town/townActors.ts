/**
 * Presentation-only agent movement for the Office town.
 *
 * Where an agent stands follows its authoritative status: seated while working,
 * unknown; at its host reception while blocked (oldest first) or finished
 * (after the waiting agents); and in the lounge while idle. When reception or
 * the lounge is full, the rest stay at their desks. An agent the user opened
 * (summoned) walks back to its desk whatever its status, until that status
 * changes. Movement never delays operational state, and every actor keeps
 * its agent key, so its exact pane target is unchanged wherever it stands.
 */

import {
  TOWN_TILE as T,
  townSeat,
  type TownBuilding,
  type TownCell,
  type TownLayout,
  type TownSpot,
} from "./townLayout";
import type { TownModel } from "./townModel";

export type TownActorMode = "seat" | "stand" | "walk" | "tween";
export type TownFacing = "down" | "up" | "left" | "right";

export type TownActor = {
  key: string;
  hostKey: string;
  x: number;
  y: number;
  dir: TownFacing;
  mode: TownActorMode;
  path: [number, number][];
  walked: number;
  tween: null | {
    x0: number;
    y0: number;
    x: number;
    y: number;
    t: number;
    duration: number;
    next: TownActorMode;
  };
  /** Target this actor is heading to or occupying. */
  goal: TownGoal | null;
  /** Reception queue slot, when queued. */
  queueSlot: number | null;
  spot: TownSpot | null;
  blockedSince: number;
  /** Session clock time this agent was first seen finished, or 0. */
  doneSince: number;
};

export type TownGoal =
  | { kind: "seat"; deskKey: string; seat: number }
  | { kind: "queue"; slot: number }
  | { kind: "lounge"; spot: TownSpot };

const WALK_SPEED = 76;
const SEAT_TWEEN = 0.26;

const tileCenter = (tx: number, ty: number): [number, number] => [
  tx * T + 8,
  ty * T + 13,
];

/** Walkable tiles for one building, rebuilt whenever the layout changes. */
export class TownNavigation {
  readonly grid: Float32Array;

  constructor(readonly building: TownBuilding) {
    const { w, h } = building;
    this.grid = new Float32Array(w * h).fill(1);
    for (let y = 0; y < h; y += 1)
      for (let x = 0; x < w; x += 1)
        if (y < 2 || x === 0 || x === w - 1) this.grid[y * w + x] = Infinity;
    const L = building.lounge;
    for (const dx of [1, 2, 3, 7, 8]) this.block(L.x + dx, L.y + 1);
    for (
      let x = building.counter.x;
      x < building.counter.x + building.counter.w;
      x += 1
    )
      for (let y = building.counter.y - 1; y <= building.counter.y + 1; y += 1)
        this.block(x, y);
    for (const plant of building.plants) this.block(plant.x, plant.y);
    for (const room of building.rooms)
      for (const cell of room.cells) if (cell.deskKey) this.blockCell(cell);
  }

  block(tx: number, ty: number) {
    const x = tx - this.building.x;
    const y = ty - this.building.y;
    if (x >= 0 && y >= 0 && x < this.building.w && y < this.building.h)
      this.grid[y * this.building.w + x] = Infinity;
  }

  blockCell(cell: TownCell) {
    for (let dy = 0; dy < 4; dy += 1)
      for (let dx = 1; dx <= 4; dx += 1) this.block(cell.x + dx, cell.y + dy);
  }

  /** Four-way A* in absolute tiles; the goal tile is always admitted. */
  path(
    sx: number,
    sy: number,
    tx: number,
    ty: number,
  ): [number, number][] | null {
    const { x: bx, y: by, w, h } = this.building;
    const ax = sx - bx;
    const ay = sy - by;
    const gx = tx - bx;
    const gy = ty - by;
    if (
      [ax, gx].some((v) => v < 0 || v >= w) ||
      [ay, gy].some((v) => v < 0 || v >= h)
    )
      return null;
    const start = ay * w + ax;
    const goal = gy * w + gx;
    const cost = new Float32Array(w * h).fill(Infinity);
    const came = new Int32Array(w * h).fill(-1);
    const heap: [number, number][] = [];
    const push = (node: number, priority: number) => {
      heap.push([priority, node]);
      let i = heap.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (heap[parent]![0] <= heap[i]![0]) break;
        [heap[i], heap[parent]] = [heap[parent]!, heap[i]!];
        i = parent;
      }
    };
    const pop = () => {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
          if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
          if (m === i) break;
          [heap[i], heap[m]] = [heap[m]!, heap[i]!];
          i = m;
        }
      }
      return top[1];
    };
    cost[start] = 0;
    push(start, 0);
    while (heap.length) {
      const current = pop();
      if (current === goal) break;
      const cx = current % w;
      const cy = (current / w) | 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const next = ny * w + nx;
        const step = next === goal ? 1 : this.grid[next]!;
        if (!Number.isFinite(step)) continue;
        const total = cost[current]! + step;
        if (total < cost[next]!) {
          cost[next] = total;
          came[next] = current;
          push(next, total + Math.abs(nx - gx) + Math.abs(ny - gy));
        }
      }
    }
    if (start !== goal && came[goal]! < 0) return null;
    const out: [number, number][] = [];
    for (let node = goal; node !== start && node >= 0; node = came[node]!)
      out.push([(node % w) + bx, ((node / w) | 0) + by]);
    return out.reverse();
  }
}

export type TownActorWorld = {
  layout: TownLayout;
  model: TownModel;
  cells: ReadonlyMap<string, TownCell>;
  buildings: ReadonlyMap<string, TownBuilding>;
  navigation: ReadonlyMap<string, TownNavigation>;
};

export function townActorWorld(
  layout: TownLayout,
  model: TownModel,
): TownActorWorld {
  const cells = new Map<string, TownCell>();
  const buildings = new Map<string, TownBuilding>();
  const navigation = new Map<string, TownNavigation>();
  for (const building of layout.buildings) {
    buildings.set(building.hostKey, building);
    navigation.set(building.hostKey, new TownNavigation(building));
    for (const room of building.rooms)
      for (const cell of room.cells)
        if (cell.deskKey) cells.set(cell.deskKey, cell);
  }
  return { layout, model, cells, buildings, navigation };
}

/** Owns every actor; `sync` reconciles goals and `step` advances movement. */
export class TownActors {
  readonly actors = new Map<string, TownActor>();
  private world: TownActorWorld | null = null;
  private clock = 0;
  private summoned: ReadonlySet<string> = new Set();

  get time() {
    return this.clock;
  }

  /**
   * Reconcile actors with a new model or layout. `instant` skips walking;
   * `summoned` agents go to their desks rather than reception or the lounge.
   */
  sync(
    world: TownActorWorld,
    instant: boolean,
    summoned: ReadonlySet<string> = this.summoned,
  ) {
    this.world = world;
    this.summoned = summoned;
    const { model } = world;
    const seen = new Set<string>();
    const fresh = new Set<string>();
    for (const agent of model.agents.values()) {
      const seat = model.agentSeats.get(agent.key);
      const cell = seat ? world.cells.get(seat.deskKey) : undefined;
      const building = world.buildings.get(agent.hostKey);
      if (!building || !seat || !cell) continue;
      seen.add(agent.key);
      let actor = this.actors.get(agent.key);
      if (!actor) {
        const geometry = townSeat(cell, seat.seat);
        actor = {
          key: agent.key,
          hostKey: agent.hostKey,
          x: geometry.cx,
          y: geometry.seatedY,
          dir: geometry.top ? "down" : "up",
          mode: "seat",
          path: [],
          walked: 0,
          tween: null,
          goal: { kind: "seat", deskKey: seat.deskKey, seat: seat.seat },
          queueSlot: null,
          spot: null,
          blockedSince: agent.semanticStatus === "blocked" ? this.clock : 0,
          doneSince: agent.semanticStatus === "done" ? this.clock : 0,
        };
        this.actors.set(agent.key, actor);
        fresh.add(agent.key);
      }
      actor.hostKey = agent.hostKey;
      if (agent.semanticStatus === "blocked" && actor.blockedSince === 0)
        actor.blockedSince = this.clock || 1e-6;
      if (agent.semanticStatus !== "blocked") actor.blockedSince = 0;
      if (agent.semanticStatus === "done" && actor.doneSince === 0)
        actor.doneSince = this.clock || 1e-6;
      if (agent.semanticStatus !== "done") actor.doneSince = 0;
    }
    for (const key of [...this.actors.keys()])
      if (!seen.has(key)) {
        const actor = this.actors.get(key)!;
        if (actor.spot) actor.spot = null;
        this.actors.delete(key);
      }
    this.assignGoals(instant, fresh);
  }

  private assignGoals(instantAll: boolean, fresh: ReadonlySet<string>) {
    const world = this.world;
    if (!world) return;
    const { model } = world;
    const loungeTaken = new Map<string, Set<string>>();
    for (const actor of this.actors.values())
      if (actor.spot) {
        const taken = loungeTaken.get(actor.hostKey) ?? new Set();
        taken.add(spotKey(actor.spot));
        loungeTaken.set(actor.hostKey, taken);
      }
    const queues = new Map<string, TownActor[]>();
    for (const actor of this.actors.values()) {
      const agent = model.agents.get(actor.key)!;
      if (
        (agent.semanticStatus !== "blocked" &&
          agent.semanticStatus !== "done") ||
        this.summoned.has(actor.key)
      )
        continue;
      const list = queues.get(actor.hostKey) ?? [];
      list.push(actor);
      queues.set(actor.hostKey, list);
    }
    const queueSlots = new Map<string, number>();
    for (const [hostKey, list] of queues) {
      // Waiting agents first, oldest first; finished agents after them.
      const waiting = (actor: TownActor) => actor.blockedSince > 0;
      list.sort(
        (a, b) =>
          Number(waiting(b)) - Number(waiting(a)) ||
          (waiting(a)
            ? a.blockedSince - b.blockedSince
            : a.doneSince - b.doneSince) ||
          a.key.localeCompare(b.key),
      );
      const building = world.buildings.get(hostKey)!;
      list
        .slice(0, building.queue.length)
        .forEach((actor, slot) => queueSlots.set(actor.key, slot));
    }
    for (const actor of this.actors.values()) {
      const agent = model.agents.get(actor.key)!;
      const seat = model.agentSeats.get(actor.key)!;
      const building = world.buildings.get(actor.hostKey)!;
      let goal: TownGoal = {
        kind: "seat",
        deskKey: seat.deskKey,
        seat: seat.seat,
      };
      const slot = queueSlots.get(actor.key);
      if (slot !== undefined) goal = { kind: "queue", slot };
      else if (
        agent.semanticStatus === "idle" &&
        !this.summoned.has(actor.key)
      ) {
        if (actor.spot) goal = { kind: "lounge", spot: actor.spot };
        else {
          const taken = loungeTaken.get(actor.hostKey) ?? new Set();
          const free = building.lounge.spots.find(
            (spot) => !taken.has(spotKey(spot)),
          );
          if (free) {
            taken.add(spotKey(free));
            loungeTaken.set(actor.hostKey, taken);
            goal = { kind: "lounge", spot: free };
          }
        }
      }
      if (goal.kind !== "lounge" && actor.spot) actor.spot = null;
      if (goal.kind === "lounge") actor.spot = goal.spot;
      actor.queueSlot = goal.kind === "queue" ? goal.slot : null;
      const instant = instantAll || fresh.has(actor.key);
      if (sameGoal(actor.goal, goal) && !instant) {
        if (actor.mode === "seat" || actor.mode === "stand")
          this.travel(actor, true, true);
        else if (actor.mode === "walk" || actor.mode === "tween")
          this.retarget(actor);
        continue;
      }
      actor.goal = goal;
      this.travel(actor, instant);
    }
  }

  private destination(actor: TownActor): {
    tile: [number, number];
    seat?: { x: number; y: number; dir: TownFacing };
    face: TownFacing;
  } | null {
    const world = this.world!;
    const goal = actor.goal;
    if (!goal) return null;
    if (goal.kind === "seat") {
      const cell = world.cells.get(goal.deskKey);
      if (!cell) return null;
      const seat = townSeat(cell, goal.seat);
      return {
        tile: [seat.entry.x, seat.entry.y],
        seat: { x: seat.cx, y: seat.seatedY, dir: seat.top ? "down" : "up" },
        face: seat.top ? "down" : "up",
      };
    }
    const building = world.buildings.get(actor.hostKey)!;
    const spot = goal.kind === "queue" ? building.queue[goal.slot]! : goal.spot;
    return { tile: [spot.x, spot.y], face: spot.face };
  }

  private travel(actor: TownActor, instant: boolean, settleOnly = false) {
    const target = this.destination(actor);
    if (!target) return;
    if (settleOnly) {
      // Keep a resting actor on its target when the layout under it changes.
      if (actor.mode === "seat" && target.seat) {
        actor.x = target.seat.x;
        actor.y = target.seat.y;
      } else if (actor.mode === "stand" && !target.seat) {
        [actor.x, actor.y] = tileCenter(...target.tile);
      }
      return;
    }
    if (instant) {
      actor.path = [];
      actor.tween = null;
      if (target.seat) {
        actor.x = target.seat.x;
        actor.y = target.seat.y;
        actor.dir = target.seat.dir;
        actor.mode = "seat";
      } else {
        [actor.x, actor.y] = tileCenter(...target.tile);
        actor.dir = target.face;
        actor.mode = "stand";
      }
      return;
    }
    const begin = () => {
      const navigation = this.world!.navigation.get(actor.hostKey)!;
      const path = navigation.path(
        Math.floor(actor.x / T),
        Math.floor((actor.y - 1) / T),
        target.tile[0],
        target.tile[1],
      );
      actor.path = (path ?? [target.tile]).map(([x, y]) => tileCenter(x, y));
      actor.mode = "walk";
    };
    if (actor.mode === "seat") {
      const [ex, ey] = this.seatExit(actor);
      actor.dir = ex > actor.x ? "right" : "left";
      actor.tween = {
        x0: actor.x,
        y0: actor.y,
        x: ex,
        y: ey,
        t: 0,
        duration: SEAT_TWEEN,
        next: "stand",
      };
      actor.mode = "tween";
      this.afterTween.set(actor.key, begin);
    } else if (actor.mode === "tween") {
      this.afterTween.set(actor.key, begin);
    } else begin();
  }

  /**
   * An agent heading to a seat that moved (a reordered desk) heads to the new
   * one: a walker re-paths, and one sitting down stands up where it is and
   * walks over.
   */
  private retarget(actor: TownActor) {
    const target = this.destination(actor);
    if (!target) return;
    if (actor.mode === "tween") {
      const tween = actor.tween;
      if (
        !tween ||
        tween.next !== "seat" ||
        !target.seat ||
        (tween.x === target.seat.x && tween.y === target.seat.y)
      )
        return;
      actor.tween = null;
      actor.mode = "stand";
      this.afterTween.delete(actor.key);
      this.travel(actor, false);
      return;
    }
    const end = actor.path[actor.path.length - 1];
    if (!end) return;
    const [x, y] = tileCenter(...target.tile);
    if (end[0] !== x || end[1] !== y) this.travel(actor, false);
  }

  private readonly afterTween = new Map<string, () => void>();

  private seatExit(actor: TownActor): [number, number] {
    const seat = this.world!.model.agentSeats.get(actor.key);
    const cell = seat ? this.world!.cells.get(seat.deskKey) : undefined;
    if (!seat || !cell) return [actor.x, actor.y];
    const { entry } = townSeat(cell, seat.seat);
    return tileCenter(entry.x, entry.y);
  }

  /** Advance movement by `dt` seconds. Returns whether anything moved. */
  step(dt: number) {
    this.clock += dt;
    let moved = false;
    for (const actor of this.actors.values()) {
      if (actor.mode === "walk") {
        moved = true;
        let remaining = WALK_SPEED * dt;
        while (remaining > 0 && actor.path.length) {
          const [px, py] = actor.path[0]!;
          const dx = px - actor.x;
          const dy = py - actor.y;
          const distance = Math.hypot(dx, dy);
          if (distance > 0.01)
            actor.dir =
              Math.abs(dx) > Math.abs(dy)
                ? dx > 0
                  ? "right"
                  : "left"
                : dy > 0
                  ? "down"
                  : "up";
          if (distance <= remaining) {
            actor.x = px;
            actor.y = py;
            remaining -= distance;
            actor.walked += distance;
            actor.path.shift();
          } else {
            actor.x += (dx / distance) * remaining;
            actor.y += (dy / distance) * remaining;
            actor.walked += remaining;
            remaining = 0;
          }
        }
        if (!actor.path.length) this.arrive(actor);
      } else if (actor.mode === "tween" && actor.tween) {
        moved = true;
        const tween = actor.tween;
        tween.t += dt / tween.duration;
        const k = easeInOut(Math.min(1, tween.t));
        actor.x = tween.x0 + (tween.x - tween.x0) * k;
        actor.y = tween.y0 + (tween.y - tween.y0) * k;
        if (tween.t >= 1) {
          actor.mode = tween.next;
          actor.tween = null;
          const after = this.afterTween.get(actor.key);
          this.afterTween.delete(actor.key);
          if (actor.mode === "seat") {
            const target = this.destination(actor);
            if (target?.seat) actor.dir = target.seat.dir;
          }
          after?.();
        }
      }
    }
    return moved;
  }

  private arrive(actor: TownActor) {
    const target = this.destination(actor);
    if (!target) {
      actor.mode = "stand";
      return;
    }
    if (target.seat) {
      actor.dir = target.seat.x > actor.x ? "right" : "left";
      actor.tween = {
        x0: actor.x,
        y0: actor.y,
        x: target.seat.x,
        y: target.seat.y,
        t: 0,
        duration: SEAT_TWEEN,
        next: "seat",
      };
      actor.mode = "tween";
    } else {
      actor.mode = "stand";
      actor.dir = target.face;
    }
  }

  /** Whether any actor is still moving. */
  get busy() {
    for (const actor of this.actors.values())
      if (actor.mode === "walk" || actor.mode === "tween") return true;
    return false;
  }
}

function sameGoal(a: TownGoal | null, b: TownGoal) {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === "seat" && b.kind === "seat")
    return a.deskKey === b.deskKey && a.seat === b.seat;
  if (a.kind === "queue" && b.kind === "queue") return a.slot === b.slot;
  if (a.kind === "lounge" && b.kind === "lounge")
    return spotKey(a.spot) === spotKey(b.spot);
  return false;
}

const spotKey = (spot: TownSpot) => `${spot.x},${spot.y}`;

const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
