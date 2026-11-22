import { expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import type { ConnectionManager } from "../connections/manager";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import { createLegacyRoutingLogger } from "../connections/protocol";
import type { CoreRpcServices } from "../rpc/core";
import type { RpcServices } from "../rpc/context";
import { createRpcDispatcher } from "../service/rpc-dispatch";
import { createRuntimeMemoryService } from "../features/memory/runtime-service";
import type { MemoryLease } from "./service";
import { withFeatures } from "../testing/features";
import { createMemoryHost } from "./host";
import { MEMORY_LIMITS, type MemoryCatalog } from "../../../shared/memory";
import { admitVerb } from "../verbs/admission";
import { registeredVerb } from "../verbs/registry";

function host(id: string): MemoryLease {
  return {
    generation: 7,
    isCurrent: () => true,
    runtime: {
      operations: {
        listWorkspaces: async () => ({
          workspaces: [{ workspace_id: "w1", cwd: `/workspace/${id}` }],
        }),
        listTerminals: async () => ({
          panes: [
            {
              pane_id: "p1",
              workspace_id: "w1",
              cwd: `/workspace/${id}`,
              agent: "opencode",
            },
          ],
        }),
      },
      memoryHost: {
        execute: async <T>(request: Record<string, unknown>) => {
          if (request.action === "environment")
            return {
              home: `/users/${id}`,
              codex: `/users/${id}/.codex`,
              claude: `/users/${id}/.claude`,
              pi: `/users/${id}/.pi/agent`,
              claude_memory: null,
              claude_project_name: null,
              contexts: {
                [`/workspace/${id}`]: {
                  path: `/workspace/${id}`,
                  root: `/workspace/${id}`,
                  memory_root: `/workspace/${id}`,
                },
              },
            } as T;
          return { states: [], entries: [], truncated: false } as T;
        },
      },
    },
  };
}

test("TUI and core owners with the same generation are isolated, and unknown IDs never fall back", async () => {
  const tui = host("tui"),
    core = host("core");
  const leases: string[] = [];
  const manager = (id: string, lease: MemoryLease) => ({
    has: (value: string) => value === id,
    readyRuntimeLease: (value: string) => {
      leases.push(value);
      return value === id ? lease : null;
    },
  });
  const service = createRuntimeMemoryService({
    connections: () =>
      manager(
        "tui",
        tui,
      ) as unknown as ConnectionManager<LegacyConnectionRuntime>,
    core: () => manager("core", core) as unknown as CoreRpcServices["manager"],
    coreHostRuntime: (lease: unknown) => {
      expect(lease).toBe(core);
      return core.runtime;
    },
    clock: { now: () => 1000, monotonic: () => 1000 },
  });
  const a = (await service.call("list", {
    connection_id: "tui",
    connection_generation: 7,
  })) as MemoryCatalog;
  const b = (await service.call("list", {
    connection_id: "core",
    connection_generation: 7,
  })) as MemoryCatalog;
  expect(a.sources.some((s) => s.path.startsWith("/users/tui/"))).toBe(true);
  expect(b.sources.some((s) => s.path.startsWith("/users/core/"))).toBe(true);
  expect(b.sources.some((s) => s.path.includes("tui"))).toBe(false);
  await expect(
    service.call("list", {
      connection_id: "missing",
      connection_generation: 7,
    }),
  ).rejects.toMatchObject({ code: "unavailable" });
  expect(leases).toEqual(["tui", "core"]);
});

test("browser dispatcher requires explicit write and delete acknowledgements before service access", async () => {
  const lease = host("tui");
  let calls = 0;
  const original = lease.runtime.memoryHost.execute;
  lease.runtime.memoryHost.execute = async <T>(
    request: Record<string, unknown>,
  ) => {
    calls++;
    return original<T>(request);
  };
  const replies: Record<string, unknown>[] = [];
  const ws = {} as ServerWebSocket<unknown>;
  const services = withFeatures({
    clients: new Set([ws]),
    clock: { now: () => 1000 },
    connectionManager: { has: () => true, readyRuntimeLease: () => lease },
    snapshotAdmission: { acknowledge: () => false },
    safeSend: (_ws: unknown, payload: string) => {
      replies.push(JSON.parse(payload));
      return true;
    },
    markRpcError: () => {},
  } as unknown as RpcServices);
  const dispatch = createRpcDispatcher(
    services,
    createLegacyRoutingLogger({ log: () => {} }),
  );
  const target = { connection_id: "tui", connection_generation: 7 };
  await dispatch(
    ws,
    JSON.stringify({ id: "list", method: "world.memory.list", params: target }),
  );
  expect(replies.at(-1)).toMatchObject({
    id: "list",
    result: { connection_id: "tui", connection_generation: 7 },
  });
  calls = 0;
  await dispatch(
    ws,
    JSON.stringify({
      id: "delete",
      method: "world.memory.delete",
      params: {
        ...target,
        source_id: "source",
        path: "AGENTS.md",
        revision: "a".repeat(64),
        user_action: true,
      },
    }),
  );
  expect(replies.at(-1)).toMatchObject({
    error: { message: "add --yes to acknowledge this effect" },
  });
  expect(calls).toBe(0);
  await dispatch(
    ws,
    JSON.stringify({
      id: "create",
      method: "world.memory.create",
      params: {
        ...target,
        source_id: "source",
        path: "AGENTS.md",
        content: "x",
      },
    }),
  );
  expect(replies.at(-1)).toMatchObject({
    error: { message: "add --user-action to acknowledge this effect" },
  });
  expect(calls).toBe(0);
  await dispatch(
    ws,
    JSON.stringify({
      id: "old",
      method: "world.memory.list",
      params: { ...target, connection_generation: 6 },
    }),
  );
  expect(replies.at(-1)).toMatchObject({ error: { code: "unavailable" } });
  services.clients.delete(ws);
  await dispatch(
    ws,
    JSON.stringify({ id: "gone", method: "world.memory.list", params: target }),
  );
  expect(replies.at(-1)).toMatchObject({
    error: { message: "verb authorization was revoked" },
  });
});

test("SSH memory uses the selected bound runner, sends content only on stdin and never retries writes", async () => {
  const calls: { argv: string[]; input: string }[] = [];
  const remote = createMemoryHost({
    sshHost: () => "memory.example",
    run: async (argv, input) => {
      calls.push({ argv, input: String(input) });
      return {
        code: 0,
        stdout: JSON.stringify({
          ok: true,
          result: { status: "created", revision: "a".repeat(64) },
        }),
        stderr: "",
      };
    },
  });
  const result = await remote.execute({
    action: "create",
    content: "private synthetic note",
    user_action: true,
  });
  expect(result).toMatchObject({ status: "created" });
  expect(calls[0]!.argv).toContain("memory.example");
  expect(calls[0]!.argv.join(" ")).not.toContain("private synthetic note");
  expect(JSON.parse(calls[0]!.input)).toMatchObject({
    content: "private synthetic note",
    limits: MEMORY_LIMITS,
  });
  let attempts = 0;
  const broken = createMemoryHost({
    sshHost: () => "memory.example",
    run: async () => {
      attempts++;
      throw new Error("lost connection");
    },
  });
  await expect(broken.execute({ action: "delete" })).rejects.toMatchObject({
    code: "uncertain",
  });
  expect(attempts).toBe(1);
  const windows = createMemoryHost({
    sshHost: () => "memory.example",
    remotePlatform: "windows",
    run: async () => {
      throw new Error("must not run");
    },
  });
  await expect(windows.execute({ action: "list" })).rejects.toMatchObject({
    code: "refused",
  });
});

test("automation and assistant actors cannot turn memory edits into background work", () => {
  for (const actor of ["assistant", "automation", "reconciler"] as const) {
    expect(() =>
      admitVerb(
        registeredVerb("rpc", "world.memory.create"),
        {},
        {
          actor,
          authorized: () => true,
          capabilities: () => new Set(["world"]),
          preconditions: () => true,
        },
      ),
    ).toThrow("denied");
  }
});
