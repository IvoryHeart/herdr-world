import { afterEach, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileHandlers } from "../workspace/files";
import { createRpcDispatcher } from "../service/rpc-dispatch";
import { createLegacyRoutingLogger } from "../connections/protocol";
import { registeredVerb } from "../verbs/registry";
import { ACTORS } from "../verbs/types";
import { shQuote } from "../utils/process-utils";
import type { RpcServices } from "./context";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});
async function harness(core = false) {
  const root = await mkdtemp(join(tmpdir(), "world-ide-"));
  roots.push(root);
  const project = join(root, "project #?%");
  const agent = join(root, "agent");
  await mkdir(project);
  await mkdir(agent);
  await writeFile(join(project, "hello.ts"), "hello");
  await writeFile(join(agent, "hello.ts"), "agent");
  let current = true;
  let authenticated = true;
  let destination: string | undefined;
  let beforeResolve: (() => Promise<void>) | undefined;
  const launches: string[][] = [];
  const applications: (string | undefined)[] = [];
  const reads: unknown[] = [];
  let selected: unknown;
  const resources = {
    getWorkspace: async ({ workspace_id }: { workspace_id: string }) => {
      await beforeResolve?.();
      if (workspace_id !== "room") throw new Error("Unknown workspace");
      return { workspace: { workspace_id: "room", cwd: project } };
    },
    listTerminals: async () => ({ panes: [] }),
  };
  const unexpected = async () => {
    throw new Error("Unexpected process");
  };
  const files = createFileHandlers({
    resources: resources as any,
    sshHost: () => undefined,
    runProcessWithCodeTimeout: unexpected,
    runProcessWithInputTimeout: unexpected,
    runBinaryProcessWithTimeout: unexpected,
    bindProcess: (args) => args,
    shQuote,
    resolveAgentWorktreeTarget: async (target) => {
      if (JSON.stringify(target) !== JSON.stringify(selected) || !selected)
        throw new Error("Worktree selection changed");
      return { root: agent, workspaceId: "room" };
    },
  });
  const lease = {
    generation: 7,
    isCurrent: () => current,
    runtime: { files, sshHost: () => destination },
  };
  const ws = {} as ServerWebSocket<unknown>;
  const replies: any[] = [];
  let saved: unknown = null;
  let installed = true;
  const manager = {
    has: (id: string) => !core && id === "host-a",
    readyRuntimeLease: (id: string) => {
      if (id !== "host-a" || core) throw new Error("Unknown connection");
      return lease;
    },
  };
  const services = {
    clients: new Set([ws]),
    snapshotAdmission: { acknowledge: () => false },
    safeSend: (_: unknown, payload: string) => {
      replies.push(JSON.parse(payload));
      return true;
    },
    markRpcError() {},
    connectionManager: manager,
    ...(core
      ? {
          coreControl: {
            manager: {
              has: (id: string) => id === "host-a",
              readyRuntimeLease: (id: string) =>
                id === "host-a" ? lease : null,
            },
            hostRuntime: () => ({ files }),
            host: () => (destination ? { destination } : null),
          },
        }
      : {}),
    desktopIdeRuntime: {
      detect: () => [
        {
          id: "vscode",
          label: "VS Code",
          ssh: true,
          executable: installed ? "/usr/bin/code" : null,
          reason: "launcher missing",
        },
        {
          id: "idea",
          label: "IntelliJ IDEA",
          ssh: false,
          executable: "/usr/bin/idea",
        },
      ],
      launch: async (
        executable: string,
        args: string[],
        options?: { application?: string },
      ) => {
        applications.push(options?.application);
        launches.push([executable, ...args]);
      },
    },
    uiSettings: async (method: string, params: any) => {
      if (method.endsWith("update")) saved = params.value;
      return { ui: { desktopIde: saved } };
    },
  } as unknown as RpcServices;
  const dispatch = createRpcDispatcher(
    services,
    createLegacyRoutingLogger({ log() {} }),
  );
  let next = 0;
  const call = async (method: string, params?: unknown) => {
    if (!authenticated) services.clients.delete(ws);
    const id = String(++next);
    await dispatch(ws, JSON.stringify({ id, method, params }));
    const reply = replies.find((item) => item.id === id);
    if (!reply) throw new Error("No RPC reply");
    if (reply.error) throw new Error(reply.error.message);
    return reply.result;
  };
  const open = (params = {}) =>
    call("world.ide.open", {
      ide: "vscode",
      connection_id: "host-a",
      connection_generation: 7,
      workspace_id: "room",
      ...params,
    });
  return {
    root,
    project,
    agent,
    launches,
    applications,
    reads,
    call,
    open,
    retire: () => {
      current = false;
    },
    unauthenticate: () => {
      authenticated = false;
    },
    missing: () => {
      installed = false;
    },
    setRemote: () => {
      destination = "test-alias";
    },
    setSelected: (target: unknown) => {
      selected = target;
    },
    resolving: (fn: () => Promise<void>) => {
      beforeResolve = fn;
    },
  };
}

