import { CanvasSource, Container, Sprite, Texture } from "pixi.js";
import type { BinEntry } from "../../../../shared/bin";
import type { OfficeAgent } from "../officeProjectionTypes";
import {
  townBusLeaverAt,
  townBusLeavers,
  townBusScene,
  townBusSeen,
  type TownBusScene,
  type TownBusSeen,
  type TownBusLeaver,
} from "./scene/townBus";
import { createTownLookResolver } from "./townAppearance";
import {
  busBoxSprite,
  busPassengerSprite,
  busSprite,
  busStopSprite,
} from "./townBusSprites";
import { townRoomStops } from "./townBusStop";
import { TOWN_TILE as T, type TownLayout } from "./townLayout";
import type { TownWorldOverlay } from "./townRenderer";
import { townCharacter, townLookKey, type TownCanvas } from "./townSprites";

export type TownBusSource = {
  layout(): TownLayout | null;
  entries(): readonly BinEntry[];
  remaining(entry: BinEntry): number;
  elapsed?(entry: BinEntry): number;
  paused(): boolean;
  /** The agent riding as each entry, for its look. */
  agent(entryId: string): OfficeAgent | undefined;
  /** The room each entry's agent belongs to, for its nearest stop. */
  roomOf?(entryId: string): string | undefined;
  /** The layer's clock for emptied buses driving away, ms. */
  now?(): number;
  /** Each drawn frame's scene, so world controls follow the bus as drawn. */
  onDrawn?(scene: TownBusScene): void;
};

/**
 * Town's bus stop and buses as a world overlay: drawn above the town's
 * scene and moved by the renderer's frames, from the headless bus scene.
 */
export class TownBusLayer implements TownWorldOverlay {
  readonly container = new Container();
  private readonly textures = new Map<TownCanvas, Texture>();
  private readonly resolveLook = createTownLookResolver();
  private current: TownBusScene | null = null;
  /** Each bus as last drawn, to see one leave the scene. */
  private seen: TownBusSeen = new Map();
  private roomStops: { layout: TownLayout; stops: Map<string, string> } | null =
    null;
  /** Emptied buses driving off the map; not riders' buses, not targets. */
  private leavers: TownBusLeaver[] = [];
  /** Sprites reused frame to frame; those past `used` are hidden. */
  private readonly pool: Sprite[] = [];
  private used = 0;

  constructor(private readonly source: TownBusSource) {
    this.container.zIndex = 5;
  }

  /** The scene as last drawn, for hit-tests and the DOM controls. */
  get scene() {
    return this.current;
  }

  update(reducedMotion: boolean) {
    const layout = this.source.layout();
    this.used = 0;
    if (!layout) {
      this.hideUnused();
      return false;
    }
    const paused = this.source.paused();
    if (this.roomStops?.layout !== layout)
      this.roomStops = { layout, stops: townRoomStops(layout) };
    const roomStops = this.roomStops.stops;
    const scene = townBusScene({
      stops: layout.busStops,
      width: layout.width * T,
      entries: this.source.entries(),
      homeStop: (entry) => {
        const room = this.source.roomOf?.(entry.id);
        return room === undefined ? undefined : roomStops.get(room);
      },
      remaining: (entry) => this.source.remaining(entry),
      elapsed: this.source.elapsed,
      paused,
      reducedMotion,
    });
    const now = this.source.now?.() ?? performance.now();
    this.leavers.push(
      ...townBusLeavers(
        this.seen,
        scene.buses,
        layout.width * T,
        now,
        reducedMotion,
      ),
    );
    this.seen = townBusSeen(scene.buses);
    this.current = scene;
    for (const stop of scene.stops)
      this.add(busStopSprite(), stop.box.x - 1, stop.box.y - 1);
    const lookOf = (entryId: string) =>
      this.resolveLook(this.source.agent(entryId), entryId);
    for (const rider of scene.waiting) {
      const look = lookOf(rider.entryId);
      const body = townCharacter(look, "down", 0, "stand", false);
      this.add(body, rider.x - body.width / 2, rider.y - body.height);
      const box = busBoxSprite();
      this.add(box, rider.x - box.width / 2, rider.y - body.height / 2);
    }
    this.leavers = this.leavers.filter((leaver) => {
      const at = townBusLeaverAt(leaver, now);
      if (at) this.add(busSprite(false, at.wheel), at.x, leaver.y);
      return at !== null;
    });
    for (const bus of scene.buses) {
      this.add(busSprite(bus.doorsOpen, bus.wheel), Math.round(bus.x), bus.y);
      for (const rider of bus.riders) {
        const look = lookOf(rider.entryId);
        this.add(
          busPassengerSprite(look, `${townLookKey(look)}`),
          rider.x,
          rider.y,
        );
      }
    }
    this.hideUnused();
    this.source.onDrawn?.(scene);
    return (
      this.leavers.length > 0 ||
      scene.buses.some(
        (bus) => bus.phase !== "waiting" && !this.source.paused(),
      )
    );
  }

  private hideUnused() {
    for (let i = this.used; i < this.pool.length; i += 1)
      this.pool[i]!.visible = false;
  }

  destroy() {
    this.container.destroy({ children: true });
    for (const texture of this.textures.values()) texture.destroy(true);
    this.textures.clear();
  }

  private add(canvas: TownCanvas, x: number, y: number) {
    let texture = this.textures.get(canvas);
    if (!texture) {
      texture = new Texture({
        source: new CanvasSource({ resource: canvas, scaleMode: "nearest" }),
      });
      this.textures.set(canvas, texture);
    }
    let sprite = this.pool[this.used];
    if (!sprite) {
      sprite = new Sprite(texture);
      this.pool.push(sprite);
      this.container.addChild(sprite);
    }
    this.used += 1;
    sprite.texture = texture;
    sprite.visible = true;
    sprite.position.set(Math.round(x), Math.round(y));
  }
}
