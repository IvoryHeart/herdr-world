/**
 * Presentation-only agent movement for the Office town.
 *
 * Where an agent stands follows its authoritative status: seated while working,
 * unknown; at its host reception while blocked (oldest first) or finished
 * (after the waiting agents); and in the bar (the lounge) while idle. When
 * the reception queue is full, the rest, in the same order, crowd the lobby
 * beside it and grumble (however many: past the lobby's spots they huddle
 * between neighbours); after `TOWN_OVERFLOW_DOZE` seconds of overflow a
 * grumbler lies down and naps on the floor. A freed queue slot takes the
 * front of the crowd, and the crowd moves up; a napper gets up first. When the bar is full, the rest stay at their
 * desks. An agent the user opened
 * (summoned) walks back to its desk whatever its status, until that status
 * changes. An agent whose mark its reception does not take (held, see
 * townReceptionFilter.ts) stays seated at its desk with its mark. An agent at a pinned desk never goes to the lounge: it leaves its
 * desk only to wait at reception (blocked, or finished and not yet seen), and
 * walks straight back once seen. An agent out of fuel (stopped on its usage
 * limit, townOutOfFuel.ts) stays slumped at its desk. Movement never delays operational state,
 * and every actor keeps its agent key, so its exact pane target is unchanged
 * wherever it stands. An agent in the bin (away) walks out of its building's
 * front door and is drawn outside by the bus layer until it is put back.
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

/** `out`: through the front door, not drawn in the building. */
export type TownActorMode = "seat" | "stand" | "walk" | "tween" | "out";
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
  /**
   * Session clock time this agent joined the reception overflow, 0 outside
   * it, or `CROWD_PENDING` until the next step brings the clock current.
   */
  crowdSince: number;
  /** How far this agent lies on the floor: 0 standing, 1 napping. */
  rest: number;
};

/** How an agent in the reception overflow crowd looks once it stands there. */
export type TownCrowdMood = "grumble" | "nap";

export type TownGoal =
  | { kind: "seat"; deskKey: string; seat: number }
  | { kind: "queue"; slot: number }
  /** The reception overflow crowd: spot `slot` of townCrowdSpots. */
  | { kind: "crowd"; slot: number }
  | { kind: "lounge"; spot: TownSpot }
  | { kind: "door" };

/** How fast agents walk, in world pixels a second (also outdoors, townBus). */
export const TOWN_WALK_SPEED = 76;
const SEAT_TWEEN = 0.26;
/** Seconds of reception overflow before a grumbling agent gives up and naps. */
export const TOWN_OVERFLOW_DOZE = 90;
/** The most lobby crowd spots; more overflow huddles between them. */
const CROWD_LIMIT = 16;
/**
 * Pixel offsets from a crowd spot's tile centre for each further agent that
 * shares it, inside the tile, so a big crowd still reads as many agents.
 */
const CROWD_HUDDLE: readonly (readonly [number, number])[] = [
  [5, -3],
  [-5, -3],
  [5, 3],
  [-5, 3],
  [0, -5],
  [0, 4],
];
/**
 * `crowdSince` for an agent that joined the crowd at a sync: the next step
 * stamps the then-current clock, so a long quiet spell before the sync (no
 * frames, no clock) is never charged to the new crowd.
 */
const CROWD_PENDING = -1;
/** Seconds to lie down on the lobby floor, or to get up again. */
const LIE_TWEEN = 0.5;

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
    for (let x = L.bar.x; x < L.bar.x + L.bar.w; x += 1) this.block(x, L.bar.y);
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

/**
 * Lobby spots for agents the reception queue cannot take, front of the crowd
 * first: on both sides of the queue rug, beside and behind the counter, two
 * tiles apart so a napping agent fits. Spots stay off the rug (the queue and
 * the path to it), the counter, the front door's column, plants and the row
 * above the rooms; facing the counter.
 */
