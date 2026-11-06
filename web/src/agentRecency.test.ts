import { expect, test } from "bun:test";
import { withAgentActivity } from "./agentOrder";
import { activityEntries, rememberActivity } from "../../shared/agentActivity";
import { observedRecency, withCachedRecency } from "./agentRecency";
import { emptyServerSessionState } from "./store/sessions";

const pane = {
  pane_id: "pane",
  terminal_id: "terminal",
  workspace_id: "workspace",
  tab_id: "tab",
  focused: false,
  agent: "codex",
  agent_status: "idle",
  revision: 1,
  agent_session: { value: "session-one" },
};

test("a status transition preserves session recency but does not lend a sequence", () => {
  const merged = withAgentActivity([pane], {
    agents: [
      {
        ...pane,
        agent_status: "working",
        state_change_seq: 42,
        last_activity_at: 100,
      },
    ],
  })[0]!;
  expect(merged.last_activity_at).toBe(100);
  expect(merged.state_change_seq).toBeUndefined();
});

test("an agent.list reply for another session never lends its timestamp", () => {
  const merged = withAgentActivity([pane], {
    agents: [
      {
        ...pane,
        agent_session: { value: "replacement-session" },
        last_activity_at: 200,
      },
    ],
  })[0]!;
  expect(merged.last_activity_at).toBeUndefined();
});

test("a late list cannot roll back a push, and an older push cannot roll back a list", () => {
  const entry = { ...pane, session: "session-one", last_activity_at: 300 };
  const pushed = rememberActivity({}, activityEntries([entry], true));
  const late = observedRecency(pushed, [pane], {
    agents: [{ ...pane, last_activity_at: 100 }],
  });
  expect(late.panes[0]!.last_activity_at).toBe(300);
  const newer = observedRecency(late.agentActivity, [pane], {
    agents: [{ ...pane, last_activity_at: 500 }],
  });
  const oldPush = rememberActivity(
    newer.agentActivity,
    activityEntries([entry], true),
  );
  expect(withCachedRecency([pane], oldPush)[0]!.last_activity_at).toBe(500);
});

test("an unsupported reading preserves the current identity's recency; replacements do not inherit it", () => {
  const first = observedRecency({}, [pane], {
    agents: [{ ...pane, last_activity_at: 500 }],
  });
  expect(
    observedRecency(first.agentActivity, [pane], null).panes[0]!
      .last_activity_at,
  ).toBe(500);
  for (const replacement of [
    { agent_session: { value: "other-session" } },
    { terminal_id: "other-terminal" },
    { agent: "claude" },
  ]) {
    const next = observedRecency(
      first.agentActivity,
      [{ ...pane, ...replacement }],
      null,
    );
    expect(next.panes[0]!.last_activity_at).toBeUndefined();
    expect(next.agentActivity).toEqual({});
  }
  expect(emptyServerSessionState(2).agentActivity).toEqual({});
});

test("a push before the first pane list is retained only for its matching identity", () => {
  const entry = { ...pane, session: "session-one", last_activity_at: 300 };
  const early = rememberActivity({}, activityEntries([entry], true));
  expect(observedRecency(early, [pane], null).panes[0]!.last_activity_at).toBe(
    300,
  );
  expect(
    observedRecency(
      early,
      [{ ...pane, agent_session: { value: "other-session" } }],
      null,
    ).panes[0]!.last_activity_at,
  ).toBeUndefined();
});

test("malformed and other-session pushes cannot replace a current session's maximum", () => {
  const entry = { ...pane, session: "session-one", last_activity_at: 300 };
  const current = rememberActivity({}, activityEntries([entry], true));
  const invalid = [
    null,
    {},
    { ...entry, last_activity_at: -1 },
    { ...entry, last_activity_at: Infinity },
    { ...entry, session: 42 },
    { ...entry, session: "other-session", last_activity_at: 900 },
  ];
  const merged = rememberActivity(current, activityEntries(invalid, true));
  expect(withCachedRecency([pane], merged)[0]!.last_activity_at).toBe(300);
});

test("all list/push combinations and arrival orders retain the session maximum", () => {
  const orders = [
    [100, 300, 500],
    [100, 500, 300],
    [300, 100, 500],
    [300, 500, 100],
    [500, 100, 300],
    [500, 300, 100],
  ];
  for (const order of orders)
    for (let mask = 0; mask < 8; mask++) {
      let cache = {};
      for (const [index, timestamp] of order.entries()) {
        cache =
          mask & (1 << index)
            ? observedRecency(cache, [pane], {
                agents: [{ ...pane, last_activity_at: timestamp }],
              }).agentActivity
            : rememberActivity(
                cache,
                activityEntries(
                  [
                    {
                      ...pane,
                      session: "session-one",
                      last_activity_at: timestamp,
                    },
                  ],
                  true,
                ),
              );
      }
      expect(withCachedRecency([pane], cache)[0]!.last_activity_at).toBe(500);
    }
});
