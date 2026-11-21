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

test("the overflow crowd curses then snores over any status, and unknown is confused at room zoom", () => {
  for (const status of ["blocked", "done"]) {
    expect(
      townBubbleKind(
        status,
        true,
        false,
        "overview",
        "stand",
        false,
        0,
        "grumble",
      ),
    ).toBe("curse");
    expect(
      townBubbleKind(
        status,
        false,
        false,
        "overview",
        "stand",
        false,
        0,
        "nap",
      ),
    ).toBe("sleep");
  }
  for (const level of ["room", "desk"])
    expect(
      townBubbleKind("unknown", false, false, level, "seat", false, 0),
    ).toBe("confused");
  expect(
    townBubbleKind("unknown", false, false, "overview", "seat", false, 0),
  ).toBeNull();
  expect(townBubbleKind("idle", false, false, "room", "seat", false, 0)).toBe(
    "sleep",
  );
});

test("a quiet working agent shows an hourglass at its seat instead of typing", () => {
  // From the room level the step bubble carries the hourglass and its time
  // (TownStepBubble), so the canvas neither types nor repeats it.
  for (const level of ["room", "desk"])
    expect(
      townBubbleKind(
        "working",
        false,
        false,
        level,
        "seat",
        true,
        1,
        null,
        false,
        true,
      ),
    ).toBeNull();
  for (const level of ["overview"])
    expect(
      townBubbleKind(
        "working",
        false,
        false,
        level,
        "seat",
        true,
        1,
        null,
        false,
        true,
      ),
    ).toBe("quiet");
  // Not working, asking or away from its seat: the usual marks.
  expect(
    townBubbleKind(
      "idle",
      false,
      false,
      "room",
      "seat",
      false,
      0,
      null,
      false,
      true,
    ),
  ).toBe("sleep");
  expect(
    townBubbleKind(
      "working",
      true,
      false,
      "room",
      "seat",
      false,
      0,
      null,
      false,
      true,
    ),
  ).toBe("ask");
  expect(
    townBubbleKind(
      "working",
      false,
      false,
      "room",
      "walk",
      false,
      0,
      null,
      false,
      true,
    ),
  ).toBeNull();
  // Once the session moves again it types as before.
  expect(
    townBubbleKind(
      "working",
      false,
      false,
      "room",
      "seat",
      true,
      1,
      null,
      false,
      false,
    ),
  ).toBe("typing1");
});
