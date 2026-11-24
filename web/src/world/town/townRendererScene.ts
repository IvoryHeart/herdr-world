/**
 * Building the Town renderer's scene: retained textures for painted canvases,
 * the outdoor items and fountain, and each building's baked interior, façade,
 * roof and furniture. The renderer (townRenderer.ts) decides when to build;
 * these functions build what it asks for, from explicit inputs.
 */

import { CanvasSource, Container, Graphics, Sprite, Texture } from "pixi.js";
import type { OfficeDesk } from "../herdrOfficeProjection";
import type { TerminalColor } from "../terminalColor";
import {
  TOWN_AGENT_SCALE,
  TOWN_TILE as T,
  townDeskSlots,
  townDeskTable,
  type TownBuilding,
  type TownCell,
  type TownLayout,
} from "./townLayout";
import { townBusRoute } from "./townBus";
import { paintTownCenter } from "./townCenterPaint";
import { townApartmentsLot } from "./townApartmentsLot";
import { paintTownApartments } from "./townApartmentsPaint";
import { townHarbourLot } from "./townHarbour";
import {
  paintTownWarehouseHouse,
  paintTownWarehouseYard,
} from "./townHarbourArt";
import { townPostLotBeside } from "./townPostLot";
import { townLibraryLot } from "./townLibraryLot";
import {
  paintTownLibraryHouse,
  paintTownLibraryYard,
} from "./townLibraryPaint";
import { townObservatoryLot } from "./townObservatoryLot";
import { paintTownObservatory } from "./townObservatoryPaint";
import { paintTownPostHouse, paintTownPostYard } from "./townPostPaint";
import {
  paintTownFacade,
  paintTownInterior,
  paintTownRoof,
  type TownHostTheme,
} from "./townPaint";
import {
  TOWN_BUS_STOP_SIGN,
  townCanvas,
  townCharacter,
  townHash,
  townLookFor,
  type TownCanvas,
  type TownStaticSprites,
} from "./townSprites";
import type { TownBuildingMotion } from "./townTransition";

const textureCache = new WeakMap<TownCanvas, Texture>();
export function textureOf(canvas: TownCanvas) {
  let texture = textureCache.get(canvas);
  if (!texture) {
    texture = new Texture({
      source: new CanvasSource({ resource: canvas, scaleMode: "nearest" }),
    });
    textureCache.set(canvas, texture);
  }
  return texture;
}

