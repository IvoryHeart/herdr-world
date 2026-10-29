import { describe, expect, test } from "bun:test";
import type { ConnectionClient } from "../api";
import { focusWorldNode } from "./worldInspectorSelection";
import { deskRevealUnavailable, revealDeskAgent } from "./deskReveal";
import {
  taskSummarySessionFingerprint,
  type WorldLeafObject,
  type WorldObject,
} from "./worldObject";

const session = {
  source: "herdr:codex",
  agent: "codex",
  kind: "id",
  value: "synthetic-session",
};
const target = {
  id: "remote-agent",
  nativeId: "shared-pane",
  kind: "agent",
  connectionId: "beta",
  generation: 7,
  hostLabel: "Synthetic beta",
  actionable: true,
  stale: false,
  terminalId: "shared-terminal",
  workspaceId: "shared-workspace",
  tabId: "shared-tab",
  agentSessionFingerprint: taskSummarySessionFingerprint(session),
  pane: {
    pane_id: "shared-pane",
    terminal_id: "shared-terminal",
    workspace_id: "shared-workspace",
    tab_id: "shared-tab",
    agent: "codex",
    agent_session: session,
  },
} as unknown as WorldLeafObject;

function setup() {
  let current = target;
  let ids: readonly string[] | null = ["alpha"];
  let reply: unknown = { pane: target.pane };
  let currentClient = true;
  let read = async () => reply;
  const events: string[] = [];
  const client = {
    connectionId: "beta",
    generation: 2,
    serverRuntimeGeneration: 7,
    isCurrent: () => currentClient,
    call: async (method: string, params: Record<string, unknown>) => {
      events.push(method);
      expect(params).toEqual({ pane_id: "shared-pane" });
      return read();
    },
  } as unknown as ConnectionClient;
  const context = {
    world: () =>
      ({
        nodeById: new Map([[current.id, current]]),
      }) as unknown as WorldObject,
    filter: () => ids,
    client: () => client,
    reveal: (next: readonly string[] | null) => {
      events.push("reveal");
      ids = next;
    },
    open: async (
      leaf: WorldLeafObject,
      world: WorldObject,
      sessionId: string,
    ) => {
      events.push("open");
      expect(leaf).toBe(current);
      expect(world.nodeById.get(leaf.id)).toBe(current);
      expect(sessionId).toBe(session.value);
      if (ids !== null) expect(ids).toContain("beta");
      return true;
    },
  };
  return {
    context,
    events,
    ids: () => ids,
    replace: (value: WorldLeafObject) => {
      current = value;
    },
    reply: (value: unknown) => {
      reply = value;
    },
    retire: () => {
      currentClient = false;
    },
    filter: (value: readonly string[] | null) => {
      ids = value;
    },
    defer: (value: Promise<unknown>) => {
      read = () => value;
    },
  };
}

