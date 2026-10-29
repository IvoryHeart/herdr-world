import { Container, Sprite, Texture } from "pixi.js";
import type { BinEntry } from "../../../../shared/bin";
import { binTimeLeft, type WorldBinState } from "../bin/binStore";
import {
  BUS_ROAD_OFFSET,
  busParking,
  busPhase,
  busTimes,
  BusHold,
  busTrips,
  busX,
  catchableTrip,
  departX,
  townBusStop,
  type BusPhase,
  type BusTrip,
} from "./townBus";
import {
  BUS_DOOR_X,
  BUS_H,
  BUS_W,
  BUS_WINDOWS,
  STOP_H,
  STOP_W,
  busPassengerSprite,
  busSprite,
  busStopSprite,
} from "./townBusSprites";
import type { TownCamera } from "./townCamera";
import { diagnostics } from "./townDiagnostics";
import {
  TOWN_AGENT_SCALE,
  type TownLayout,
  type TownPoint,
} from "./townLayout";
import { townCharacter, type TownLook } from "./townSprites";
import { textureOf } from "./townTextures";

/** What Town's renderer draws over the world each frame (townRenderer.ts). */
export type TownOverlay = {
  container: Container;
  /** Agents not at their desks (waiting at the stop or on the bus). */
  hidden: ReadonlySet<string>;
  /** Draw this frame; true while something moves. */
  update(camera: TownCamera, look: (key: string) => TownLook): boolean;
};

type Rect = { x: number; y: number; w: number; h: number };
type BusView = {
  sprite: Sprite;
  heads: Sprite[];
  ids: Set<string>;
  x: number;
  rect: Rect;
  /** Seats: the entries shown at each upper-deck window. */
  seats: { entry: BinEntry; rect: Rect }[];
  departing: { from: number; since: number } | null;
  /** Its row's road line and its scale while parked; it leaves on them. */
  bottom: number;
  scale: number;
};

const inside = (r: Rect, x: number, y: number) =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/**
 * The London bus stop and its buses, drawn in screen space over the town. The
 * stop sits on the pavement by the first building's door; each bus enters at
 * the left edge of the screen, stops there, and drives off the right edge,
 * whatever the camera shows. Sub-pixel positions are kept and rounded only
 * when drawn.
 */
export class TownBusLayer implements TownOverlay {
  readonly container = new Container();
  hidden = new Set<string>();
  private stop: TownPoint | null = null;
  private stopSprite = new Sprite(Texture.EMPTY);
  private stopRect: Rect | null = null;
  private waiting: { entry: BinEntry; sprite: Sprite; rect: Rect }[] = [];
  private buses: BusView[] = [];
  private bin: WorldBinState | null = null;
  private agentOf = new Map<string, string>();
  private grip = new BusHold();
  private trips: BusTrip[] = [];
  private nextChange: ReturnType<typeof setTimeout> | null = null;
  private status = { x: 0, y: 0, text: "", visible: false, bus: "" };

  constructor(private readonly invalidate: () => void) {
    this.stopSprite.anchor.set(0.5, 1);
    this.container.addChild(this.stopSprite);
  }

  setLayout(layout: TownLayout | null) {
    this.stop = layout ? townBusStop(layout) : null;
    this.invalidate();
  }

  /** The bin, and which Town agent each entry is. */
  setBin(bin: WorldBinState, agentOf: Map<string, string>) {
    this.bin = bin;
    this.agentOf = agentOf;
    this.grip.observe(bin.bin.paused, !bin.bin.entries.length);
    this.hidden = new Set(
      bin.bin.entries.flatMap((entry) => agentOf.get(entry.id) ?? []),
    );
    this.invalidate();
  }

  /** Press and hold: freeze the bus at once, before the service pauses. */
  hold() {
    this.grip.hold(performance.now(), !!this.bin?.bin.paused);
    this.invalidate();
  }
  /** Let the bus go, or undo a hold the service refused. */
  release() {
    this.grip.release();
    this.invalidate();
  }
  /** The pause settled; `paused` is the service's latest state, which may be a later resume. */
  holdAnswered(paused: boolean) {
    this.grip.answered(paused);
    this.invalidate();
  }
  get held() {
    return this.grip.held(!!this.bin?.bin.paused);
  }

