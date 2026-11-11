import { afterEach, describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultGuiSettings } from "../config/gui-settings";
import { ConnectionManager } from "../connections/manager";
import { createLegacyRoutingLogger } from "../connections/protocol";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import { coreHostRuntimes } from "../herdr-core/host-runtime";
import { coreWorld, until } from "../herdr-core/testing/core-world";
import { FakeCore } from "../herdr-core/testing/fake-core";
import type { RpcServices } from "../rpc/context";
import { createRpcDispatcher } from "./rpc-dispatch";

/**
 * Browser connection methods that name a herdr-core connection (P4):
 * answered by that core's host runtime only, under the generation the
 * browser saw. Two cores with the same terminal addresses and a Herdr
 * (TUI) connection share one dispatcher: each request reaches exactly the
 * connection it names.
 */

type World = Awaited<ReturnType<typeof coreWorld>>;
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A folder with one file, the cwd of the agent at `t1`. */
function folder(root: string, name: string) {
  const path = join(root, name);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, `${name}.txt`), name);
  return path;
}

async function setup() {
  const w: World = await coreWorld();
  cleanups.push(() => w.dispose());
  await w.connect("box");
  // A second core with its own `t1`.
  const other = new FakeCore({ heartbeatMs: 60_000 });
  const otherState = join(w.root, "other", "state");
  const otherSocket = await other.listen(
    otherState,
    join(w.root, "other", "run"),
  );
  cleanups.push(() => other.kill(otherSocket));
  await w.service.create({
    id: "box2",
    label: "box2",
    type: "local",
    runtime: "herdr-core",
    core_session: "default",
    core_state_dir: otherState,
    auto_connect: true,
  });
  await until(() => w.core.manager.status("box2").state === "ready");
  const a = folder(w.root, "alpha-files");
  const b = folder(w.root, "beta-files");
  for (const [fake, cwd] of [
    [w.fake, a],
    [other, b],
  ] as const)
    fake.create({
      name: "agent",
      argv: ["/opt/example/bin/claude"],
      cwd,
      foreground: { pid: 4242, name: "claude", argv: [], cwd },
    });
  await until(
    () =>
      w.core.manager.readyRuntimeLease("box")!.runtime.core.terminal("t1") !==
        undefined &&
      w.core.manager.readyRuntimeLease("box2")!.runtime.core.terminal("t1") !==
        undefined,
  );
  // A Herdr (TUI) connection whose files answer by its own handler.
  const tui = new ConnectionManager<LegacyConnectionRuntime>("alpha");
  const tuiCalls: string[] = [];
  const identity = { id: "alpha", label: "alpha", source: "test" };
  tui.register({
    identity,
    createRuntime: () =>
      ({
        identity,
        async startTransport() {},
        startBackground() {},
        async stop() {},
        herdr: {},
        terminalBridge: {},
        operations: {},
        tui: {},
        sshHost: () => undefined,
        files: {
          listWorkspaceFiles: async () => {
            tuiCalls.push("file.list");
            return { entries: [{ name: "tui-only" }] };
          },
        },
      }) as unknown as LegacyConnectionRuntime,
  });
  await tui.start("alpha");
  cleanups.push(() => tui.stopAll());
  const sent: any[] = [];
  const socket = { remoteAddress: "127.0.0.1" } as ServerWebSocket<unknown>;
  const dispatch = createRpcDispatcher(
    {
      clients: new Set([socket]),
      connectionManager: tui,
      coreControl: {
        manager: w.core.manager,
        hostRuntime: coreHostRuntimes({
          host: () => null,
          readSettings: async () => defaultGuiSettings(),
        }),
      },
      snapshotAdmission: { acknowledge: () => false },
      focusedAcquisition: { recordReply() {} },
      markRpcError() {},
      safeSend(_socket: unknown, payload: string) {
        sent.push(JSON.parse(payload));
        return true;
      },
    } as unknown as RpcServices,
    createLegacyRoutingLogger({ log() {} }),
  );
  const call = async (
    connectionId: string,
    method: string,
    params: Record<string, unknown>,
    generation?: number,
  ) => {
    const before = sent.length;
    await dispatch(
      socket,
      JSON.stringify({
        id: `${connectionId}-${method}`,
        method,
        params,
        connection_id: connectionId,
        connection_generation:
          generation ??
          (w.core.manager.has(connectionId)
            ? w.core.manager.readyRuntimeLease(connectionId)?.generation
            : tui.readyRuntimeLease(connectionId)?.generation),
      }),
    );
    await until(() => sent.length > before);
    return sent.at(-1);
  };
  return { w, other, otherSocket, call, tuiCalls, a, b };
}

const names = (reply: any): string[] =>
  (reply?.result?.entries ?? reply?.result?.files ?? []).map(
    (entry: any) => entry.name,
  );

describe("core connection methods reach only the connection they name", () => {
  test("two cores with the same t1 each list their own agent's folder; the TUI keeps its own", async () => {
    const { call, tuiCalls } = await setup();
    const box = await call("box", "file.list", { workspace_id: "hc:unplaced" });
    const box2 = await call("box2", "file.list", {
      workspace_id: "hc:unplaced",
    });
    expect(box.connection_id).toBe("box");
    expect(names(box)).toContain("alpha-files.txt");
    expect(names(box)).not.toContain("beta-files.txt");
    expect(names(box2)).toContain("beta-files.txt");
    expect(names(box2)).not.toContain("alpha-files.txt");
    // The TUI connection is answered by its own runtime, never by a core.
    const tui = await call("alpha", "file.list", { workspace_id: "w1" });
    expect(tui.error).toBeUndefined();
    expect(names(tui)).toEqual(["tui-only"]);
    expect(tuiCalls).toEqual(["file.list"]);
  });

  test("an agent's worktree subject from another core is refused", async () => {
    const { call, w } = await setup();
    const generation = w.core.manager.readyRuntimeLease("box2")!.generation;
    const subject = {
      connectionId: "box2",
      generation,
      paneId: "t1",
      terminalId: "t1",
      sessionFingerprint: null,
    };
    const own = await call("box2", "agent_worktree.get", { subject });
    expect(own.result?.observation ?? own.result).toBeDefined();
    expect(own.error).toBeUndefined();
    const crossed = await call("box", "agent_worktree.get", { subject });
    expect(crossed.error?.message).toContain(
      "does not belong to this connection",
    );
  });

  test("a stale generation, a retired core and a TUI-only method are refused with nothing sent to core", async () => {
    const { call, w } = await setup();
    const generation = w.core.manager.readyRuntimeLease("box")!.generation;
    const stale = await call(
      "box",
      "file.list",
      { workspace_id: "hc:unplaced" },
      generation + 1,
    );
    expect(stale.error?.message).toContain("reconnected");
    const before = w.fake.calls.length;
    const typed = await call("box", "pane.send_text", {
      pane_id: "t1",
      text: "rm -rf /",
    });
    expect(typed.error?.message).toContain(
      "not available on a herdr-core connection",
    );
    expect(w.fake.calls.length).toBe(before);
    w.fake.kill(w.socket);
    await until(() => !w.core.manager.readyRuntimeLease("box")?.isCurrent());
    const gone = await call(
      "box",
      "file.list",
      { workspace_id: "hc:unplaced" },
      generation,
    );
    expect(gone.error?.message).toMatch(/not connected|reconnected/);
  });
});