describe("outside-filter Desk reveal", () => {
  test("Inspector focus retains the admitted terminal and session through its queue", async () => {
    const targets: unknown[] = [];
    await focusWorldNode(
      target,
      {
        get: () => ({
          connections: [{ id: "beta", state: "ready", generation: 7 }],
        }),
        focusQualifiedTarget: async (value: unknown) => {
          targets.push(value);
          return true;
        },
      } as unknown as Parameters<typeof focusWorldNode>[1],
      session.value,
    );
    expect(targets).toEqual([
      {
        connectionId: "beta",
        runtimeGeneration: 7,
        workspaceId: "shared-workspace",
        paneId: "shared-pane",
        terminalId: "shared-terminal",
        agentSessionId: session.value,
      },
    ]);
  });

  test("admits the exact pane and session, widens the filter, then opens", async () => {
    const state = setup();
    await revealDeskAgent(target, state.context);
    expect(state.events).toEqual(["pane.get", "reveal", "open"]);
    expect(state.ids()).toEqual(["alpha", "beta"]);
  });

  test("explains a failed qualified live read without changing the filter", async () => {
    const state = setup();
    state.defer(Promise.reject(new Error("synthetic transport failure")));
    await expect(revealDeskAgent(target, state.context)).rejects.toThrow(
      "Synthetic beta",
    );
    expect(state.ids()).toEqual(["alpha"]);
    expect(state.events).toEqual(["pane.get"]);
  });

  test("keeps All hosts and does not duplicate an already revealed host", async () => {
    for (const ids of [null, ["alpha", "beta"]]) {
      const state = setup();
      state.filter(ids);
      await revealDeskAgent(target, state.context);
      expect(state.ids()).toEqual(ids);
    }
  });

  test.each([
    { stale: true },
    { actionable: false },
    { generation: 8 },
    { connectionId: "alpha" },
    { terminalId: "replacement" },
    { workspaceId: "replacement" },
    { tabId: "replacement" },
    { agentSessionFingerprint: "b".repeat(64) },
    { agentSessionFingerprint: undefined },
  ])(
    "rejects obsolete aggregate identity before reading: %j",
    async (change) => {
      const state = setup();
      state.replace({ ...target, ...change });
      await expect(revealDeskAgent(target, state.context)).rejects.toThrow(
        "Synthetic beta",
      );
      expect(state.events).toEqual([]);
      expect(state.ids()).toEqual(["alpha"]);
    },
  );

  test.each([
    null,
    { pane: null },
    { pane: { ...target.pane, terminal_id: "replacement" } },
    { pane: { ...target.pane, workspace_id: "replacement" } },
    { pane: { ...target.pane, tab_id: "replacement" } },
    { pane: { ...target.pane, pane_id: "replacement" } },
    { pane: { ...target.pane, agent_session: null } },
    {
      pane: {
        ...target.pane,
        agent_session: { ...session, source: "replacement" },
      },
    },
    {
      pane: {
        ...target.pane,
        agent_session: { ...session, value: "replacement" },
      },
    },
  ])("rejects a missing or replaced live occupant: %j", async (reply) => {
    const state = setup();
    state.reply(reply);
    await expect(revealDeskAgent(target, state.context)).rejects.toThrow(
      "Synthetic beta",
    );
    expect(state.events).toEqual(["pane.get"]);
    expect(state.ids()).toEqual(["alpha"]);
  });

  test.each(["runtime", "session", "client"])(
    "rejects %s retirement during admission",
    async (kind) => {
      const state = setup();
      const pending = Promise.withResolvers<unknown>();
      state.defer(pending.promise);
      const opening = revealDeskAgent(target, state.context);
      if (kind === "client") state.retire();
      else
        state.replace({
          ...target,
          ...(kind === "runtime"
            ? { generation: 8 }
            : { agentSessionFingerprint: "b".repeat(64) }),
        });
      pending.resolve({ pane: target.pane });
      await expect(opening).rejects.toThrow("Synthetic beta");
      expect(state.events).toEqual(["pane.get"]);
    },
  );

  test("a later selection cancels delayed reveal before filter or Inspector publication", async () => {
    const state = setup();
    const pending = Promise.withResolvers<unknown>();
    state.defer(pending.promise);
    let current = true;
    const opening = revealDeskAgent(target, {
      ...state.context,
      isCurrent: () => current,
    });
    current = false;
    pending.resolve({ pane: target.pane });
    await expect(opening).rejects.toThrow("superseded");
    expect(state.events).toEqual(["pane.get"]);
    expect(state.ids()).toEqual(["alpha"]);
  });

  test("preserves filter edits made while live admission is pending", async () => {
    const state = setup();
    const pending = Promise.withResolvers<unknown>();
    state.defer(pending.promise);
    const opening = revealDeskAgent(target, state.context);
    state.filter(["gamma"]);
    pending.resolve({ pane: target.pane });
    await opening;
    expect(state.ids()).toEqual(["gamma", "beta"]);
  });

  test("reports a failed Inspector admission without opening another agent", async () => {
    const state = setup();
    state.context.open = async () => false;
    await expect(revealDeskAgent(target, state.context)).rejects.toThrow(
      "Synthetic beta",
    );
    expect(state.events).toEqual(["pane.get", "reveal"]);
  });

  test("explains cached, unavailable and unidentified sessions", () => {
    expect(deskRevealUnavailable({ ...target, stale: true }, target)).toContain(
      "Cached",
    );
    expect(deskRevealUnavailable(target, undefined)).toContain("unavailable");
    expect(
      deskRevealUnavailable(
        { ...target, agentSessionFingerprint: undefined },
        target,
      ),
    ).toContain("session");
  });
});
