import { afterAll, beforeAll, expect, test } from "bun:test";
import { TownLand } from "./townLandscape";

/*
 * Landscape tiles are cached by kind, variant bucket and edges. The drawing
 * must depend on nothing else, or the same layout and seed would paint
 * different pixels depending on which tile of a bucket was painted first
 * (the initial viewport or chunk order). Two fresh module instances visit
 * the same tiles in opposite orders and must paint them identically.
 */

/** A canvas that records what is drawn on it, so paintings compare as text. */
class RecordingCanvas {
  width = 0;
  height = 0;
  readonly log: string[] = [];
  #context: unknown = null;
  getContext() {
    const log = this.log;
    this.#context ??= new Proxy(
      {},
      {
        get:
          (_, name: string) =>
          (...args: unknown[]) =>
            log.push(`${name}(${args.map(String).join(",")})`),
        set: (_, name: string, value: unknown) => {
          log.push(`${name}=${String(value)}`);
          return true;
        },
      },
    );
    return this.#context;
  }
  painted() {
    return `${this.width}x${this.height}[${this.log.join(";")}]`;
  }
}

const realDocument = globalThis.document;
beforeAll(() => {
  globalThis.document = {
    createElement: () => new RecordingCanvas(),
  } as unknown as Document;
});
afterAll(() => {
  globalThis.document = realDocument;
});

type Paint = typeof import("./townLandscapePaint");
let instance = 0;
const fresh = async (): Promise<Paint> =>
  import(`./townLandscapePaint.ts?order=${(instance += 1)}`);

const KINDS = [
  TownLand.forest,
  TownLand.trail,
  TownLand.lane,
  TownLand.water,
  TownLand.bed,
  TownLand.gravel,
  TownLand.lawn,
];

test("a landscape tile paints the same whichever tile of its bucket comes first", async () => {
  // Hashes from a wide one-host layout that share a forest bucket; the
  // lawn's variant is its column, which may be negative.
  const pairs: [number, number][] = [
    [2506777111, 2620918093],
    [7, 7 + 6 * 12 * 1000],
    [-3, 9],
  ];
  for (const kind of KINDS)
    for (const [a, b] of pairs)
      for (const same of [0, 5, 15]) {
        const first = await fresh();
        const second = await fresh();
        const forward = first.townLandTile(kind, a, same);
        first.townLandTile(kind, b, same);
        second.townLandTile(kind, b, same);
        const backward = second.townLandTile(kind, a, same);
        expect((backward as unknown as RecordingCanvas).painted()).toBe(
          (forward as unknown as RecordingCanvas).painted(),
        );
      }
});

test("different buckets and edges still paint different tiles", async () => {
  const paint = await fresh();
  const painted = (kind: number, variant: number, same: number) =>
    (
      paint.townLandTile(kind, variant, same) as unknown as RecordingCanvas
    ).painted();
  for (const kind of KINDS)
    expect(painted(kind, 0, 15)).not.toBe(painted(kind, 1, 15));
  for (const kind of [TownLand.trail, TownLand.lane, TownLand.water])
    expect(painted(kind, 0, 0)).not.toBe(painted(kind, 0, 15));
});
