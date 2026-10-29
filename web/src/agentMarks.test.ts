import { expect, test } from "bun:test";
import { AGENT_MARKS, agentMarkKind, agentStateWord } from "./agentMarks";

test("each state has one glyph and one word", () => {
  expect(
    Object.entries(AGENT_MARKS).map(([kind, { glyph, word }]) => [
      kind,
      glyph,
      word,
    ]),
  ).toEqual([
    ["working", "•", "Working"],
    ["needs", "!", "Needs you"],
    ["asks", "?", "Asks you"],
    ["done", "✓", "Done"],
    ["reviewed", "–", "Reviewed"],
    ["idle", "–", "Idle"],
    ["no-signal", "~", "No signal"],
    ["offline", "×", "Offline"],
  ]);
  // Only an owner question is ?, so no signal never reads as one.
  expect(
    Object.values(AGENT_MARKS).filter(({ glyph }) => glyph === "?"),
  ).toHaveLength(1);
});

test("Herdr statuses map to marks; an ask and an offline host outrank them", () => {
  expect(agentMarkKind("working")).toBe("working");
  expect(agentMarkKind("blocked")).toBe("needs");
  expect(agentMarkKind("done")).toBe("done");
  expect(agentMarkKind("done", { reviewed: true })).toBe("reviewed");
  expect(agentMarkKind("idle")).toBe("idle");
  expect(agentMarkKind("unknown")).toBe("no-signal");
  expect(agentMarkKind(null)).toBe("no-signal");
  expect(agentMarkKind("working", { asking: true })).toBe("asks");
  expect(agentMarkKind("blocked", { asking: true, offline: true })).toBe(
    "offline",
  );
  expect(agentStateWord("blocked")).toBe("Needs you");
  expect(agentStateWord("idle", { asking: true })).toBe("Asks you");
});
