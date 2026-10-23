import { expect, test } from "bun:test";
import { middleEllipsis } from "./middleEllipsis";

test("a long agent name keeps its start and harness", () => {
  expect(middleEllipsis("otter-claude", 14)).toBe("otter-claude");
  expect(middleEllipsis("lighthouse-claude", 14)).toBe("lighth…-claude");
  expect(middleEllipsis("lighthouse-claude", 14)).toHaveLength(14);
});
