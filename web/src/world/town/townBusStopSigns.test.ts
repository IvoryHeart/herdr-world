import { afterAll, beforeAll, expect, test } from "bun:test";
import { Container, type Sprite } from "pixi.js";
import { townBusRoute } from "./townBus";
import { layoutTown, TOWN_SHAPES, type TownInput } from "./townLayout";
import { textureOf, townOutdoor } from "./townRendererScene";
import { buildTownSprites } from "./townSprites";

/*
 * Bus stop signs are street furniture (#888): the canvas draws one at every
 * stop with the lamps, in the scene's depth order, not as a page overlay
 * drawn over everything.
 */

/** A canvas stand-in: the sprites only need somewhere to draw. */
class StubCanvas {
  width = 0;
  height = 0;
  getContext() {
    return new Proxy(
      {},
      {
        get: () => () => ({ addColorStop() {} }),
        set: () => true,
      },
    );
  }
}

const realDocument = globalThis.document;
beforeAll(() => {
  globalThis.document = {
    createElement: () => new StubCanvas(),
  } as unknown as Document;
});
afterAll(() => {
  globalThis.document = realDocument;
});

const town = (hosts: number): TownInput => ({
  hosts: Array.from({ length: hosts }, (_, i) => ({
    key: `h${i}`,
    displayOrder: i,
  })),
  rooms: Array.from({ length: hosts }, (_, i) => ({
    key: `h${i}/r0`,
    hostKey: `h${i}`,
    order: 0,
    deskKeys: [`h${i}/r0/t0`],
  })),
});

test("every stop, the leftmost included, has a sign drawn among the lamps", () => {
  const sprites = buildTownSprites();
  for (const shape of [TOWN_SHAPES.phone, TOWN_SHAPES.wide])
    for (const hosts of [1, 3, 6]) {
      const { layout } = layoutTown(town(hosts), shape);
      const stops = townBusRoute(layout).stops;
      const outdoor = new Container();
      const signs = new Map<string, Sprite>();
      const waiting = stops[0]!.key;
      const items = townOutdoor(
        layout,
        sprites,
        outdoor,
        signs,
        (key) => key === waiting,
      );
      for (const item of items) item.place();
      expect([...signs.keys()].sort()).toEqual(
        stops.map((stop) => stop.key).sort(),
      );
      const leftmost = Math.min(...stops.map((stop) => stop.wait.x));
      const edge = layout.verticalRoads.find((road) => road.edge)!;
      expect(leftmost).toBeLessThan(edge.x * 16);
      for (const stop of stops) {
        const sign = signs.get(stop.key)!;
        // In the outdoor layer with the lamps, ordered by where it stands.
        expect(sign.parent).toBe(outdoor);
        expect(sign.zIndex).toBe(stop.wait.y + 1);
        // Standing on its waiting point: the pole's foot at the pavement.
        expect(sign.x).toBe(stop.wait.x + 1);
        expect(sign.y + sign.height - 1).toBe(stop.wait.y + 1);
        expect(sign.texture).toBe(
          textureOf(
            stop.key === waiting ? sprites.busStopWaiting : sprites.busStop,
          ),
        );
      }
    }
});