export function townCrowdSpots(
  building: TownBuilding,
  navigation: TownNavigation,
): TownSpot[] {
  const { doorX, lobbyY, entryX } = building;
  const rugLeft = doorX - 6;
  const rugRight = doorX + 5;
  const queueY = lobbyY + 4;
  const spots: (TownSpot & { distance: number; side: number })[] = [];
  for (const [index, y] of [lobbyY + 5, lobbyY + 3, lobbyY + 1].entries()) {
    const stagger = index % 2;
    for (const side of [-1, 1]) {
      const start = side < 0 ? rugLeft - 1 - stagger : rugRight + 1 + stagger;
      for (let x = start; ; x += 2 * side) {
        const gx = x - building.x;
        if (gx < 2 || gx > building.w - 3) break;
        const gy = y - building.y;
        if (
          x === entryX ||
          !Number.isFinite(navigation.grid[gy * building.w + gx]!)
        )
          continue;
        spots.push({
          x,
          y,
          face: side < 0 ? "right" : "left",
          distance:
            (side < 0 ? rugLeft - x : x - rugRight) + Math.abs(y - queueY),
          side,
        });
      }
    }
  }
  return spots
    .sort((a, b) => a.distance - b.distance || a.side - b.side || b.y - a.y)
    .slice(0, CROWD_LIMIT)
    .map(({ x, y, face }) => ({ x, y, face }));
}

const crowdSpotCache = new WeakMap<TownNavigation, TownSpot[]>();
/** A building's crowd spots, kept with its navigation grid. */
function crowdSpotsOf(world: TownActorWorld, hostKey: string) {
  const navigation = world.navigation.get(hostKey)!;
  let spots = crowdSpotCache.get(navigation);
  if (!spots) {
    spots = townCrowdSpots(world.buildings.get(hostKey)!, navigation);
    crowdSpotCache.set(navigation, spots);
  }
  return spots;
}

export type TownActorWorld = {
  layout: TownLayout;
  model: TownModel;
  cells: ReadonlyMap<string, TownCell>;
  buildings: ReadonlyMap<string, TownBuilding>;
  navigation: ReadonlyMap<string, TownNavigation>;
  /** What each building's navigation was built from (townNavigationKey). */
  navigationKeys: ReadonlyMap<string, string>;
  /** The hosts whose navigation was built for this world, not reused. */
  built: ReadonlySet<string>;
};

/** Everything a building's navigation grid is built from. */
export function townNavigationKey(building: TownBuilding) {
  const { x, y, w, h, lounge, counter, plants, rooms } = building;
  const desks = rooms.flatMap((room) =>
    room.cells.filter((cell) => cell.deskKey).map((cell) => [cell.x, cell.y]),
  );
  return JSON.stringify([
    x,
    y,
    w,
    h,
    [lounge.x, lounge.y, lounge.bar.x, lounge.bar.y, lounge.bar.w],
    [counter.x, counter.y, counter.w],
    plants.map((plant) => [plant.x, plant.y]),
    desks,
  ]);
}

/**
 * The actors' world for a layout and model. A building whose navigation
 * inputs are unchanged since `previous` keeps its navigation grid.
 */
export function townActorWorld(
  layout: TownLayout,
  model: TownModel,
  previous?: TownActorWorld | null,
): TownActorWorld {
  const cells = new Map<string, TownCell>();
  const buildings = new Map<string, TownBuilding>();
  const navigation = new Map<string, TownNavigation>();
  const navigationKeys = new Map<string, string>();
  const built = new Set<string>();
  for (const building of layout.buildings) {
    buildings.set(building.hostKey, building);
    const key = townNavigationKey(building);
    const kept =
      previous?.navigationKeys.get(building.hostKey) === key
        ? previous.navigation.get(building.hostKey)
        : undefined;
    if (!kept) built.add(building.hostKey);
    navigation.set(building.hostKey, kept ?? new TownNavigation(building));
    navigationKeys.set(building.hostKey, key);
    for (const room of building.rooms)
      for (const cell of room.cells)
        if (cell.deskKey) cells.set(cell.deskKey, cell);
  }
  return { layout, model, cells, buildings, navigation, navigationKeys, built };
}

/** Owns every actor; `sync` reconciles goals and `step` advances movement. */
export class TownActors {
  readonly actors = new Map<string, TownActor>();
  private world: TownActorWorld | null = null;
  private clock = 0;
  private summoned: ReadonlySet<string> = new Set();
  private asking: ReadonlySet<string> = new Set();
  private away: ReadonlySet<string> = new Set();
  private held: ReadonlySet<string> = new Set();

  get time() {
    return this.clock;
  }

  /** How many actors the last `sync` reconciled. */
  reconciled = 0;

