import { expect, test } from "bun:test";
import { createTerminalMarks } from "./terminal-marks";

const session = (value: string) => ({
  source: "reported",
  agent: "codex",
  kind: "id",
  value,
});
const identity = {
  connection_id: "alpha",
  connection_generation: 7,
  terminal_id: "t1",
};

/** One host read: the pane's current session and status, and an agent.list row. */
function hostRead(
  marks: ReturnType<typeof createTerminalMarks>,
  pane: { session: string; status: string },
  row: { session: string; status: string },
) {
  marks.observe(
    "alpha",
    7,
    [
      {
        pane_id: "p1",
        terminal_id: "t1",
        agent: "codex",
        agent_session: session(pane.session),
        agent_status: pane.status,
      },
    ],
    Date.now(),
    [
      {
        pane_id: "p1",
        terminal_id: "t1",
        agent_session: session(row.session),
        agent_status: row.status,
      },
    ],
  );
}

const fresh = () =>
  createTerminalMarks(
    () => () => {},
    () => {},
  );

test("a previous session's working row does not end the current check", () => {
  const marks = fresh();
  marks.worldCompletionSeen.mark(identity);

  hostRead(
    marks,
    { session: "current", status: "idle" },
    { session: "previous", status: "working" },
  );

  expect(marks.worldCompletionSeen.list().records).toHaveLength(1);
});

test("a previous session's idle row does not let a busy agent be checked", () => {
  const marks = fresh();

  hostRead(
    marks,
    { session: "current", status: "working" },
    { session: "previous", status: "idle" },
  );

  expect(marks.worldCompletionSeen.mark(identity).changed).toBe(false);
});

test("the current session's row is the status World observes", () => {
  const marks = fresh();
  marks.worldCompletionSeen.mark(identity);

  hostRead(
    marks,
    { session: "current", status: "idle" },
    { session: "current", status: "working" },
  );

  expect(marks.worldCompletionSeen.list().records).toEqual([]);
});
