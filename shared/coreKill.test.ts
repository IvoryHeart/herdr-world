import { expect, test } from "bun:test";
import { coreAlsoEndedText } from "./coreKill";

test("names what core's cascade also ended, three at most", () => {
  expect(coreAlsoEndedText(undefined)).toBeNull();
  expect(coreAlsoEndedText([])).toBeNull();
  expect(coreAlsoEndedText([{ address: "t4", name: null }])).toBe(
    "herdr-core also ended t4, started after you confirmed.",
  );
  const many = ["a", "b", "c", "d", "e"].map((name, i) => ({
    address: `t${i + 2}`,
    name,
  }));
  expect(coreAlsoEndedText(many)).toBe(
    "herdr-core also ended a, b, c and 2 more, started after you confirmed.",
  );
});
