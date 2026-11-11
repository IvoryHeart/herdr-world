import { afterEach, describe, expect, test } from "bun:test";
import { coreWorld } from "../herdr-core/testing/core-world";
import type { CoreHost } from "../herdr-core/host";
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
    const kind = /command -v '([^']+)'/.exec(script)?.[1] ?? "x";
    return { code: 0, stdout: `/opt/example/bin/${kind}\n` };
  },
  ...over,
});

async function call(
  w: World,
  method: string,
  params: Record<string, unknown>,
  options: { host?: CoreHost; profiles?: unknown } = {},
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
        run: async () => ({
          code: 0,
          stdout: "",
          stderr: "",
          timedOut: false,
        }),
      },
      profiles: () => options.profiles ?? { profile: () => null },
      publishWorldInvalidation: (_id: string, generation: number) => {
        invalidations.push(generation);
      },
    },
  } as unknown as BridgeRpcContext);
  return { reply: replies[0], error: errors[0], invalidations };
}

async function world() {
  const w = await coreWorld();
  worlds.push(w);
  await w.connect();
  return w;
}

describe("world.core.* answers only the core connection it names", () => {
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
