import { CanvasSource, Container, Sprite, Texture } from "pixi.js";
import type { BinEntry } from "../../../../shared/bin";
import type { OfficeAgent } from "../officeProjectionTypes";
import {
  townBusChanges,
  townBusScene,
  townBusSeen,
  type TownBusScene,
  type TownBusSeen,
} from "./scene/townBus";
import { createTownLookResolver } from "./townAppearance";
import {
  busBoxSprite,
  busPassengerSprite,
  busSprite,
  busStopSprite,
} from "./townBusSprites";
import { TOWN_TILE as T, type TownLayout } from "./townLayout";
import type { TownWorldOverlay } from "./townRenderer";
import { townCharacter, townLookKey, type TownCanvas } from "./townSprites";

export type TownBusSource = {
  layout(): TownLayout | null;
  entries(): readonly BinEntry[];
  remaining(entry: BinEntry): number;
  paused(): boolean;
  /** The agent riding as each entry, for its look. */
  agent(entryId: string): OfficeAgent | undefined;
  /** A bus pulled in at the stop (its horn). */
  onArrive?(): void;
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
  /** Each bus as last drawn, to see a restarted clock and an arrival. */
  private seen: TownBusSeen = new Map();
  /** Where buses whose clock restarted drive on from (townBusScene `starts`). */
  private readonly starts = new Map<string, number>();
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
    const sceneNow = () =>
      townBusScene({
        stop: layout.busStop,
        width: layout.width * T,
        entries: this.source.entries(),
        remaining: (entry) => this.source.remaining(entry),
        paused,
        reducedMotion,
        starts: this.starts,
      });
    let scene = sceneNow();
    // An agent boarded: its bus's clock started again, and it drives on
    // from where it is rather than from the map's edge.
    const { restarts } = townBusChanges(this.seen, scene.buses, paused);
    if (restarts.size) {
      for (const [key, x] of restarts) this.starts.set(key, x);
      scene = sceneNow();
    }
    const { arrivals } = townBusChanges(this.seen, scene.buses, paused);
    if (arrivals) this.source.onArrive?.();
    this.seen = townBusSeen(scene.buses);
    for (const key of this.starts.keys())
      if (!this.seen.has(key)) this.starts.delete(key);
    this.current = scene;
    this.add(busStopSprite(), scene.stop.x - 1, scene.stop.y - 1);
    const lookOf = (entryId: string) =>
      this.resolveLook(this.source.agent(entryId), entryId);
    for (const rider of scene.waiting) {
      const look = lookOf(rider.entryId);
      const body = townCharacter(look, "down", 0, "stand", false);
      this.add(body, rider.x - body.width / 2, rider.y - body.height);
      const box = busBoxSprite();
      this.add(box, rider.x - box.width / 2, rider.y - body.height / 2);
    }
    for (const bus of scene.buses) {
      const x = Math.round(bus.x);
      this.add(busSprite(bus.doorsOpen, bus.wheel), x, bus.y);
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
    return scene.buses.some(
      (bus) => bus.phase !== "waiting" && !this.source.paused(),
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
