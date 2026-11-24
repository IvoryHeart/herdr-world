import { expect, test } from "bun:test";
import { createAgentCommands, type AgentCommandLease } from "./agent-commands";
import type { WorldSnapshotResult } from "./snapshot";
import type { RuntimeAgentCapabilities } from "../adapters/runtime-ports";
import { createWorldCli, type WorldCliDeps } from "./world-cli";
import { handleWorldCliEndpoint } from "../http/world-cli-endpoint";
import { registeredVerb } from "../verbs/registry";
import { ACTORS } from "../verbs/types";

type Boundary =
  | "snapshot"
  | "capture"
  | "list-send"
  | "list-reply"
  | "read-send"
  | "read-reply";
function fixture(retireAt?: Boundary) {
  let retired = false;
  let reads = 0;
  let lists = 0;
  const requested: string[] = [];
  const rows = new Map([
    ["tui-a", [{ pane_id: "w1:p2", agent: "codex", agent_status: "working" }]],
    ["core-a", [{ pane_id: "t2", agent: "claude", agent_status: "idle" }]],
    ["core-b", [{ pane_id: "t2", agent: "codex" }]],
  ]);
  const snapshot = {
    revision: 1,
    observed_at: 1,
    connections: [...rows.keys()].map((connection_id) => ({
      connection_id,
      label: connection_id,
      source: "test",
      is_default: false,
      state: "ready",
      generation: 3,
      snapshot_generation: 3,
      stale: false,
      actionable: true,
      snapshot: { agents: [] },
      ...(connection_id.startsWith("core") ? { runtime: "herdr-core" } : {}),
    })),
    hosts: [
      {
        host_id: "host-a",
        label: "Host A",
        connection_ids: ["tui-a", "core-a", "core-b"],
        runtimes: [...rows.keys()].map((connection_id) => ({
          connection_id,
          kind: connection_id === "tui-a" ? "herdr" : "herdr-core",
          version: connection_id === "tui-a" ? "0.9.5" : "0.1.21",
        })),
      },
    ],
  } as unknown as WorldSnapshotResult;
  const capabilities = new Map<string, RuntimeAgentCapabilities>([
    ["herdr", { verbs: ["ls", "read"], manual: "herdr --skill" }],
    ["herdr-core", { verbs: ["ls", "read"], manual: "hc --skill" }],
  ]);
  const at = (boundary: Boundary) => {
    if (retireAt === boundary) retired = true;
  };
  const service = createAgentCommands({
    snapshot: async () => {
      at("snapshot");
      return snapshot;
    },
    capabilities: (kind) => capabilities.get(kind),
    lease: (id): AgentCommandLease => {
      requested.push(id);
      at("capture");
      return {
        connectionId: id,
        generation: 3,
        isCurrent: () => !retired,
        operations: {
          listAgents: async (_query, options) => {
            at("list-send");
            options?.beforeSend?.();
            lists++;
            at("list-reply");
            return { agents: rows.get(id) ?? [] };
          },
          readTerminal: async (target, options) => {
            at("read-send");
            options?.beforeSend?.();
            reads++;
            expect(target).toEqual({
              pane_id: "t2",
              source: "visible",
              strip_ansi: true,
            });
            at("read-reply");
            return { read: { text: `${id}\nsecond\nlast\n` } };
          },
        },
      };
    },
  });
  return {
    service,
    snapshot,
    rows,
    capabilities,
    requested,
    reads: () => reads,
    lists: () => lists,
    retire: () => {
      retired = true;
    },
  };
}
const call = (f: ReturnType<typeof fixture>, command: string, params = {}) =>
  f.service.call(command, params, () => {});

test("runtime inventory groups exact connections with source versions and declared verbs/manuals", async () => {
  const f = fixture();
  expect(await call(f, "runtime ls")).toMatchObject({
    connections: [
      {
        connection_id: "tui-a",
        kind: "herdr",
        version: "0.9.5",
        actionable: true,
        agent_verbs: ["ls", "read"],
        manual: "herdr --skill",
        host_id: "host-a",
      },
      {
        connection_id: "core-a",
        kind: "herdr-core",
        version: "0.1.21",
        manual: "hc --skill",
      },
      { connection_id: "core-b" },
    ],
  });
  expect(f.lists()).toBe(0);
});

test("agent lists merge typed runtime lists and preserve qualified identity/status", async () => {
  const f = fixture();
  expect(await call(f, "agent ls")).toMatchObject({
    agents: [
      { target: "tui-a/w1%3Ap2", generation: 3, status: "working" },
      { target: "core-a/t2", status: "idle" },
      { target: "core-b/t2", status: "unknown" },
    ],
  });
  expect(await call(f, "agent ls", { connection: "core-a" })).toMatchObject({
    agents: [{ target: "core-a/t2" }],
  });
});

test("qualified read uses only the named runtime and trims its screen locally", async () => {
  const f = fixture();
  expect(
    await call(f, "agent read", { target: "core-a/t2", lines: 2 }),
  ).toEqual({
    target: "core-a/t2",
    connection_id: "core-a",
    generation: 3,
    text: "second\nlast",
  });
  expect(f.requested).toEqual(["core-a", "core-a"]);
  expect(f.reads()).toBe(1);
});

