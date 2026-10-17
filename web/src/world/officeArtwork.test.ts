import { expect, test } from "bun:test";
import { officeArtwork } from "./officeArtwork";

test("shared furniture survives layer eviction and releases the last context", () => {
  let builds = 0;
  const draw = (
    context: Parameters<Parameters<typeof officeArtwork>[1]>[0],
  ) => {
    builds++;
    context.roundRect(0, 0, 48, 26, 3).fill(0x765b38);
  };
  const a = officeArtwork("synthetic-desk", draw);
  const b = officeArtwork("synthetic-desk", draw);
  const context = a.context;
  expect(b.context).toBe(context);
  expect(Object.getPrototypeOf(b)).toBe(Object.getPrototypeOf(a));
  expect(builds).toBe(1);
  a.destroy({ context: true });
  expect(context.destroyed).toBe(false);
  expect(b.context.instructions).toHaveLength(1);
  b.destroy({ context: true });
  expect(context.destroyed).toBe(true);
  const c = officeArtwork("synthetic-desk", draw);
  expect(c.context).not.toBe(context);
  expect(builds).toBe(2);
  c.destroy();
});
