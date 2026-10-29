import { expect, test } from "bun:test";
import { townBubbleKind } from "./townBubbleKind";

test("the same asking state stays visible until answered without masking urgent blocking", () => {
  for (const status of ["idle", "working", "done", "unknown"])
    expect(
      townBubbleKind(status, true, true, "building", "stand", false, 0),
    ).toBe("ask");
  expect(
    townBubbleKind("blocked", true, false, "building", "stand", false, 0),
  ).toBe("blocked");
  expect(
    townBubbleKind("idle", false, true, "building", "stand", false, 0),
  ).toBeNull();
});