  /**
   * Reconcile actors with a new model or layout. `instant` skips walking;
   * `summoned` agents go to their desks rather than reception or the lounge;
   * `away` agents (in the bin) leave by the front door; `held` agents, whose
   * mark their reception does not take, stay at their desks.
   * With `hosts`, only those hosts' agents are reconciled: the caller vouches
   * that nothing any other host's actors read has changed
   * (scene/townSceneActors.ts), so a full sync would leave them as they are.
   */
  sync(
    world: TownActorWorld,
    instant: boolean,
    summoned: ReadonlySet<string> = this.summoned,
    asking: ReadonlySet<string> = this.asking,
    hosts?: ReadonlySet<string>,
    away: ReadonlySet<string> = this.away,
    held: ReadonlySet<string> = this.held,
  ) {
    const previousWorld = this.world;
    this.world = world;
    this.summoned = summoned;
    this.asking = asking;
    this.away = away;
    this.held = held;
    const { model } = world;
    const seen = new Set<string>();
    const fresh = new Set<string>();
    const included = (hostKey: string) => !hosts || hosts.has(hostKey);
    for (const agent of model.agents.values()) {
      if (!included(agent.hostKey)) continue;
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
          crowdSince: 0,
          rest: 0,
        };
        this.actors.set(agent.key, actor);
        fresh.add(agent.key);
      }
      const previousBuilding = previousWorld?.buildings.get(actor.hostKey);
      if (
        previousBuilding &&
        !fresh.has(actor.key) &&
        actor.hostKey === agent.hostKey
      ) {
        // Reflow moves the building and its occupants together. Keeping old
        // world coordinates can put a walker outside the new navigation grid.
        const dx = (building.x - previousBuilding.x) * T;
        const dy = (building.y - previousBuilding.y) * T;
        actor.x += dx;
        actor.y += dy;
        if (dx || dy) actor.path = actor.path.map(([x, y]) => [x + dx, y + dy]);
        if (actor.tween) {
          actor.tween.x0 += dx;
          actor.tween.y0 += dy;
          actor.tween.x += dx;
          actor.tween.y += dy;
        }
      }
      if (actor.spot) {
        // Lounge slots belong to a building, not to absolute world tiles.
        // Preserve the slot through reflow, then resolve its current position.
        const previousSpots = previousWorld?.buildings.get(actor.hostKey)
          ?.lounge.spots;
        const index =
          previousSpots?.findIndex(
            (spot) => spotKey(spot) === spotKey(actor.spot!),
          ) ?? -1;
        actor.spot =
          actor.hostKey === agent.hostKey && index >= 0
            ? (building.lounge.spots[index] ?? null)
            : null;
        if (actor.spot && actor.goal?.kind === "lounge")
          actor.goal = { kind: "lounge", spot: actor.spot };
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
      if (!seen.has(key) && included(this.actors.get(key)!.hostKey)) {
        const actor = this.actors.get(key)!;
        if (actor.spot) actor.spot = null;
        this.actors.delete(key);
      }
    this.assignGoals(
      instant,
      fresh,
      world.layout !== previousWorld?.layout,
      included,
    );
  }

