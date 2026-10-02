import { expect, test } from "bun:test";
import { createTaskEventTracker, type TaskEvent } from "./task-events";

const pane = {
  pane_id: "p1",
  workspace_id: "w1",
  tab_id: "t1",
  agent: "Example agent",
  agent_status: "working",
};
const event = (status: string) => ({
  event: "pane.agent_status_changed",
  data: { ...pane, agent_status: status },
});

test("semantic notification capture retains the observed owning session and never follows a moved pane", () => {
  const tracker = createTaskEventTracker(() => {});
  tracker.reconcilePaneList(
    { panes: [{ ...pane, agent_session: { value: "synthetic-original" } }] },
    0,
  );
  const capture = Reflect.get(tracker, "captureAgentSession") as
    | ((workspaceId: string, paneId: string) => string | undefined)
    | undefined;
  const original = capture?.("w1", "p1");
  expect(original).toBe("synthetic-original");
  tracker.reconcilePaneList(
    {
      panes: [
        {
          ...pane,
          workspace_id: "w2",
          agent_session: { value: "synthetic-replacement" },
        },
      ],
    },
    tracker.beginPaneList(),
  );
  expect(capture?.("w1", "p1")).toBeUndefined();
  expect(capture?.("w2", "p1")).toBe("synthetic-replacement");
  expect(original).toBe("synthetic-original");
});

test("initial snapshots seed, transitions notify once, and stale snapshots cannot replay events", () => {
  const events: TaskEvent[] = [];
  const tracker = createTaskEventTracker((task) => events.push(task));
  tracker.reconcilePaneList({ panes: [pane] }, tracker.beginPaneList());
  expect(events).toEqual([]);
  const revision = tracker.beginPaneList();
  tracker.handleHerdrEvent(event("blocked"));
  tracker.handleHerdrEvent(event("blocked"));
  tracker.reconcilePaneList({ panes: [pane] }, revision);
  tracker.handleHerdrEvent(event("idle"));
  expect(events.map((task) => task.kind)).toEqual(["blocked"]);
  tracker.handleHerdrEvent(event("working"));
  tracker.reconcilePaneList(
    { panes: [{ ...pane, agent_status: "done" }] },
    tracker.beginPaneList(),
  );
  tracker.handleHerdrEvent(event("idle"));
  expect(events.map((task) => task.kind)).toEqual(["blocked", "completed"]);
  expect(events[0]).toMatchObject({
    paneId: "p1",
    workspaceId: "w1",
    tabId: "t1",
    agent: "Example agent",
  });
});

test("partial status events retain the tab from the pane snapshot", () => {
  const events: TaskEvent[] = [];
  const tracker = createTaskEventTracker((task) => events.push(task));
  tracker.reconcilePaneList({ panes: [pane] }, 0);
  tracker.handleHerdrEvent({
    event: "pane.agent_status_changed",
    data: { pane_id: "p1", workspace_id: "w1", agent_status: "done" },
  });
  expect(events[0]).toMatchObject({ tabId: "t1", agent: "Example agent" });
});

test("status metadata from an old workspace or session is never assigned to a reused pane", () => {
  const events: TaskEvent[] = [];
  const tracker = createTaskEventTracker((task) => events.push(task));
  tracker.reconcilePaneList(
    { panes: [{ ...pane, agent_session: { value: "synthetic-original" } }] },
    0,
  );
  tracker.handleHerdrEvent({
    event: "pane.agent_status_changed",
    data: {
      pane_id: "p1",
      workspace_id: "replacement-workspace",
      agent_status: "done",
    },
  });
  expect(events).toEqual([]);
  expect(
    tracker.captureAgentSession("replacement-workspace", "p1"),
  ).toBeUndefined();
  tracker.reconcilePaneList(
    { panes: [{ ...pane, agent_session: { value: "synthetic-original" } }] },
    tracker.beginPaneList(),
  );
  tracker.handleHerdrEvent({
    event: "pane.agent_status_changed",
    data: {
      ...pane,
      agent_status: "done",
      agent_session: { value: "synthetic-replacement" },
    },
  });
  expect(events).toEqual([]);
});

