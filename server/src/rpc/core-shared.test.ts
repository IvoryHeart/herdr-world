import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { herdrRuntimeFixture } from "../adapters/testing/runtime";
import {
  ConnectionManager,
  type ConnectionRuntime,
  type ConnectionRuntimeContext,
} from "../connections/manager";
import {
  ConnectionProfileService,
  loadConnectionProfileBootstrap,
} from "../connections/profile-service";
import { ConnectionProfileStore } from "../connections/profiles";
import { createCoreConnections } from "../herdr-core/connections";
import { FakeCore } from "../herdr-core/testing/fake-core";
import { localCoreTransport } from "../herdr-core/transport";
import type { PushTask } from "../notifications/web-push";
import { silentLogger } from "../utils/logger";
import { handleCoreSharedRpc } from "./core-shared";

/**
 * Seen and favourite through World's RPC, the real core provider (framed
 * client, ordered mirror, fence) and an in-process core: what a browser
 * asks for, what core receives, and what World then shows.
 */

const roots: string[] = [];
const cores: Array<{ fake: FakeCore; socket: string }> = [];
afterEach(async () => {
  for (const { fake, socket } of cores.splice(0))
    if (fake.isRunning) fake.kill(socket);
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

async function until(predicate: () => boolean | Promise<boolean>, ms = 3_000) {
  const deadline = Date.now() + ms;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await Bun.sleep(2);
  }
}

async function world(ordinal = 1) {
  const root = mkdtempSync(join(tmpdir(), "hcw-s-"));
  roots.push(root);
  const fake = new FakeCore({ heartbeatMs: 60_000 });
  fake.revive();
  const stateDir = join(root, "core", "state");
  const socket = await fake.listen(stateDir, join(root, "core", "run"));
  cores.push({ fake, socket });
  const pushed: Array<PushTask & { generation: number }> = [];
  const tui = new ConnectionManager<
    ConnectionRuntime & ReturnType<typeof herdrRuntimeFixture>
  >("startup-default");
  const core = createCoreConnections({
    logger: silentLogger,
    changed: () => {},
    profiles: () => service,
    transportFor: (profile) => localCoreTransport(profile.core_state_dir),
    push: (task, isCurrent) => {
      if (isCurrent())
        pushed.push({ ...task, generation: task.runtimeGeneration });
    },
  });
  const store = new ConnectionProfileStore({
    path: join(root, "data", "connections.json"),
  });
  const service = new ConnectionProfileService({
    manager: tui,
    core: core.support as never,
    store,
    bootstrap: loadConnectionProfileBootstrap({
      store,
      startupProfile: {
        id: "startup-default",
        label: "Herdr",
        type: "local",
        control_socket_path: "/synthetic/herdr.sock",
        client_socket_path: "/synthetic/herdr-client.sock",
        auto_connect: false,
      },
      explicitStartupOverride: false,
    }),
    createRuntime: (profile) => (context: ConnectionRuntimeContext) => ({
      identity: { id: profile.id, label: profile.label, source: "local" },
      context,
      ...herdrRuntimeFixture({ call: async () => ({}) }),
      startTransport: async () => {},
      startBackground: () => {},
      stop: async () => {},
    }),
    retry: { baseDelayMs: 5, maxDelayMs: 20, random: () => 0 },
  });
  for (let n = 1; n < ordinal; n++) fake.create();
  const scout = fake.create({
    name: "scout",
    argv: ["gemini"],
    foreground: { pid: 9, name: "gemini", argv: ["gemini"], cwd: "/w" },
  });
  fake.report(scout, { state: "working", app: "gemini" });
  await service.create({
    id: "box-core",
    label: "box core",
    type: "local",
    runtime: "herdr-core",
    core_session: "default",
    core_state_dir: stateDir,
    auto_connect: true,
  });
  await until(() => core.manager.readyRuntimeLease("box-core") !== null);
  const generation = () => core.manager.status("box-core").generation;
  const call = async (method: string, params: Record<string, unknown>) => {
    const out: { result?: unknown; error?: unknown } = {};
    await handleCoreSharedRpc({
      id: "1",
      method,
      params,
      sendReply: (message: Record<string, unknown>) => {
        out.result = message.result;
        return true;
      },
      sendError: (_context: string, error: unknown) => {
        out.error = error;
      },
      services: { core: { manager: core.manager } },
    });
    return out;
  };
  const record = () =>
    core.manager.readyRuntimeLease("box-core")?.runtime.core.terminal(scout);
  const labelCalls = () =>
    fake.calls.filter((c) => c.method === "terminal.label");
  return {
    fake,
    socket,
    scout,
    core,
    pushed,
    generation,
    call,
    record,
    labelCalls,
    target: (fields: Record<string, unknown> = {}) => ({
      connection_id: "box-core",
      connection_generation: generation(),
      terminal: scout,
      seen: null,
      ...fields,
    }),
  };
}

describe("world.core.seen and world.core.favourite", () => {
  test.each([1, 20])(
    "looking clears done for every client; a repeat writes nothing (ordinal %i)",
    async (ordinal) => {
      const w = await world(ordinal);
      w.fake.report(w.scout, { state: "done", app: "gemini" });
      await until(() => w.record()?.turn === 1);
      expect(await w.call("world.core.seen", w.target({ turn: 1 }))).toEqual({
        result: { written: true },
      });
      await until(() => w.record()?.labels["herdr.seen"] === "1");
      expect(w.labelCalls()).toEqual([
        {
          method: "terminal.label",
          params: { terminal: w.scout, labels: { "herdr.seen": "1" } },
        },
      ]);
      expect(await w.call("world.core.seen", w.target({ turn: 1 }))).toEqual({
        result: { written: false },
      });
      // Never lower and never a turn core has not reached.
      expect(await w.call("world.core.seen", w.target({ turn: 0 }))).toEqual({
        result: { written: false },
      });
      expect(await w.call("world.core.seen", w.target({ turn: 2 }))).toEqual({
        result: { written: false },
      });
      expect(w.labelCalls()).toHaveLength(1);
    },
  );

  test("a label another client moved after the browser's look is left alone", async () => {
    const w = await world();
    w.fake.report(w.scout, { state: "done", app: "gemini" });
    await until(() => w.record()?.turn === 1);
    // The phone looked, then marked it unread, before World's write arrived.
    w.fake.label(w.scout, { "herdr.seen": "1" });
    w.fake.label(w.scout, { "herdr.seen": "0" });
    await until(() => w.record()?.labels["herdr.seen"] === "0");
    // The browser decided on the missing label it saw.
    expect(await w.call("world.core.seen", w.target({ turn: 1 }))).toEqual({
      result: { written: false },
    });
    expect(w.labelCalls()).toHaveLength(0);
    // A new look, decided on the unread label, raises it again.
    expect(
      await w.call("world.core.seen", w.target({ turn: 1, seen: 0 })),
    ).toEqual({ result: { written: true } });
  });

  test.each([1, 20])(
    "favourite sets and removes herdr.pinned, and nothing else (ordinal %i)",
    async (ordinal) => {
      const w = await world(ordinal);
      w.fake.label(w.scout, { where: "web / research", "herdr.space": "s1" });
      await until(() => w.record()?.labels.where === "web / research");
      await w.call("world.core.favourite", w.target({ favourite: true }));
      await until(() => w.record()?.labels["herdr.pinned"] === "1");
      await w.call("world.core.favourite", w.target({ favourite: false }));
      await until(() => w.record()?.labels["herdr.pinned"] === undefined);
      expect(w.record()?.labels).toEqual({
        where: "web / research",
        "herdr.space": "s1",
      });
      expect(w.labelCalls().map((c) => c.params)).toEqual([
        { terminal: w.scout, labels: { "herdr.pinned": "1" } },
        { terminal: w.scout, labels: { "herdr.pinned": "" } },
      ]);
    },
  );

  test.each([1, 20])(
    "refuses anything but a live local terminal of the observed generation (ordinal %i)",
    async (ordinal) => {
      const w = await world(ordinal);
      w.fake.report(w.scout, { state: "done", app: "gemini" });
      await until(() => w.record()?.turn === 1);
      for (const params of [
        w.target({ turn: 1, connection_generation: w.generation() + 1 }),
        w.target({ turn: 1, terminal: "scout" }),
        w.target({ turn: 1, terminal: "m/t1" }),
        w.target({ turn: 1, connection_id: "startup-default" }),
        w.target({ turn: 1, terminal: "t99" }),
        w.target({ turn: "1" }),
        w.target({ turn: 1, seen: "0" }),
        w.target({ turn: 1, seen: undefined }),
      ])
        expect((await w.call("world.core.seen", params)).error).toBeInstanceOf(
          Error,
        );
      expect(
        (await w.call("world.core.favourite", w.target({ favourite: 1 })))
          .error,
      ).toBeInstanceOf(Error);
      expect(w.labelCalls()).toHaveLength(0);
    },
  );

  test("a replaced occupant is not an agent: its old turn is not shared", async () => {
    const w = await world();
    w.fake.report(w.scout, { state: "done", app: "gemini" });
    await until(() => w.record()?.turn === 1);
    w.fake.replaceWithShell(w.scout);
    await until(() => w.record()?.status === null);
    expect(await w.call("world.core.seen", w.target({ turn: 1 }))).toEqual({
      result: { written: false },
    });
    expect(w.labelCalls()).toHaveLength(0);
  });

  test("kill -9 of core: the write is not retried and World recovers", async () => {
    const w = await world();
    w.fake.report(w.scout, { state: "done", app: "gemini" });
    await until(() => w.record()?.turn === 1);
    const pending = w.call("world.core.seen", w.target({ turn: 1 }));
    w.fake.kill(w.socket);
    const outcome = await pending;
    // Either core took it before dying or the write failed: never twice.
    expect(w.labelCalls().length).toBeLessThanOrEqual(1);
    const before = w.labelCalls().length;
    if (!("result" in outcome) || outcome.result === undefined)
      expect(outcome.error).toBeInstanceOf(Error);
    w.fake.revive();
    await w.fake.listen(
      join(w.socket, "..", "..", "state"),
      join(w.socket, ".."),
    );
    await until(
      () => w.core.manager.readyRuntimeLease("box-core") !== null,
      5_000,
    );
    expect(w.labelCalls()).toHaveLength(before);
  });
});

describe("push from core status events", () => {
  test("finishing and needing you push once; replacements and repeats do not", async () => {
    const w = await world();
    w.fake.report(w.scout, { state: "done", app: "gemini" });
    await until(() => w.pushed.length === 1);
    expect(w.pushed[0]).toMatchObject({
      kind: "completed",
      paneId: w.scout,
      agent: "gemini",
      sender: { known: true, agent: "gemini" },
      // Qualified like a Herdr push, and named: World has two connections.
      connectionId: "box-core",
      connectionLabel: "box core",
      generation: w.generation(),
    });
    w.fake.report(w.scout, { state: "working", app: "gemini" });
    w.fake.report(w.scout, {
      state: "blocked",
      kind: "permission",
      app: "gemini",
    });
    await until(() => w.pushed.length === 2);
    expect(w.pushed[1]).toMatchObject({ kind: "blocked", paneId: w.scout });
    w.fake.replaceWithShell(w.scout);
    await until(() => w.record()?.status === null);
    await Bun.sleep(20);
    expect(w.pushed).toHaveLength(2);
  });

  test("a turn that ends while World is disconnected pushes once on return", async () => {
    const w = await world();
    const first = w.generation();
    w.fake.kill(w.socket);
    await until(() => w.core.manager.readyRuntimeLease("box-core") === null);
    w.fake.revive();
    w.fake.report(w.scout, { state: "done", app: "gemini" });
    await w.fake.listen(
      join(w.socket, "..", "..", "state"),
      join(w.socket, ".."),
    );
    await until(() => w.pushed.length === 1, 5_000);
    expect(w.pushed[0]).toMatchObject({ kind: "completed", paneId: w.scout });
    expect(w.pushed[0]!.generation).toBeGreaterThan(first);
    await Bun.sleep(20);
    expect(w.pushed).toHaveLength(1);
  });
});