test("ambiguous bare addresses name every candidate and never read a screen", async () => {
  const f = fixture();
  await expect(call(f, "agent read", { target: "t2" })).rejects.toThrow(
    "ambiguous target t2: core-a/t2, core-b/t2",
  );
  expect(f.reads()).toBe(0);
  f.snapshot.connections[2]!.actionable = false;
  expect(await call(f, "agent read", { target: "t2" })).toMatchObject({
    target: "core-a/t2",
  });
});

test("unknown, stale, and unsupported targets give specific refusals with no fallback", async () => {
  const f = fixture();
  await expect(call(f, "agent read", { target: "missing/t2" })).rejects.toThrow(
    "unknown target",
  );
  await expect(
    call(f, "agent read", { target: "core-a/missing" }),
  ).rejects.toThrow("unknown target");
  f.snapshot.connections[1]!.stale = true;
  for (const command of ["agent read", "agent ls"])
    await expect(
      call(f, command, { target: "core-a/t2", connection: "core-a" }),
    ).rejects.toThrow("not actionable");
  f.snapshot.connections[1]!.stale = false;
  f.capabilities.set("herdr-core", { verbs: ["ls"] });
  await expect(call(f, "agent read", { target: "core-a/t2" })).rejects.toThrow(
    "not supported by runtime kind herdr-core",
  );
  expect(f.reads()).toBe(0);
});

test.each([
  "snapshot",
  "capture",
  "list-send",
  "list-reply",
  "read-send",
  "read-reply",
] as const)(
  "retirement at %s refuses the original read and never acquires a replacement",
  async (boundary) => {
    const f = fixture(boundary);
    await expect(
      call(f, "agent read", { target: "core-a/t2" }),
    ).rejects.toThrow("not actionable");
    expect(f.requested.every((id) => id === "core-a")).toBe(true);
    expect(f.reads()).toBe(boundary === "read-reply" ? 1 : 0);
  },
);

test("a failed other-runtime listing cannot make a bare address appear unique", async () => {
  const f = fixture();
  f.capabilities.set("herdr", { verbs: [] });
  await expect(call(f, "agent read", { target: "t2" })).rejects.toThrow(
    "not supported by runtime kind herdr",
  );
  expect(f.reads()).toBe(0);
});

test("new actor policies exhaust the matrix: lists match cli:ls, reads require verified agents", () => {
  for (const actor of ACTORS) {
    for (const command of ["runtime ls", "agent ls"])
      expect(registeredVerb("cli", command)!.policy[actor]).toBe(
        registeredVerb("cli", "ls")!.policy[actor],
      );
    expect(registeredVerb("cli", "agent read")!.policy[actor]).toBe(
      actor === "cli_verified" ? "allow" : "deny",
    );
  }
});

test.each([false, true])(
  "local CLI endpoint read authority for verified=%s",
  async (verified) => {
    const f = fixture();
    const cli = createWorldCli({
      agents: f.service,
      hosts: () => [],
      identifyCore: async () =>
        verified
          ? {
              actor: {
                label: "Caller",
                verified: true,
                connection_id: "caller-core",
                pane_id: "t9",
              },
              distance: 0,
            }
          : undefined,
    } as unknown as WorldCliDeps);
    const response = await handleWorldCliEndpoint(
      new Request("http://127.0.0.1:9000/api/world/cli", {
        method: "POST",
        body: JSON.stringify({
          command: "agent read",
          params: { target: "core-a/t2" },
          caller: { core_terminal_id: "t9" },
        }),
      }),
      { address: "127.0.0.1", port: 50000 },
      {
        serverPort: 9000,
        bearerAuth: () => true,
        handle: (body, locate) =>
          cli.handle(body as Parameters<typeof cli.handle>[0], locate),
        platform: "linux",
        callerChain: () => [{ pid: 900, ppid: 800, pgrp: 800 }],
      },
    );
    expect(response.status).toBe(verified ? 200 : 403);
    expect(f.reads()).toBe(verified ? 1 : 0);
    if (verified)
      expect(await response.json()).toMatchObject({
        ok: true,
        result: { target: "core-a/t2", text: "core-a\nsecond\nlast\n" },
      });
  },
);

test("a future runtime uses the same typed ports without a native CLI or kind branch", async () => {
  const f = fixture();
  f.snapshot.hosts![0]!.runtimes[1]!.kind = "synthetic-future";
  f.capabilities.set("synthetic-future", { verbs: ["ls", "read"] });
  expect(await call(f, "agent read", { target: "core-a/t2" })).toMatchObject({
    text: "core-a\nsecond\nlast\n",
  });
});

test("mismatched generations are refused even when the replacement has the same address", async () => {
  const f = fixture();
  f.snapshot.connections[1]!.generation = 4;
  f.snapshot.connections[1]!.snapshot_generation = 4;
  await expect(call(f, "agent read", { target: "core-a/t2" })).rejects.toThrow(
    "not actionable",
  );
  expect(f.reads()).toBe(0);
});

test("qualified components round trip opaque case-sensitive addresses and separators", async () => {
  const f = fixture();
  f.rows.set("core-a", [{ pane_id: "Case/part%2", agent: "codex" }]);
  const list = (await call(f, "agent ls", { connection: "core-a" })) as {
    agents: { target: string }[];
  };
  expect(list.agents[0]!.target).toBe("core-a/Case%2Fpart%252");
  await expect(
    call(f, "agent read", { target: "core-a/case%2Fpart%252" }),
  ).rejects.toThrow("unknown target");
});