test("moving a pane across workspaces cannot carry unconfirmed cached agent-session metadata", () => {
  const tracker = createTaskEventTracker(() => {});
  tracker.reconcilePaneList(
    { panes: [{ ...pane, agent_session: { value: "synthetic-original" } }] },
    0,
  );
  tracker.handleHerdrEvent({
    event: "pane.moved",
    data: {
      previous_pane_id: "p1",
      pane: { ...pane, workspace_id: "replacement-workspace" },
    },
  });
  expect(
    tracker.captureAgentSession("replacement-workspace", "p1"),
  ).toBeUndefined();
  tracker.reconcilePaneList(
    { panes: [{ ...pane, agent_session: { value: "synthetic-original" } }] },
    tracker.beginPaneList(),
  );
  tracker.handleHerdrEvent({
    event: "pane.moved",
    data: {
      previous_pane_id: "p1",
      pane: { ...pane, pane_id: "replacement-pane" },
    },
  });
  expect(tracker.captureAgentSession("w1", "replacement-pane")).toBeUndefined();
});

test("a partial status event without session identity cannot claim a cached session still owns the task", () => {
  const events: TaskEvent[] = [];
  const tracker = createTaskEventTracker((task) => events.push(task));
  tracker.reconcilePaneList(
    { panes: [{ ...pane, agent_session: { value: "synthetic-original" } }] },
    0,
  );
  tracker.handleHerdrEvent({
    event: "pane.agent_status_changed",
    data: { ...pane, agent_status: "done" },
  });
  expect(events).toHaveLength(1);
  expect(events[0]?.agentSessionId).toBeUndefined();
  expect(tracker.captureAgentSession("w1", "p1")).toBeUndefined();
});

test("malformed runtime session metadata never becomes a qualified notification identity", () => {
  const events: TaskEvent[] = [];
  const tracker = createTaskEventTracker((task) => events.push(task));
  tracker.reconcilePaneList(
    { panes: [{ ...pane, agent_session: { value: 123 } }] },
    0,
  );
  tracker.handleHerdrEvent({
    event: "pane.agent_status_changed",
    data: { ...pane, agent_status: "done", agent_session: { value: 123 } },
  });
  expect(events[0]?.agentSessionId).toBeUndefined();
  expect(tracker.captureAgentSession("w1", "p1")).toBeUndefined();
});

test("moves, closures, malformed lists and stopped runtimes do not fabricate tasks", () => {
  const events: TaskEvent[] = [];
  const tracker = createTaskEventTracker((task) => events.push(task));
  tracker.reconcilePaneList({ panes: [pane] }, 0);
  tracker.reconcilePaneList({}, 0);
  tracker.handleHerdrEvent({
    event: "pane_moved",
    data: {
      previous_pane_id: "p1",
      pane: { ...pane, pane_id: "p2", workspace_id: "w2" },
    },
  });
  tracker.handleHerdrEvent({
    event: "pane_agent_status_changed",
    data: {
      ...pane,
      pane_id: "p2",
      workspace_id: "w2",
      agent_status: "blocked",
    },
  });
  expect(events[0]).toMatchObject({ paneId: "p2", workspaceId: "w2" });
  tracker.handleHerdrEvent(event("idle"));
  expect(events).toHaveLength(1);
  tracker.handleHerdrEvent(event("working"));
  tracker.handleHerdrEvent({
    event: "workspace.closed",
    data: { workspace_id: "w1" },
  });
  tracker.handleHerdrEvent(event("done"));
  expect(events).toHaveLength(1);
  tracker.stop();
  tracker.handleHerdrEvent(event("working"));
  tracker.handleHerdrEvent(event("blocked"));
  tracker.reconcilePaneList({ panes: [pane] }, tracker.beginPaneList());
  expect(events).toHaveLength(1);
});