  /** A bus a newly dropped agent can still catch: one of its passengers. */
  joinable() {
    return catchableTrip(this.trips)?.entries[0]?.id;
  }
  stopAt(x: number, y: number) {
    const r = this.stopRect;
    return (
      !!r &&
      inside({ x: r.x - 28, y: r.y - 20, w: r.w + 56, h: r.h + 40 }, x, y)
    );
  }
  busAt(x: number, y: number) {
    return this.buses.some((bus) => !bus.departing && inside(bus.rect, x, y));
  }
  /** A passenger at a window (only while the bus is held) or an agent at the stop. */
  passengerAt(x: number, y: number): BinEntry | null {
    for (const item of this.waiting)
      if (inside(item.rect, x, y)) return item.entry;
    if (!this.held) return null;
    // The bus drawn last is on top.
    for (const bus of [...this.buses].reverse())
      for (const seat of bus.seats)
        if (inside(seat.rect, x, y)) return seat.entry;
    return null;
  }
  /** The timetable above the stop: where, and what it says. */
  timetable() {
    return this.status;
  }

  /**
   * Stop waking the renderer. The container stays usable (React may mount the
   * same layer again); the renderer's own teardown destroys what it holds.
   */
  dispose() {
    if (this.nextChange) clearTimeout(this.nextChange);
    this.nextChange = null;
  }

