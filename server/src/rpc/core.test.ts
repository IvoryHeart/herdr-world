import { STARTER_PROFILES } from "../../../shared/agentProfile";
import { afterEach, describe, expect, test } from "bun:test";
import { coreWorld } from "../herdr-core/testing/core-world";
import type { CoreHost } from "../herdr-core/host";
import { createCoreRoom, launchCore } from "../herdr-core/operations";
import { tabCardKey } from "../../../shared/terminalColor";
import { BoardStore, emptyBoardDocument } from "../world/board-store";
import { createMoveSettle } from "../world/move-settle";
import { handleCoreRpc } from "./core";
import type { BridgeRpcContext } from "./context";

/**
 * world.core.* as the browser reaches it: every request names the core
 * connection and the generation it saw, and only the core manager answers.
 */

type World = Awaited<ReturnType<typeof coreWorld>>;
const worlds: World[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.dispose();
});

const host = (over: Partial<CoreHost> = {}): CoreHost => ({
  windows: false,
  // `command -v` finds every harness at a synthetic absolute path.
  run: async (script) => {
    const kind =
      /command -v '([^']+)'/.exec(script.replaceAll("'\\''", "'"))?.[1] ?? "x";
    return { code: 0, stdout: `/opt/example/bin/${kind}\n` };
  },
  ...over,
});

async function call(
  w: World,
  method: string,
  params: Record<string, unknown>,
  options: {
    host?: CoreHost;
    profiles?: unknown;
    services?: Record<string, unknown>;
  } = {},
) {
  const replies: Record<string, unknown>[] = [];
  const errors: string[] = [];
  const invalidations: number[] = [];
  await handleCoreRpc({
    id: "1",
    method,
    params,
    sendReply: (message: Record<string, unknown>) => {
      replies.push(message);
      return true;
    },
    sendError: (_context: string, error: unknown) => {
      errors.push(error instanceof Error ? error.message : String(error));
    },
    services: {
      coreControl: {
        manager: w.core.manager,
        topology: w.topology,
        host: () => options.host ?? host(),
      },
      profiles: () => options.profiles ?? { profile: () => null },
      publishWorldInvalidation: (_id: string, generation: number) => {
        invalidations.push(generation);
      },
      ...options.services,
    },
  } as unknown as BridgeRpcContext);
  return { reply: replies[0], error: errors[0], invalidations };
}

async function world(options?: Parameters<typeof coreWorld>[0]) {
  const w = await coreWorld(options);
  worlds.push(w);
  await w.connect();
  return w;
}

