import { expect, test } from "bun:test";
import {
  freshHerdrIdentity,
  observeHerdrIdentity,
  herdrCompatibility,
} from "./herdrIdentity";

test("running-server observations expire and never identify an installed binary", () => {
  const value = observeHerdrIdentity({ version: "0.9.5", protocol: 22 }, 1000);
  expect(value).toMatchObject({
    source: "running-server",
    readAt: 1000,
    expiresAt: 61000,
    installedBinary: null,
  });
  expect(freshHerdrIdentity(value, 1000)).toEqual(value);
  expect(freshHerdrIdentity(value, 60999)).toEqual(value);
  for (const now of [999, 61000, NaN, Infinity])
    expect(freshHerdrIdentity(value, now)).toBeNull();
});

test("invalid, missing, forged or unbounded observations stay unknown", () => {
  for (const raw of [
    null,
    {},
    { version: "", protocol: 22 },
    { version: "garbage", protocol: 22 },
    { version: "0.9.5", protocol: NaN },
    { version: "0.9.5", protocol: 1.5 },
  ])
    expect(observeHerdrIdentity(raw, 1000)).toBeNull();
  const value = observeHerdrIdentity({ version: "0.9.5", protocol: 22 }, 1000)!;
  for (const patch of [
    { source: "binary" },
    { expiresAt: 999999 },
    { installedBinary: "0.9.5" },
    { readAt: null },
  ])
    expect(freshHerdrIdentity({ ...value, ...patch }, 1000)).toBeNull();
});

test("compatibility follows the supported protocol set, never version guesses", () => {
  for (const protocol of [14, 15, 16, 17, 18, 19, 20, 22])
    expect(herdrCompatibility(protocol)).toBe("supported");
  expect(herdrCompatibility(13)).toBe("too-old");
  expect(herdrCompatibility(23)).toBe("too-new");
  expect(herdrCompatibility(21)).toBe("incompatible");
});
