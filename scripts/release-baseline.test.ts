import { expect, test } from "bun:test";
import { stableBefore } from "./release-baseline";

test("expired candidate recovery never upgrades from a newer or equal stable release", () => {
  for (const version of ["0.3.8", "0.3.8-rc.1"])
    for (const [tag, valid] of [
      ["v0.3.7", true],
      ["v0.3.8", false],
      ["v0.3.9", false],
      ["v0.3.8-rc.1", false],
      ["v0.2.99", true],
      ["v1.0.0", false],
    ] as const)
      expect(stableBefore(tag, version)).toBe(valid);
});
