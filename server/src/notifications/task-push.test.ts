import { expect, test } from "bun:test";
import { connectionTaskPush } from "./task-push";

const event = { kind: "completed" as const, agent: "claude", paneId: "t1" };

test("a push names its connection only when World has several", () => {
  const herdr = { id: "box", label: "Box" };
  const core = { id: "box-core", label: "Box core" };
  expect(connectionTaskPush(event, "box", 3, [herdr])).toEqual({
    ...event,
    connectionId: "box",
    connectionLabel: undefined,
    runtimeGeneration: 3,
  });
  // A Herdr and a herdr-core connection: both runtimes' pushes are named.
  expect(
    connectionTaskPush(event, "box-core", 1, [herdr, core]).connectionLabel,
  ).toBe("Box core");
  expect(
    connectionTaskPush(event, "gone", 1, [herdr, core], "Fallback")
      .connectionLabel,
  ).toBe("Fallback");
});