for (const core of [false, true])
  test(`desktop open resolves real project/file/agent paths on exact ${core ? "core" : "TUI"} connection`, async () => {
    const h = await harness(core);
    const list = await h.call("world.ide.list");
    expect(list.ides[0]).toMatchObject({ installed: true, id: "vscode" });
    expect(JSON.stringify(list)).not.toContain("/usr/bin");
    await h.call("world.ide.default", { ide: "vscode" });
    expect((await h.call("world.ide.list")).default_id).toBe("vscode");
    await h.open();
    await h.open({ path: "hello.ts", line: 5 });
    expect(h.launches).toEqual([
      ["/usr/bin/code", h.project],
      ["/usr/bin/code", "--goto", `${h.project}/hello.ts:5`],
    ]);
    expect(h.applications).toEqual([
      "Visual Studio Code",
      "Visual Studio Code",
    ]);
    h.setSelected({ candidateId: "agent" });
    await h.open({
      agent_worktree: { candidateId: "agent" },
      path: "hello.ts",
    });
    expect(h.launches.at(-1)).toEqual([
      "/usr/bin/code",
      "--goto",
      `${h.agent}/hello.ts`,
    ]);
    await expect(
      h.open({ agent_worktree: { candidateId: "retired" } }),
    ).rejects.toThrow("Worktree selection changed");
    await expect(h.open({ connection_generation: 6 })).rejects.toThrow(
      "host changed",
    );
    await expect(h.open({ connection_id: "other" })).rejects.toThrow();
    expect(h.launches).toHaveLength(3);
  });

test("invalid, missing and escaped files never launch; explicit filesystem scope is intentional", async () => {
  const h = await harness();
  await symlink(h.agent, join(h.project, "outside"));
  for (const path of [
    "../agent/hello.ts",
    "outside/hello.ts",
    "missing.ts",
    "hello.ts\u0000",
  ])
    await expect(h.open({ path })).rejects.toThrow();
  await expect(h.open({ path: join(h.agent, "hello.ts") })).rejects.toThrow(
    "filesystem scope",
  );
  expect(h.launches).toHaveLength(0);
  await h.open({ path: join(h.agent, "hello.ts"), scope: "filesystem" });
  expect(h.launches).toEqual([
    ["/usr/bin/code", "--goto", join(h.agent, "hello.ts")],
  ]);
  await expect(h.open({ command: "evil" })).rejects.toThrow(
    "invalid parameters",
  );
  h.missing();
  await expect(h.open()).rejects.toThrow("launcher missing");
});

test("retirement during path admission prevents launch; unauthenticated requests are refused", async () => {
  const h = await harness();
  h.resolving(async () => h.retire());
  await expect(h.open()).rejects.toThrow("host changed");
  expect(h.launches).toHaveLength(0);
  h.unauthenticate();
  await expect(h.call("world.ide.list")).rejects.toThrow();
  for (const name of [
    "world.ide.list",
    "world.ide.default",
    "world.ide.open",
  ]) {
    const verb = registeredVerb("rpc", name)!;
    for (const actor of ACTORS)
      expect(verb.policy[actor]).toBe(actor === "browser" ? "allow" : "deny");
  }
});

test("unsupported SSH form refuses before attempting a local project open", async () => {
  const h = await harness();
  h.setRemote();
  await expect(h.open({ ide: "idea" })).rejects.toThrow("Gateway");
  expect(h.launches).toHaveLength(0);
});
