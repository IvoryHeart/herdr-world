import { expect, test } from "bun:test";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import { deskSessionFingerprint } from "./desk-observation";
import { readDeskWatch } from "./desk-watch-read";

const session = {
  source: "reported",
  agent: "codex",
  kind: "id",
  value: "synthetic-session",
};
const target = {
  connection_id: "alpha",
  connection_generation: 1,
  pane_id: "pane-a",
  session: deskSessionFingerprint(session),
};
function fixture() {
  let current = true,
    observed = { ...session },
    missing = false;
  let pending: Promise<void> | undefined;
  const calls: { method: string; params: any }[] = [];
  const started = Promise.withResolvers<void>();
  const connection = {
    herdr: {
      async call(method: string, params: unknown) {
        calls.push({ method, params });
        const pane = {
          pane_id: "pane-a",
          terminal_id: "terminal-a",
          agent: "codex",
          workspace_id: "space-a",
          tab_id: "tab-a",
          agent_session: missing ? undefined : observed,
        };
        if (method === "pane.get") return { pane };
        if (method === "agent.get")
          return { agent: { ...pane, agent_session: observed } };
        started.resolve();
        await pending;
        return { text: "synthetic screen" };
      },
    },
    agentSessions: {
      async readTurn(params: unknown) {
        calls.push({ method: "agent_turn.get", params });
        started.resolve();
        await pending;
        return {
          turn: { turn_id: "turn-a" },
          agent_session_fingerprint: target.session,
        };
      },
    },
  } as unknown as LegacyConnectionRuntime;
  return {
    calls,
    started: started.promise,
    connection,
    read: (kind: "screen" | "receipt") =>
      readDeskWatch(connection, kind, target, () => current),
    block(p: Promise<void>) {
      pending = p;
    },
    replace() {
      observed = { ...session, value: "replacement" };
    },
    retire() {
      current = false;
    },
    missing() {
      missing = true;
    },
  };
}

test("service reads preserve screen params and existing receipt session qualification", async () => {
  const f = fixture();
  expect(await f.read("screen")).toEqual({
    result: { text: "synthetic screen" },
  });
  expect(f.calls.find((c) => c.method === "pane.read")!.params).toEqual({
    pane_id: "pane-a",
    source: "visible",
    strip_ansi: true,
  });
  await f.read("receipt");
  expect(
    f.calls.find((c) => c.method === "agent_turn.get")!.params,
  ).toMatchObject({
    pane_id: "pane-a",
    workspace_id: "space-a",
    tab_id: "tab-a",
    agent: "codex",
    agent_session_fingerprint: target.session,
  });
});

test("replacement before/during the read and lease retirement never publish text", async () => {
  const before = fixture();
  before.replace();
  expect(await before.read("screen")).toEqual({ retired: true });
  expect(before.calls.some((c) => c.method === "pane.read")).toBeFalse();
  for (const kind of ["screen", "receipt"] as const) {
    for (const retire of [false, true]) {
      const f = fixture(),
        pending = Promise.withResolvers<void>();
      f.block(pending.promise);
      const reading = f.read(kind);
      await f.started;
      if (retire) f.retire();
      else f.replace();
      pending.resolve();
      expect(await reading).toEqual({ retired: true });
    }
  }
});

test("missing pane session fields use the same qualified agent.get source", async () => {
  const f = fixture();
  f.missing();
  expect(await f.read("screen")).toEqual({
    result: { text: "synthetic screen" },
  });
  expect(f.calls.filter((c) => c.method === "agent.get")).toHaveLength(2);
});
