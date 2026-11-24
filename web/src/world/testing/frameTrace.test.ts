import { expect, test } from "bun:test";
import { gestureTrace } from "./frameTrace";

test("pan metrics exclude cold frames begun before the gesture, retaining actual missing pan content", () => {
  const before = { name: "PipelineReporter", ts: 5, missing: true };
  const during = { name: "PipelineReporter", ts: 15, missing: true };
  const events = [
    before,
    { name: "start", ts: 10 },
    during,
    { name: "end", ts: 20 },
    { name: "PipelineReporter", ts: 25 },
  ];
  expect(gestureTrace(events, "start", "end")).toContain(during);
  expect(gestureTrace(events, "start", "end")).not.toContain(before);
  for (const rows of [
    [],
    events.filter((event) => event.name !== "start"),
    events.filter((event) => event.name !== "end"),
  ])
    expect(() => gestureTrace(rows, "start", "end")).toThrow("boundaries");
});