  update(camera: TownCamera, look: (key: string) => TownLook) {
    if (this.stopSprite.destroyed) return false;
    const bin = this.bin;
    const now = this.grip.at ?? performance.now();
    const z = camera.z;
    const { width, height, inset } = camera.viewport;
    const quiet = camera.reducedMotion;
    this.trips = bin
      ? busTrips(bin.bin.entries, (entry) => binTimeLeft(entry, bin, now))
      : [];
    const stop = this.stop;
    this.stopSprite.visible = !!stop;
    if (!stop) {
      this.stopRect = null;
      this.clearWaiting();
      for (const bus of this.buses) bus.sprite.destroy({ children: true });
      this.buses = [];
      return false;
    }
    // The world layer is placed at whole pixels (townRenderer), and so is the stop.
    const ox = Math.round(width / 2 - camera.x * z);
    const oy = Math.round(height / 2 - camera.y * z);
    const sx = stop.x * z + ox;
    const sy = stop.y * z + oy;
    this.stopSprite.texture = textureOf(busStopSprite());
    this.stopSprite.scale.set(z);
    this.stopSprite.position.set(Math.round(sx), Math.round(sy));
    this.stopRect = {
      x: sx - (STOP_W / 2) * z,
      y: sy - STOP_H * z,
      w: STOP_W * z,
      h: STOP_H * z,
    };

    // The road the bus runs on, kept on screen when the stop is not (on a
    // phone, above the attention rail docked along the bottom).
    const busH = BUS_H * z;
    const road = Math.min(
      height - inset.bottom - (width < 640 ? 110 : 6),
      Math.max(inset.top + busH + 6, sy + BUS_ROAD_OFFSET * z),
    );
    // A bus seats five: a bigger trip runs as many buses as it needs, and
    // every parked bus stands on screen (busParking).
    const parking = busParking({
      count: this.trips.reduce(
        (sum, trip) =>
          sum + Math.ceil(trip.entries.length / BUS_WINDOWS.length),
        0,
      ),
      zoom: z,
      stopX: sx,
      road,
      left: inset.left + 8,
      right: width - 8,
      top: inset.top + 6,
      busW: BUS_W,
      busH: BUS_H,
      doorX: BUS_DOOR_X,
    });
    const scale = parking.scale;
    const from = -BUS_W * scale - 16;
    const to = width + 16;

    let moving = false;
    const kept: BusView[] = [];
    const waiting: BinEntry[] = [];
    let slot = 0;
    for (const trip of this.trips) {
      const pose = quiet
        ? { phase: "wait" as BusPhase, t: 0 }
        : busPhase(trip.durationMs, trip.leftMs);
      if (pose.phase === "arrive") waiting.push(...trip.entries);
      const open = pose.phase === "wait" || this.held;
      const driving = pose.phase !== "wait" && !this.held;
      moving ||= driving && !bin?.bin.paused;
      for (let i = 0; i < trip.entries.length; i += BUS_WINDOWS.length) {
        const load = trip.entries.slice(i, i + BUS_WINDOWS.length);
        const view =
          this.buses.find(
            (bus) =>
              !bus.departing &&
              !kept.includes(bus) &&
              load.some((entry) => bus.ids.has(entry.id)),
          ) ?? this.newBus();
        view.ids = new Set(load.map((entry) => entry.id));
        const place = parking.slots[slot]!;
        slot += 1;
        view.x = busX(pose, from, place.x, to);
        view.bottom = place.bottom;
        view.scale = scale;
        this.drawBus(
          view,
          open,
          driving,
          place.bottom,
          scale,
          pose.phase === "arrive" ? [] : load,
          look,
        );
        kept.push(view);
      }
    }
    for (const bus of this.buses) {
      if (kept.includes(bus)) continue;
      // Its last passenger got off or it was closed early: it pulls away now.
      if (quiet) {
        bus.sprite.destroy({ children: true });
        continue;
      }
      bus.departing ??= { from: bus.x, since: performance.now() };
      bus.x = departX(
        bus.departing.from,
        to,
        performance.now() - bus.departing.since,
      );
      if (bus.x >= to) {
        bus.sprite.destroy({ children: true });
        continue;
      }
      this.drawBus(bus, false, true, bus.bottom, bus.scale, [], look);
      moving = true;
      kept.push(bus);
    }
    this.buses = kept;
    this.drawWaiting(waiting, sx, sy, z, look);
    this.scheduleChange(quiet);

    const next = this.trips[0];
    const parked = this.buses.find((bus) => !bus.departing)?.rect;
    this.status = {
      // Over the stop, but kept on screen.
      x: Math.min(width - 96, Math.max(96, sx)),
      y: sy - STOP_H * z - 6,
      visible: !!next,
      // The bus's box (canvas pixels), so a press can find it without the canvas.
      bus: parked
        ? [parked.x, parked.y, parked.w, parked.h].map(Math.round).join(",")
        : "",
      text: next
        ? this.held
          ? "Bus held · doors open"
          : `${this.phaseLabel(next, quiet)} · ${Math.ceil(next.leftMs / 1000)}s`
        : "",
    };
    diagnostics().bus = {
      stop: { x: Math.round(sx), y: Math.round(sy) },
      held: this.held,
      buses: this.buses.map((bus) => ({
        x: Math.round(bus.rect.x),
        y: Math.round(bus.rect.y),
        w: Math.round(bus.rect.w),
        h: Math.round(bus.rect.h),
        departing: !!bus.departing,
        passengers: bus.seats.length,
        seats: bus.seats.map(({ rect }) => ({
          x: Math.round(rect.x + rect.w / 2),
          y: Math.round(rect.y + rect.h / 2),
        })),
      })),
      waiting: this.waiting.length,
      hidden: [...this.hidden],
    };
    return moving;
  }

  private phaseLabel(trip: BusTrip, quiet: boolean) {
    const phase = quiet ? "wait" : busPhase(trip.durationMs, trip.leftMs).phase;
    return phase === "arrive"
      ? "Bus arriving"
      : phase === "wait"
        ? "Bus boarding"
        : "Leaving town";
  }

  private newBus(): BusView {
    const sprite = new Sprite(Texture.EMPTY);
    this.container.addChild(sprite);
    return {
      sprite,
      heads: [],
      ids: new Set(),
      x: 0,
      rect: { x: 0, y: 0, w: 0, h: 0 },
      seats: [],
      departing: null,
      bottom: 0,
      scale: 1,
    };
  }

