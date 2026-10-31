import { expect, test } from "bun:test";
import { newWorldId } from "./world-identifiers";

test("World IDs check store collisions before returning eight random base32 symbols", () => {
  let draw = 0;
  expect(
    newWorldId(
      "q",
      (id) => id === "q-00000000",
      () => new Uint8Array(8).fill(draw++),
    ),
  ).toBe("q-11111111");
  expect(draw).toBe(2);
  expect(newWorldId("r", () => false)).toMatch(
    /^r-[0123456789abcdefghjkmnpqrstvwxyz]{8}$/,
  );
});

test("a broken random source fails instead of reusing an existing ID", () => {
  expect(() =>
    newWorldId(
      "q",
      () => true,
      () => new Uint8Array(8),
    ),
  ).toThrow("collision");
});

test("malformed entropy and non-kind prefixes cannot form World IDs", () => {
  expect(() =>
    newWorldId(
      "q",
      () => false,
      () => new Uint8Array(7),
    ),
  ).toThrow("eight");
  expect(() => newWorldId("source/native", () => false)).toThrow("kind");
});