describe("world.core.* answers only the core connection it names", () => {
  test("catalog includes the TUI detection and desktop harnesses", async () => {
    const w = await world();
    const result = await call(w, "world.core.catalog", {
      connection_id: "box",
      connection_generation: w.lease().generation,
    });
    expect(result.reply?.result).toMatchObject({
      kinds: expect.arrayContaining([
        "cline",
        "maki",
        "kiro",
        "amp",
        "gemini",
        "pig",
        "dsh-tui",
        "muse",
        "crush",
        "command-code",
        "prime-agent",
        "ollama",
      ]),
    });
  });

  test("a stale generation or a TUI connection is refused, nothing sent", async () => {
    const w = await world();
    const generation = w.lease().generation;
    const stale = await call(w, "world.core.launch", {
      connection_id: "box",
      connection_generation: generation + 1,
      workspace_id: "hc:unplaced",
      shell: true,
    });
    expect(stale.error).toContain("reconnected");
    const tui = await call(w, "world.core.launch", {
      connection_id: "startup-default",
      connection_generation: 0,
      workspace_id: "hc:unplaced",
      shell: true,
    });
    expect(tui.error).toContain("not a herdr-core host");
    expect(w.fake.calls.some((c) => c.method === "terminal.run")).toBe(false);
  });

  test("a shell starts in the main room and the read model is told", async () => {
    const w = await world();
    const generation = w.lease().generation;
    const result = await call(w, "world.core.launch", {
      connection_id: "box",
      connection_generation: generation,
      workspace_id: "hc:unplaced",
      shell: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.reply?.result).toMatchObject({
      status: "started",
      runtime: "herdr-core",
      placed: false,
      terminal_id: "t1",
    });
    expect(result.invalidations).toEqual([generation]);
  });

  test("a saved generic core profile delivers its role and brief through native send", async () => {
    const w = await world({ runStatus: "idle", runForeground: "pi" });
    const result = await call(
      w,
      "world.core.launch",
      {
        connection_id: "box",
        connection_generation: w.lease().generation,
        workspace_id: "hc:unplaced",
        profile_id: "scout",
        label: "Scout",
        text: "Check the tests",
      },
      {
        profiles: {
          profile: () => ({
            ...STARTER_PROFILES[0],
            id: "scout",
            harness: "pi",
            role: "Review carefully",
          }),
        },
      },
    );
    expect(result.reply?.result).toMatchObject({
      status: "sent",
      placed: true,
    });
    expect(w.fake.deliveredInput).toEqual([
      expect.objectContaining({
        input:
          "Review carefully\n\nUse these skills when they apply: code-review.\n\nCheck the tests",
        foreground: "pi",
      }),
    ]);
  });

  test("an agent on a Windows core host starts with its Windows executable", async () => {
    const w = await world();
    const scripts: string[] = [];
    const result = await call(
      w,
      "world.core.launch",
      {
        connection_id: "box",
        connection_generation: w.lease().generation,
        workspace_id: "hc:unplaced",
        kind: "codex",
        label: "Codex",
      },
      {
        host: host({
          windows: true,
          run: async (script) => {
            scripts.push(script);
            return {
              code: 0,
              stdout:
                "banner\r\nherdr-core-executable:C:\\Users\\example\\AppData\\Roaming\\npm\\codex.cmd\r\n",
            };
          },
        }),
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.reply?.result).toMatchObject({ runtime: "herdr-core" });
    // The PowerShell resolver ran, never a POSIX probe.
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain("Get-Command");
    const run = w.fake.calls.find((c) => c.method === "terminal.run");
    expect((run!.params as { argv: string[] }).argv[0]).toBe(
      "C:\\Users\\example\\AppData\\Roaming\\npm\\codex.cmd",
    );
  });

  test("a Windows host without the harness starts nothing", async () => {
    const w = await world();
    const result = await call(
      w,
      "world.core.launch",
      {
        connection_id: "box",
        connection_generation: w.lease().generation,
        workspace_id: "hc:unplaced",
        kind: "claude",
        label: "Claude",
      },
      {
        host: host({
          windows: true,
          run: async () => ({ code: 0, stdout: "\r\n" }),
        }),
      },
    );
    expect(result.reply?.result).toMatchObject({ status: "failed" });
    expect(w.fake.calls.some((c) => c.method === "terminal.run")).toBe(false);
  });

  test("the catalog lists every Herdr harness with this host's readiness", async () => {
    const w = await world();
    const result = await call(w, "world.core.catalog", {
      connection_id: "box",
      connection_generation: w.lease().generation,
    });
    const value = result.reply?.result as {
      kinds: string[];
      readiness: Array<{ kind: string }>;
    };
    expect(value.kinds).toContain("claude");
    expect(value.kinds).toContain("opencode");
    expect(value.readiness.map((r) => r.kind)).toEqual(value.kinds);
  });

  test("the catalog probes the selected core host through its shell", async () => {
    const w = await world();
    const scripts: string[] = [];
    const result = await call(
      w,
      "world.core.catalog",
      {
        connection_id: "box",
        connection_generation: w.lease().generation,
      },
      {
        host: host({
          destination: "host.example",
          run: async (script) => {
            scripts.push(script);
            return {
              code: 0,
              stdout:
                "@@kind codex\n@@found\nLogged in using ChatGPT\n@@exit 0\n@@end\n",
            };
          },
        }),
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.reply?.result).toMatchObject({
      readiness: expect.arrayContaining([
        expect.objectContaining({
          kind: "codex",
          installed: true,
          logged_in: true,
        }),
      ]),
    });
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain("shell=${SHELL:-/bin/sh}");
  });

  test.each([1, 20])(
    "a kill plan names the child that would end with its parent (ordinal %i)",
    async (ordinal) => {
      const w = await world();
      for (let n = 1; n < ordinal; n++) w.fake.create();
      const lead = w.fake.create({ name: "lead" });
      w.fake.create({ parent: lead, die_with_parent: true, name: "helper" });
      await w.settle();
      const result = await call(w, "world.core.kill_plan", {
        connection_id: "box",
        connection_generation: w.lease().generation,
        terminals: [lead],
      });
      expect(result.reply?.result).toMatchObject({
        roots: [{ address: lead, name: "lead" }],
        descendants: [{ name: "helper", parent: lead }],
      });
    },
  );
});

test("world.core.move re-keys the moved desk's Board colour and pin, then lets it settle", async () => {
  const w = await world();
  const a = await createCoreRoom(w.lease(), w.topology, "A");
  const b = await createCoreRoom(w.lease(), w.topology, "B");
  await launchCore(
    w.lease(),
    { workspaceId: a.workspace_id, kind: "claude", label: "Ada", text: "" },
    {
      topology: w.topology,
      resolveExecutable: async (kind) => `/opt/example/bin/${kind}`,
    },
  );
  await w.settle();
  const lease = w.lease();
  const [{ workspaces = [] }, { panes = [] }] = await Promise.all([
    lease.runtime.operations.listWorkspaces(),
    lease.runtime.operations.listTerminals(),
  ]);
  const tab = String(panes.find((row) => row.terminal_id === "t1")!.tab_id);
  const ids = (rows: typeof workspaces) =>
    new Set(rows.map((row) => String(row.workspace_id)));
  const key = tabCardKey("box", tab, ids(workspaces));
  const initial = emptyBoardDocument();
  initial.layout.colors[key] = "teal";
  initial.layout.desk_pins[key] = { cell: null };
  const board = new BoardStore({ read: () => initial, commit: () => {} });
  const services = {
    board: () => board,
    publishBoardChanged: () => {},
    moveSettle: createMoveSettle(),
  };
  const moved = await call(
    w,
    "world.core.move",
    {
      connection_id: "box",
      connection_generation: lease.generation,
      kind: "desk",
      tab_id: tab,
      workspace_id: b.workspace_id,
    },
    { services },
  );
  const result = moved.reply?.result as { status: string; tab_id: string };
  expect(result).toMatchObject({
    status: "moved",
    workspace_id: b.workspace_id,
  });
  const after = await w.lease().runtime.operations.listWorkspaces();
  const next = tabCardKey("box", result.tab_id, ids(after.workspaces ?? []));
  expect(next).not.toBe(key);
  expect(board.get().layout.colors).toEqual({ [next]: "teal" });
  expect(Object.keys(board.get().layout.desk_pins)).toEqual([next]);
  const again = await call(
    w,
    "world.core.move",
    {
      connection_id: "box",
      connection_generation: lease.generation,
      kind: "desk",
      tab_id: result.tab_id,
      workspace_id: a.workspace_id,
    },
    { services },
  );
  expect(again.reply?.result).toMatchObject({
    status: "refused",
    message: expect.stringContaining("just moved"),
  });
});