let glowCanvas: TownCanvas | null = null;
function glowTexture() {
  if (!glowCanvas) {
    const [canvas, g] = townCanvas(64, 64);
    const gradient = g.createRadialGradient(32, 32, 1, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,0.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gradient;
    g.fillRect(0, 0, 64, 64);
    glowCanvas = canvas;
  }
  return textureOf(glowCanvas);
}

/** One seat's sprites: a top seat has a person and laptop lid, a bottom seat a screen and back. */
export type SeatView = {
  top: boolean;
  person: Sprite;
  device: Sprite;
  glow: Sprite;
  /** Finished work left at the seat until the user checks it. */
  papers: Sprite;
};

export type PodView = {
  container: Container;
  deskKey: string;
  seats: SeatView[];
  item: Sprite | null;
  cell: TownCell;
};

export type BuildingView = {
  hostKey: string;
  /** Where it was baked, in tiles; its drawings are placed in world pixels. */
  x: number;
  y: number;
  /** Its baked size, in tiles. */
  w: number;
  h: number;
  /** The bake key it was drawn from (scene/townSceneBake.ts). */
  key: string;
  /** Gliding or fading in after a topology change (townTransition.ts). */
  motion: TownBuildingMotion | null;
  container: Container;
  interior: Sprite;
  dim: Graphics;
  dynamic: Container;
  facade: Sprite;
  stub: Sprite;
  roof: Sprite;
  roofAlpha: number;
  pods: PodView[];
  textures: Texture[];
};

export type TownOutdoorItem = { x: number; y: number; place: () => void };

/**
 * The town's outdoor items, each placed when the ground chunk under it is
 * painted, and the plaza fountain, added to `outdoor` now. Bus stop signs
 * stand with the lamps, in the scene's depth order; each placed sign goes
 * into `signs` by stop key, its flag red while `waiting` says so.
 */
export function townOutdoor(
  layout: TownLayout,
  sprites: TownStaticSprites,
  outdoor: Container,
  signs: Map<string, Sprite>,
  waiting: (stopKey: string) => boolean,
): TownOutdoorItem[] {
  const add = (canvas: TownCanvas, x: number, y: number, z: number) => {
    const sprite = new Sprite(textureOf(canvas));
    sprite.position.set(x, y);
    sprite.zIndex = z;
    outdoor.addChild(sprite);
    return sprite;
  };
  // Lamps, bushes and benches join the scene with the ground chunk under them.
  const outdoorItems: TownOutdoorItem[] = [];
  for (const lamp of layout.lamps)
    outdoorItems.push({
      x: lamp.x * T,
      y: lamp.y * T,
      place: () =>
        add(sprites.lamp, lamp.x * T + 5, lamp.y * T - 22, lamp.y * T + 8),
    });
  // The pole stands just right of where the stop's first rider waits.
  const route = townBusRoute(layout);
  for (const stop of route.stops)
    outdoorItems.push({
      x: stop.wait.x,
      y: stop.wait.y,
      place: () =>
        signs.set(
          stop.key,
          add(
            waiting(stop.key) ? sprites.busStopWaiting : sprites.busStop,
            stop.wait.x + 1,
            stop.wait.y - TOWN_BUS_STOP_SIGN.height,
            stop.wait.y + 1,
          ),
        ),
    });
  // Apartments' stop, where every bus ends (townBus.ts), stands the same way.
  const terminus = route.terminus?.sign;
  if (terminus)
    outdoorItems.push({
      x: terminus.x,
      y: terminus.y,
      place: () =>
        add(
          sprites.busTerminus,
          terminus.x + 1,
          terminus.y - TOWN_BUS_STOP_SIGN.height,
          terminus.y + 1,
        ),
    });
  for (const bush of layout.bushes)
    outdoorItems.push({
      x: bush.x * T,
      y: bush.y * T,
      place: () =>
        add(sprites.bush, bush.x * T - 2, bush.y * T + 2, bush.y * T + 13),
    });
  for (const bench of layout.benches)
    outdoorItems.push({
      x: bench.x * T,
      y: bench.y * T,
      place: () =>
        add(sprites.bench, bench.x * T, bench.y * T + 2, bench.y * T + 12),
    });
  outdoorItems.push({
    x: layout.board.x * T,
    y: layout.board.y * T,
    place: () =>
      add(
        sprites.board,
        layout.board.x * T - 8,
        layout.board.y * T - 16,
        layout.board.y * T + 14,
      ),
  });
  const fountain = new Graphics();
  const fx = layout.plaza.x * T + 8;
  const fy = layout.plaza.y * T + 4;
  fountain
    .ellipse(fx + 2, fy + 6, 26, 12)
    .fill({ color: 0x000000, alpha: 0.18 })
    .ellipse(fx, fy + 2, 25, 11)
    .fill(0x9d978c)
    .ellipse(fx, fy, 25, 11)
    .fill(0xb9b2a5)
    .ellipse(fx, fy, 20, 8)
    .fill(0x4f9fd3)
    .ellipse(fx, fy - 1, 15, 5)
    .fill(0x6fb9e6)
    .rect(fx - 3, fy - 14, 6, 14)
    .fill(0x9d978c)
    .rect(fx - 5, fy - 16, 10, 3)
    .fill(0xb9b2a5);
  fountain.zIndex = fy + 12;
  outdoor.addChild(fountain);
  // The town center: Town's landmark, standing above the first street.
  const center = layout.center;
  add(
    paintTownCenter(center.w),
    center.x * T,
    center.y * T,
    (center.y + center.h) * T,
  );
  // The post office left of the center: its house, its yard on the street.
  const post = townPostLotBeside(center);
  add(paintTownPostHouse(), post.x * T, post.y * T, post.yardY * T);
  add(paintTownPostYard(), post.x * T, post.yardY * T, post.yardY * T);
  // The harbour at the town's right edge: the warehouse on the shore, its
  // yard on the first street. Piers stand only for projects with releases,
  // so the Shipyard's DOM layer draws them (TownShipyard.tsx).
  const house = townHarbourLot(layout).warehouse;
  add(paintTownWarehouseHouse(), house.x * T, house.y * T, house.yardY * T);
  add(paintTownWarehouseYard(), house.x * T, house.yardY * T, house.yardY * T);
  // The library right of the center: its hall, its reading garden.
  const library = townLibraryLot(layout);
  add(paintTownLibraryHouse(), library.x * T, library.y * T, library.yardY * T);
  add(
    paintTownLibraryYard(),
    library.x * T,
    library.yardY * T,
    library.yardY * T,
  );
  // The observatory right of the library, its door on the street.
  const observatory = townObservatoryLot(layout);
  add(
    paintTownObservatory(),
    observatory.x * T,
    observatory.y * T,
    (observatory.y + observatory.h) * T,
  );
  // The apartment building beside the plaza, where finished agents live on.
  const apartments = townApartmentsLot(layout);
  if (apartments)
    add(
      paintTownApartments(),
      apartments.x * T,
      apartments.y * T,
      (apartments.y + apartments.h) * T,
    );
  return outdoorItems;
}

/** What baking a building reads besides its geometry. */
export type TownBuildingBake = {
  theme: TownHostTheme;
  /** A stale host's roof shows it. */
  stale: boolean;
  sprites: TownStaticSprites;
  colorFor: (deskKey: string) => TerminalColor;
  carpetFor: (roomKey: string) => string | undefined;
  /** Pinned desks: their seats share a rug (townPaint.ts). */
  pinned: (deskKey: string) => boolean;
  /** Wrap a painted canvas as a texture this building owns. */
  own: (canvas: TownCanvas) => Texture;
  /** The textures `own` made, destroyed with the building. */
  textures: Texture[];
  roofAlpha: number;
  /** The building's bake key, kept on its view. */
  key: string;
};

/** Bake one building's textures and retained sprites; its desks' pods come later. */
export function bakeTownBuilding(
  building: TownBuilding,
  bake: TownBuildingBake,
): { view: BuildingView; pendingCells: TownCell[] } {
  const { theme, stale, sprites, own } = bake;
  const container = new Container();
  container.zIndex = (building.y + building.h) * T + 4;
  const interior = new Sprite(
    own(
      paintTownInterior(building, theme, {
        table: sprites.table,
        tableSmall: sprites.tableSmall,
        chair: sprites.chair,
        chairBack: sprites.chairBack,
        colorFor: bake.colorFor,
        carpetFor: bake.carpetFor,
        pinned: bake.pinned,
      }),
    ),
  );
  interior.position.set(building.x * T, building.y * T);
  const dim = new Graphics();
  const dynamic = new Container();
  dynamic.sortableChildren = true;
  const facadeCanvas = paintTownFacade(building, theme);
  const facade = new Sprite(own(facadeCanvas));
  facade.position.set(building.x * T, (building.y + building.h) * T);
  const [stubCanvas, stubContext] = townCanvas(facadeCanvas.width, 9);
  stubContext.drawImage(facadeCanvas, 0, -23);
  const stub = new Sprite(own(stubCanvas));
  stub.position.set(building.x * T, (building.y + building.h) * T);
  const roof = new Sprite(own(paintTownRoof(building, theme, stale)));
  roof.position.set(building.x * T - 4, building.y * T - 12);
  container.addChild(interior, dynamic, dim, stub, facade, roof);

  for (const plant of building.plants) {
    const sprite = new Sprite(textureOf(sprites.plant));
    sprite.position.set(plant.x * T, (plant.y + 1) * T - 24);
    sprite.zIndex = (plant.y + 1) * T - 2;
    dynamic.addChild(sprite);
  }
  const L = building.lounge;
  for (const [canvas, x, y] of [
    [sprites.sofa, (L.x + 1) * T - 1, (L.y + 1) * T - 8],
    [sprites.coffee, (L.x + 7) * T + 1, (L.y + 1) * T - 10],
    [sprites.cooler, (L.x + 8) * T + 2, (L.y + 1) * T - 12],
  ] as const) {
    const sprite = new Sprite(textureOf(canvas));
    sprite.position.set(x, y);
    sprite.zIndex = (L.y + 2) * T - 2;
    dynamic.addChild(sprite);
  }
  const counterX = building.doorX * T;
  const counterY = (building.counter.y + 1) * T - 8;
  const me = new Sprite(
    textureOf(townCharacter(townLookFor("you"), "down", 0, "sit", false)),
  );
  me.position.set(counterX - 7, counterY - 11);
  const meChair = new Sprite(textureOf(sprites.chair));
  meChair.position.set(counterX - 7, counterY - 14);
  const counter = new Sprite(textureOf(sprites.counter));
  counter.position.set(counterX - 41, counterY);
  const counterLid = new Sprite(textureOf(sprites.lid.claude!));
  counterLid.position.set(counterX - 23, counterY - 4);
  const reception = new Container();
  reception.addChild(meChair, me, counter, counterLid);
  reception.zIndex = (building.counter.y + 3) * T - 2;
  dynamic.addChild(reception);

  // Tables and chairs are baked into the interior; the detailed desk
  // sprites (people, screens, glow) are created on demand from the room level.
  const pods: PodView[] = [];
  const pendingCells: TownCell[] = [];
  for (const room of building.rooms)
    for (const cell of room.cells) if (cell.deskKey) pendingCells.push(cell);
  return {
    view: {
      hostKey: building.hostKey,
      x: building.x,
      y: building.y,
      w: building.w,
      h: building.h,
      key: bake.key,
      motion: null,
      container,
      interior,
      dim,
      dynamic,
      facade,
      stub,
      roof,
      roofAlpha: bake.roofAlpha,
      pods,
      textures: bake.textures,
    },
    pendingCells,
  };
}

/** The desk pin's head: the pinned rug's cream, never a status colour. */
const TOWN_PIN_HEAD = 0xe7dcc0;

/** What baking a desk's pod reads besides its cell. */
export type TownPodBake = {
  desk: OfficeDesk;
  /** The table's colour: its tab's terminal colour. */
  wood: TerminalColor;
  pinned: boolean;
  sprites: TownStaticSprites;
};

/**
 * Bake a desk's detailed sprites (people, laptops and screens, glow, papers,
 * an item and its pin) into `parent`, layered back to front.
 */
export function bakeTownPod(
  cell: TownCell,
  parent: Container,
  bake: TownPodBake,
): PodView {
  {
    const { desk, sprites } = bake;
    const container = new Container();
    const X = (cell.x + 1) * T;
    const Y = cell.y * T;
    container.zIndex = Y + 52;
    const wood = bake.wood;
    const make = (canvas: TownCanvas | null, x: number, y: number) => {
      const sprite = new Sprite(canvas ? textureOf(canvas) : Texture.EMPTY);
      sprite.position.set(x, y);
      container.addChild(sprite);
      return sprite;
    };
    const glow = (x: number, y: number, size: number) => {
      const sprite = new Sprite(glowTexture());
      sprite.anchor.set(0.5);
      sprite.position.set(x, y);
      sprite.width = sprite.height = size;
      sprite.blendMode = "add";
      sprite.visible = false;
      return sprite;
    };
    const place = townDeskTable(cell.seats);
    const shadow = new Graphics()
      .rect(X + place.x + 4, Y + 50, place.w - 2, 4)
      .fill({ color: 0x000000, alpha: 0.2 });
    container.addChild(shadow);
    const slots = townDeskSlots(cell.seats);
    // Layered back to front: top chairs and people, the table, then laptops,
    // screens, the people seen from behind and their chair backs.
    for (const slot of slots)
      if (slot.top) make(sprites.chair, X + slot.chairX, Y + 2);
    // Seated agents keep their feet (facing) or head (from behind) in place.
    const seated = (sprite: Sprite, x: number, y: number, top: boolean) => {
      sprite.anchor.set(0.5, top ? 1 : 0);
      sprite.position.set(x + 7, top ? y + 20 : y);
      sprite.scale.set(TOWN_AGENT_SCALE);
      return sprite;
    };
    const people = slots.map((slot) =>
      slot.top ? seated(make(null, 0, 0), X + slot.chairX, Y + 5, true) : null,
    );
    make(
      (cell.seats <= 2 ? sprites.tableSmall : sprites.table)[wood]!,
      X + place.x,
      Y + 17,
    );
    const devices = slots.map((slot) =>
      make(
        slot.top ? sprites.lidOff : null,
        X + slot.chairX,
        slot.top ? Y + 13 : Y + 26,
      ),
    );
    const itemIndex = townHash(`${desk.key}:item`) % 4;
    const itemX = X + (cell.seats <= 2 ? 41 : 29);
    const item =
      itemIndex === 0
        ? make(sprites.mug, itemX + 1, Y + 22)
        : itemIndex === 1
          ? make(sprites.cactus, itemX, Y + 19)
          : null;
    const glows = slots.map((slot) =>
      slot.top
        ? glow(X + slot.chairX + 7, Y + 12, 38)
        : glow(X + slot.chairX + 7, Y + 30, 30),
    );
    for (const sprite of glows) container.addChild(sprite);
    // Beside the laptop or screen, on the table top.
    const papers = slots.map((slot) => {
      const sprite = make(
        sprites.papers,
        X + slot.chairX + 14,
        slot.top ? Y + 18 : Y + 28,
      );
      sprite.visible = false;
      return sprite;
    });
    const backs = slots.map((slot) =>
      slot.top
        ? null
        : seated(make(null, 0, 0), X + slot.chairX, Y + 34, false),
    );
    for (const slot of slots)
      if (!slot.top) make(sprites.chairBack, X + slot.chairX, Y + 45);
    // A pinned desk wears a quiet pin on its table's front-left corner: the
    // one corner the goal pennant, status marks, nameplate, devices and
    // papers never use, at any seat count. Never an attention colour; the
    // rug under the room's pinned seats is the group cue.
    if (bake.pinned) {
      const px = X + place.x + 5;
      const py = Y + 36;
      container.addChild(
        new Graphics()
          .moveTo(px, py)
          .lineTo(px - 2, py + 5)
          .stroke({ color: 0x4a4038, width: 1 })
          .circle(px, py, 2.5)
          .fill(TOWN_PIN_HEAD)
          .stroke({ color: 0x5a4c3e, width: 1 }),
      );
    }
    parent.addChild(container);
    return {
      container,
      deskKey: desk.key,
      seats: slots.map((slot, seat) => ({
        top: slot.top,
        person: (people[seat] ?? backs[seat])!,
        device: devices[seat]!,
        glow: glows[seat]!,
        papers: papers[seat]!,
      })),
      item,
      cell,
    };
  }
}