  private drawBus(
    view: BusView,
    open: boolean,
    driving: boolean,
    road: number,
    z: number,
    passengers: readonly BinEntry[],
    look: (key: string) => TownLook,
  ) {
    // Wheels turn and the body bobs with distance, not frames.
    const step = Math.floor(view.x / (3 * z));
    const bob = driving && Math.floor(view.x / (7 * z)) % 2 ? -z : 0;
    const top = road - BUS_H * z + bob;
    view.sprite.texture = textureOf(
      busSprite(open, driving ? ((step & 1) as 0 | 1) : 0),
    );
    view.sprite.scale.set(z);
    view.sprite.position.set(Math.round(view.x), Math.round(top));
    view.rect = { x: view.x, y: top, w: BUS_W * z, h: BUS_H * z };
    view.seats = [];
    passengers.slice(0, BUS_WINDOWS.length).forEach((entry, index) => {
      const window = BUS_WINDOWS[index]!;
      let head = view.heads[index];
      if (!head) {
        head = new Sprite(Texture.EMPTY);
        view.sprite.addChild(head);
        view.heads[index] = head;
      }
      const agent = this.agentOf.get(entry.id) ?? entry.id;
      head.texture = textureOf(busPassengerSprite(look(agent), agent));
      head.position.set(window.x, window.y);
      head.visible = true;
      view.seats.push({
        entry,
        rect: {
          x: view.x + (window.x - 1) * z,
          y: top + (window.y - 1) * z,
          w: 10 * z,
          h: 10 * z,
        },
      });
    });
    for (let i = passengers.length; i < view.heads.length; i += 1)
      view.heads[i]!.visible = false;
  }

  private drawWaiting(
    entries: readonly BinEntry[],
    sx: number,
    sy: number,
    z: number,
    look: (key: string) => TownLook,
  ) {
    const scale = TOWN_AGENT_SCALE * z;
    while (this.waiting.length > entries.length)
      this.waiting.pop()!.sprite.destroy();
    this.waiting = entries.map((entry, index) => {
      const item =
        this.waiting[index] ??
        (() => {
          const sprite = new Sprite(Texture.EMPTY);
          sprite.anchor.set(0.5, 1);
          this.container.addChild(sprite);
          return { entry, sprite, rect: { x: 0, y: 0, w: 0, h: 0 } };
        })();
      const agent = this.agentOf.get(entry.id) ?? entry.id;
      const x = sx - (14 + index * 13) * scale;
      item.entry = entry;
      item.sprite.texture = textureOf(
        townCharacter(look(agent), "right", 0, "carry", false),
      );
      item.sprite.scale.set(scale);
      item.sprite.position.set(Math.round(x), Math.round(sy));
      item.rect = {
        x: x - 8 * scale,
        y: sy - 22 * scale,
        w: 16 * scale,
        h: 24 * scale,
      };
      return item;
    });
  }

  private clearWaiting() {
    for (const item of this.waiting) item.sprite.destroy();
    this.waiting = [];
  }

  /** Wake for the next phase change, since nothing moves while the bus waits. */
  private scheduleChange(quiet: boolean) {
    if (this.nextChange) clearTimeout(this.nextChange);
    this.nextChange = null;
    if (!this.trips.length || this.held) return;
    const soonest = Math.min(
      ...this.trips.map((trip) => {
        const { arriveMs, leaveMs } = busTimes(trip.durationMs);
        const elapsed = trip.durationMs - trip.leftMs;
        if (quiet) return trip.leftMs;
        if (elapsed < arriveMs) return arriveMs - elapsed;
        return trip.leftMs > leaveMs ? trip.leftMs - leaveMs : trip.leftMs;
      }),
    );
    // Also once a second for the timetable.
    this.nextChange = setTimeout(
      () => this.invalidate(),
      Math.max(16, Math.min(1_000, soonest)),
    );
  }
}