  private assignGoals(
    instantAll: boolean,
    fresh: ReadonlySet<string>,
    layoutChanged: boolean,
    included: (hostKey: string) => boolean,
  ) {
    const world = this.world;
    if (!world) return;
    const { model } = world;
    // Lounge spots and reception queues belong to one host each.
    const actors = [...this.actors.values()].filter((actor) =>
      included(actor.hostKey),
    );
    this.reconciled = actors.length;
    const loungeTaken = new Map<string, Set<string>>();
    for (const actor of actors)
      if (actor.spot) {
        const taken = loungeTaken.get(actor.hostKey) ?? new Set();
        taken.add(spotKey(actor.spot));
        loungeTaken.set(actor.hostKey, taken);
      }
    const queues = new Map<string, TownActor[]>();
    for (const actor of actors) {
      const agent = model.agents.get(actor.key)!;
      if (
        this.away.has(actor.key) ||
        this.held.has(actor.key) ||
        (agent.semanticStatus !== "blocked" &&
          agent.semanticStatus !== "done" &&
          !this.asking.has(actor.key)) ||
        (this.summoned.has(actor.key) && !this.asking.has(actor.key))
      )
        continue;
      const list = queues.get(actor.hostKey) ?? [];
      list.push(actor);
      queues.set(actor.hostKey, list);
    }
    const queueSlots = new Map<string, number>();
    const crowdSlots = new Map<string, number>();
    for (const [hostKey, list] of queues) {
      // Waiting agents first, oldest first; finished agents after them.
      const waiting = (actor: TownActor) => actor.blockedSince > 0;
      const rank = (actor: TownActor) =>
        waiting(actor) ? 0 : this.asking.has(actor.key) ? 1 : 2;
      list.sort(
        (a, b) =>
          rank(a) - rank(b) ||
          (waiting(a)
            ? a.blockedSince - b.blockedSince
            : a.doneSince - b.doneSince) ||
          a.key.localeCompare(b.key),
      );
      const building = world.buildings.get(hostKey)!;
      list
        .slice(0, building.queue.length)
        .forEach((actor, slot) => queueSlots.set(actor.key, slot));
      // All the rest crowd the lobby in the same order: the front of the
      // crowd takes the next free queue slot, and the others move up.
      list
        .slice(building.queue.length)
        .forEach((actor, slot) => crowdSlots.set(actor.key, slot));
    }
    for (const actor of actors) {
      const agent = model.agents.get(actor.key)!;
      const seat = model.agentSeats.get(actor.key)!;
      const building = world.buildings.get(actor.hostKey)!;
      let goal: TownGoal = {
        kind: "seat",
        deskKey: seat.deskKey,
        seat: seat.seat,
      };
      const slot = queueSlots.get(actor.key);
      const crowd = crowdSlots.get(actor.key);
      if (this.away.has(actor.key)) goal = { kind: "door" };
      else if (slot !== undefined) goal = { kind: "queue", slot };
      else if (crowd !== undefined) goal = { kind: "crowd", slot: crowd };
      else if (
        agent.semanticStatus === "idle" &&
        // Out of fuel: it slumps at its desk until its limit resets.
        !agent.usageStop &&
        !this.summoned.has(actor.key) &&
        !this.asking.has(actor.key) &&
        !model.deskPins.has(seat.deskKey)
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
      // Overflow time runs from joining the crowd, across moves within it.
      if (goal.kind !== "crowd") actor.crowdSince = 0;
      else if (actor.crowdSince === 0) actor.crowdSince = CROWD_PENDING;
      // A shrink can remove the floor under an in-flight actor even when the
      // building origin is unchanged. Settle invalid motion at its new goal;
      // never use a straight fallback path through the removed floor.
      const outside = (x: number, y: number) =>
        x < building.x * T ||
        x >= (building.x + building.w) * T ||
        y < building.y * T ||
        y >= (building.y + building.h) * T;
      const invalidMotion =
        layoutChanged &&
        (outside(actor.x, actor.y) ||
          (actor.tween !== null && outside(actor.tween.x, actor.tween.y)) ||
          actor.path.some(([x, y]) => outside(x, y)));
      const instant = instantAll || fresh.has(actor.key) || invalidMotion;
      if (sameGoal(actor.goal, goal) && !instant) {
        if (
          actor.mode === "seat" ||
          actor.mode === "stand" ||
          actor.mode === "out"
        )
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
    /** Where to stand, in world pixels, when not the tile's centre. */
    point?: [number, number];
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
    // The front door, in the building's top wall.
    if (goal.kind === "door")
      return { tile: [building.entryX, building.y + 1], face: "up" };
    if (goal.kind === "crowd") {
      // Past the last spot, the crowd huddles between earlier agents.
      const spots = crowdSpotsOf(world, actor.hostKey);
      const spot = spots[goal.slot % spots.length];
      if (!spot) return null;
      const layer = Math.floor(goal.slot / spots.length);
      const [cx, cy] = tileCenter(spot.x, spot.y);
      const [dx, dy] = layer
        ? CROWD_HUDDLE[(layer - 1) % CROWD_HUDDLE.length]!
        : [0, 0];
      return {
        tile: [spot.x, spot.y],
        point: [cx + dx, cy + dy],
        face: spot.face,
      };
    }
    const spot = goal.kind === "queue" ? building.queue[goal.slot] : goal.spot;
    if (!spot) return null;
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
      } else if (
        (actor.mode === "stand" || actor.mode === "out") &&
        !target.seat
      ) {
        [actor.x, actor.y] = standPoint(target);
      }
      return;
    }
    if (instant) {
      this.afterTween.delete(actor.key);
      actor.path = [];
      actor.tween = null;
      actor.rest = 0;
      if (target.seat) {
        actor.x = target.seat.x;
        actor.y = target.seat.y;
        actor.dir = target.seat.dir;
        actor.mode = "seat";
      } else {
        [actor.x, actor.y] = standPoint(target);
        actor.dir = target.face;
        actor.mode = actor.goal?.kind === "door" ? "out" : "stand";
      }
      return;
    }
    const begin = () => {
      // A snapshot may move reception while this actor is standing up.
      // Resolve the destination when walking starts, not before the tween.
      const target = this.destination(actor);
      if (!target) return;
      const navigation = this.world!.navigation.get(actor.hostKey)!;
      const path = navigation.path(
        Math.floor(actor.x / T),
        Math.floor((actor.y - 1) / T),
        target.tile[0],
        target.tile[1],
      );
      // Already in the goal tile (an empty path), still walk to its centre:
      // arriving off-centre would leave the actor where a later settle snaps.
      actor.path = (path?.length ? path : [target.tile]).map(([x, y]) =>
        tileCenter(x, y),
      );
      actor.path[actor.path.length - 1] = standPoint(target);
      actor.mode = "walk";
    };
    if (actor.mode === "stand" && actor.rest > 0) {
      // A napper gets up where it lies before walking anywhere.
      actor.tween = {
        x0: actor.x,
        y0: actor.y,
        x: actor.x,
        y: actor.y,
        t: 0,
        duration: LIE_TWEEN * actor.rest,
        next: "stand",
      };
      actor.mode = "tween";
      this.afterTween.set(actor.key, begin);
    } else if (actor.mode === "seat") {
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
    const [x, y] = standPoint(target);
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

  /**
   * How an agent in the overflow crowd looks once it stands at its spot:
   * grumbling, then napping after `TOWN_OVERFLOW_DOZE` seconds of overflow.
   */
  mood(actor: TownActor): TownCrowdMood | null {
    if (actor.goal?.kind !== "crowd" || actor.mode !== "stand") return null;
    return actor.rest > 0 || this.dozeIn(actor) <= 0 ? "nap" : "grumble";
  }

  /** Seconds until a grumbling agent in the crowd naps. */
  dozeIn(actor: TownActor) {
    if (actor.crowdSince === CROWD_PENDING) return TOWN_OVERFLOW_DOZE;
    return actor.crowdSince + TOWN_OVERFLOW_DOZE - this.clock;
  }

  /** How far this agent should lie: 1 once a standing crowd agent naps. */
  private restGoal(actor: TownActor) {
    return actor.goal?.kind === "crowd" &&
      actor.mode === "stand" &&
      actor.crowdSince > 0 &&
      this.dozeIn(actor) <= 0
      ? 1
      : 0;
  }

  /**
   * Advance movement by `dt` seconds and the session clock by `elapsed`
   * (reduced motion finishes movement at once but keeps real time).
   * Returns whether anything moved.
   */
  step(dt: number, elapsed = dt) {
    this.clock += elapsed;
    let moved = false;
    for (const actor of this.actors.values()) {
      if (actor.crowdSince === CROWD_PENDING)
        actor.crowdSince = this.clock || 1e-6;
      if (this.world?.model.agents.get(actor.key)?.stale) continue;
      // Lie down on the lobby floor, or get up, over LIE_TWEEN seconds.
      const restGoal = this.restGoal(actor);
      if (actor.rest !== restGoal) {
        moved = true;
        const change = dt / LIE_TWEEN;
        actor.rest =
          restGoal > actor.rest
            ? Math.min(restGoal, actor.rest + change)
            : Math.max(restGoal, actor.rest - change);
      }
      if (actor.mode === "walk") {
        moved = true;
        let remaining = TOWN_WALK_SPEED * dt;
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
      actor.mode = actor.goal?.kind === "door" ? "out" : "stand";
      actor.dir = target.face;
    }
  }

  /** Whether any actor is still moving. */
  get busy() {
    for (const actor of this.actors.values())
      if (
        !this.world?.model.agents.get(actor.key)?.stale &&
        (actor.mode === "walk" ||
          actor.mode === "tween" ||
          actor.rest !== this.restGoal(actor))
      )
        return true;
    return false;
  }
}

function sameGoal(a: TownGoal | null, b: TownGoal) {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === "seat" && b.kind === "seat")
    return a.deskKey === b.deskKey && a.seat === b.seat;
  if (a.kind === "queue" && b.kind === "queue") return a.slot === b.slot;
  if (a.kind === "crowd" && b.kind === "crowd") return a.slot === b.slot;
  if (a.kind === "lounge" && b.kind === "lounge")
    return spotKey(a.spot) === spotKey(b.spot);
  return a.kind === "door";
}

const spotKey = (spot: TownSpot) => `${spot.x},${spot.y}`;

/** Where a non-seat destination stands, in world pixels. */
const standPoint = (target: {
  tile: [number, number];
  point?: [number, number];
}): [number, number] => target.point ?? tileCenter(...target.tile);

const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
