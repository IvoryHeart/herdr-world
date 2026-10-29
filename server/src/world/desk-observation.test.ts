import { expect, test } from "bun:test";
import { WorldDeskRegistry } from "./desk-state";
import { deskSessionFingerprint, observeDeskPanes } from "./desk-observation";

const session = {
  source: "reported",
  agent: "codex",
  kind: "id",
  value: "example-session",
};
const pane = {
  terminal_id: "terminal-a",
  agent: "codex",
  agent_session: session,
  agent_status: "working",
};

test("qualified raw pane observations share one stop and reject duplicate native identities", () => {
  const desk = new WorldDeskRegistry();
  observeDeskPanes(desk, "alpha", 1, [pane], 1);
  observeDeskPanes(desk, "alpha", 1, [{ ...pane, agent_status: "idle" }], 2);
  observeDeskPanes(desk, "beta", 1, [pane], 3);
  observeDeskPanes(desk, "beta", 1, [{ ...pane, agent_status: "idle" }], 4);
  expect(desk.list().records.map((entry) => entry.stopped_at)).toEqual([2, 4]);
  expect(desk.list().records[0]!.agent_session_fingerprint).toBe(
    deskSessionFingerprint(session),
  );
  observeDeskPanes(
    desk,
    "alpha",
    1,
    [{ ...pane, agent_status: "done" }, pane],
    5,
  );
  expect(desk.list().records.map((entry) => entry.stopped_at)).toEqual([2, 4]);
});
