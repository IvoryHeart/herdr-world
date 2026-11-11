import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConnectionManager,
  type ConnectionRuntime,
  type ConnectionRuntimeContext,
} from "../connections/manager";
import {
  ConnectionProfileService,
  loadConnectionProfileBootstrap,
  type TuiManagedProfile,
} from "../connections/profile-service";
import { ConnectionProfileStore } from "../connections/profiles";
import { silentLogger } from "../utils/logger";
import { createCoreConnections } from "./connections";
import { CoreFenceError, CoreOperationFence } from "./fence";
import {
  type FloatShellOwner,
  type FloatShellPush,
  FloatShellRefusal,
  FloatShellService,
  floatShellName,
} from "./float-shell";
import type { CoreConnectionRuntime } from "./runtime";
import { FakeCore, type FakeCoreOptions } from "./testing/fake-core";
import { CORE_FLOAT_LABEL, CORE_UNPLACED_WORKSPACE } from "./topology";
import { localCoreTransport } from "./transport";
import { STREAM_WINDOW } from "./wire";

// Every expectation about core's replies follows a capture of the official
// 0.1.20 release under scratch directories (name_taken, the paused-then-
// resumed first paint, CLOSE with finish facts, `rm` answering a kill
// `not_found`); `core.live.test.ts` repeats the flow against a real core.

const roots: string[] = [];
const cores: Array<{ fake: FakeCore; socket: string }> = [];
const services: Array<{ stopSupervision(): void }> = [];
afterEach(async () => {
  for (const service of services.splice(0)) service.stopSupervision();
  for (const { fake, socket } of cores.splice(0)) fake.kill(socket);
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

async function until(predicate: () => boolean, ms = 2_000) {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await Bun.sleep(2);
  }
}

async function world(options: FakeCoreOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), "hcw-f-"));
  roots.push(root);
  const core = createCoreConnections({
    logger: silentLogger,
    changed: () => {},
    profiles: () => service,
    transportFor: (profile) => localCoreTransport(profile.core_state_dir),
  });
  const store = new ConnectionProfileStore({
    path: join(root, "data", "connections.json"),
  });
  const service: ConnectionProfileService<ConnectionRuntime, never> =
    new ConnectionProfileService({
      manager: new ConnectionManager<ConnectionRuntime>("startup-default"),
      core: core.support as never,
      store,
      bootstrap: loadConnectionProfileBootstrap({
        store,
        startupProfile: {
          id: "startup-default",
          label: "Default",
          type: "local",
          control_socket_path: "/synthetic/herdr.sock",
          client_socket_path: "/synthetic/herdr-client.sock",
          auto_connect: false,
        },
        explicitStartupOverride: false,
      }),
      createRuntime:
        (profile: TuiManagedProfile) =>
        (context: ConnectionRuntimeContext) => ({
          identity: {
            id: profile.id,
            label: profile.label,
            source: "local-profile",
          },
          context,
          startTransport: async () => {},
          startBackground: () => {},
          stop: async () => {},
        }),
      retry: { baseDelayMs: 5, maxDelayMs: 20, random: () => 0 },
    });
  services.push(service);
  const fake = new FakeCore({ heartbeatMs: 60_000, ...options });
  const stateDir = join(root, "core", "state");
  const socket = await fake.listen(stateDir, join(root, "core", "run"));
  cores.push({ fake, socket });
  const manager =
    core.manager as unknown as ConnectionManager<CoreConnectionRuntime>;
  const floats = new FloatShellService({
    lease: (id) => manager.readyRuntimeLease(id),
  });
  const connect = async (id = "box") => {
    await service.create({
      id,
      label: id,
      type: "local",
      runtime: "herdr-core",
      core_session: "default",
      core_state_dir: stateDir,
      auto_connect: true,
    } as never);
    await until(() => manager.status(id).state === "ready");
    return manager.readyRuntimeLease(id)!;
  };
  return { root, fake, socket, stateDir, manager, floats, connect };
}

/** A browser socket: what it was sent, decoded, and how far behind it is. */
function browser() {
  const pushes: FloatShellPush[] = [];
  let behind = 0;
  const owner: FloatShellOwner & {
    pushes: FloatShellPush[];
    output(stream: string): string;
    bytes(stream: string): number;
    closed(stream: string): FloatShellPush | undefined;
    setBehind(bytes: number): void;
  } = {
    pushes,
    send: (push) => {
      pushes.push(push);
      return true;
    },
    buffered: () => behind,
    setBehind: (bytes) => {
      behind = bytes;
    },
    output: (stream) =>
      new TextDecoder().decode(
        Buffer.concat(
          pushes
            .filter((p) => p.type === "float_output" && p.stream === stream)
            .map((p) => Buffer.from((p as { data: string }).data, "base64")),
        ),
      ),
    bytes: (stream) =>
      pushes
        .filter((p) => p.type === "float_output" && p.stream === stream)
        .reduce(
          (sum, p) =>
            sum + Buffer.from((p as { data: string }).data, "base64").length,
          0,
        ),
    closed: (stream) =>
      pushes.find((p) => p.type === "float_closed" && p.stream === stream),
  };
  return owner;
}

const agentFields = {
  argv: ["claude"],
  reported: true,
  status: { state: "idle" },
  cwd: "/srv/example/repo",
  foreground: {
    pid: 7,
    name: "claude",
    argv: ["claude"],
    cwd: "/srv/example/repo/web",
  },
};

const runCalls = (fake: FakeCore) =>
  fake.calls.filter((call) => call.method === "terminal.run");

describe("World float shell on herdr-core", () => {
  test("opens the room's shell in the agent's folder, unplaced and labelled, out of the read model", async () => {
    const w = await world();
    const agent = w.fake.create(agentFields);
    const lease = await w.connect();
    const tab = browser();
    const opened = await w.floats.open(tab, {
      connectionId: "box",
      generation: lease.generation,
      terminal: agent,
      size: { cols: 100, rows: 30 },
    });
    expect(opened).toMatchObject({
      name: floatShellName(CORE_UNPLACED_WORKSPACE),
      room: CORE_UNPLACED_WORKSPACE,
      created: true,
    });
    expect(opened.name).toMatch(/^[a-z0-9._-]{1,32}$/);
    expect(runCalls(w.fake)).toEqual([
      {
        method: "terminal.run",
        params: {
          name: opened.name,
          cwd: "/srv/example/repo/web",
          labels: { [CORE_FLOAT_LABEL]: CORE_UNPLACED_WORKSPACE },
          size: { cols: 100, rows: 30 },
          no_parent: true,
          no_notify: true,
          rm: true,
        },
      },
    ]);
    // Nothing reaches the browser before it holds the reply naming the stream.
    expect(tab.pushes).toEqual([]);
    w.floats.start(tab, opened.stream);
    await until(() => tab.output(opened.stream).includes("$ "));
    // Never `caller`, never agent argv, never placement.
    const params = JSON.stringify(w.fake.calls);
    expect(params).not.toContain("caller");
    expect(params).not.toContain("herdr.space");
    // A float shell is a view's scratch shell, never a desk.
    await until(() => Boolean(lease.runtime.core.terminal(opened.address)));
    const { panes } = await lease.runtime.operations.listTerminals();
    expect((panes ?? []).map((p) => p.terminal_id)).toEqual([agent]);
  });

  test("typed keys reach the shell; a UTF-8 character split across reads arrives whole", async () => {
    const w = await world({ splitWritesAt: 3 });
    const agent = w.fake.create(agentFields);
    const lease = await w.connect();
    const tab = browser();
    const { stream, address } = await w.floats.open(tab, {
      connectionId: "box",
      generation: lease.generation,
      terminal: agent,
      size: { cols: 80, rows: 24 },
    });
    w.floats.start(tab, stream);
    w.floats.input(tab, stream, new TextEncoder().encode("echo hé-€\r"));
    await until(() => tab.output(stream).includes("echo hé-€\r\n"));
    expect(w.fake.typed.get(address)).toBe("echo hé-€\r");
    // World forwards bytes; only the browser's terminal decodes them.
    expect(tab.output(stream)).not.toContain("�");
  });

  test("a second browser joins the same shell: core's unique name keeps one per room", async () => {
    const w = await world();
    const agent = w.fake.create(agentFields);
    const lease = await w.connect();
    const [a, b] = [browser(), browser()];
    const request = {
      connectionId: "box",
      generation: lease.generation,
      terminal: agent,
      size: { cols: 80, rows: 24 },
    };
    const [first, second] = await Promise.all([
      w.floats.open(a, request),
      w.floats.open(b, request),
    ]);
    expect(first.address).toBe(second.address);
    expect([first.created, second.created].sort()).toEqual([false, true]);
    // The loser was refused by core itself, then joined.
    expect(runCalls(w.fake).length).toBe(2);
    expect(
      [...lease.runtime.core.mirror.terminals()].filter(
        (t) => t.name === first.name,
      ).length,
    ).toBe(1);
    expect(w.fake.viewersOf(first.address).length).toBe(2);
  });

  test("a terminal World didn't start holding the name is never attached", async () => {
    const w = await world();
    const agent = w.fake.create(agentFields);
    w.fake.create({ name: floatShellName(CORE_UNPLACED_WORKSPACE) });
    const lease = await w.connect();
    const tab = browser();
    await expect(
      w.floats.open(tab, {
        connectionId: "box",
        generation: lease.generation,
        terminal: agent,
        size: { cols: 80, rows: 24 },
      }),
    ).rejects.toThrow("A terminal World didn't start holds the name");
    expect(w.fake.calls.map((c) => c.method)).not.toContain("terminal.attach");
    expect(w.fake.calls.map((c) => c.method)).not.toContain("terminal.run");
  });

  test("hide leaves it running at core's headless size; reopening shows the same shell", async () => {
    const w = await world();
    const agent = w.fake.create(agentFields);
    const lease = await w.connect();
    const tab = browser();
    const request = {
      connectionId: "box",
      generation: lease.generation,
      terminal: agent,
      size: { cols: 90, rows: 20 },
    };
    const first = await w.floats.open(tab, request);
    w.floats.start(tab, first.stream);
    w.floats.resize(tab, first.stream, { cols: 120, rows: 40 });
    await until(() => w.fake.terminal(first.address)?.cols === 120);
    w.floats.hide(tab, first.stream);
    await until(() => w.fake.viewersOf(first.address).length === 0);
    expect(w.fake.terminal(first.address)).toMatchObject({
      state: "live",
      cols: 200,
      rows: 120,
    });
    expect(tab.closed(first.stream)).toBeUndefined();
    expect(() =>
      w.floats.input(tab, first.stream, new Uint8Array([97])),
    ).toThrow(FloatShellRefusal);
    await until(() => Boolean(lease.runtime.core.terminal(first.address)));
    const again = await w.floats.open(tab, request);
    expect(again).toMatchObject({ address: first.address, created: false });
    expect(runCalls(w.fake).length).toBe(1);
  });

  test("exit in the shell closes every view; core removes it", async () => {
    const w = await world();
    const agent = w.fake.create(agentFields);
    const lease = await w.connect();
    const tab = browser();
    const { stream, address } = await w.floats.open(tab, {
      connectionId: "box",
      generation: lease.generation,
      terminal: agent,
      size: { cols: 80, rows: 24 },
    });
    w.floats.start(tab, stream);
    w.floats.input(tab, stream, new TextEncoder().encode("exit\r"));
    await until(() => Boolean(tab.closed(stream)));
    expect(tab.closed(stream)).toMatchObject({
      reason: "The shell exited",
      ended: true,
    });
    expect(w.fake.terminal(address)).toBeUndefined();
    expect(w.floats.openStreams).toBe(0);
  });

  test("stop ends exactly the room's shell, and core's rm-race not_found counts as ended", async () => {
    const w = await world();
    const agent = w.fake.create(agentFields);
    const lease = await w.connect();
    const tab = browser();
    const { stream, address } = await w.floats.open(tab, {
      connectionId: "box",
      generation: lease.generation,
      terminal: agent,
      size: { cols: 80, rows: 24 },
    });
    w.floats.start(tab, stream);
    await until(() => Boolean(lease.runtime.core.terminal(address)));
    await w.floats.stop(tab, stream);
    await until(() => Boolean(tab.closed(stream)));
    expect(tab.closed(stream)).toMatchObject({
      reason: "The shell was ended",
      ended: true,
    });
    expect(w.fake.terminal(agent)?.state).toBe("live");
    expect(w.fake.calls.filter((c) => c.method === "terminal.kill")).toEqual([
      { method: "terminal.kill", params: { terminal: address } },
    ]);
  });

  test("a replaced occupant is never ended: the kill fence refuses before dispatch", async () => {
    const w = await world();
    const agent = w.fake.create(agentFields);
    const lease = await w.connect();
    const tab = browser();
    const { stream, address } = await w.floats.open(tab, {
      connectionId: "box",
      generation: lease.generation,
      terminal: agent,
      size: { cols: 80, rows: 24 },
    });
    w.floats.start(tab, stream);
    await until(() => Boolean(lease.runtime.core.terminal(address)));
    const fence = CoreOperationFence.admit(lease, address, null, {
      foreground: false,
    });
    const occupancy = lease.runtime.core.occupancy(address);
    w.fake.replaceWithShell(address);
    await until(() => lease.runtime.core.occupancy(address) !== occupancy);
    const kill = lease.runtime.shells.kill(fence);
    await expect(kill).rejects.toBeInstanceOf(CoreFenceError);
    await expect(kill).rejects.toMatchObject({ reason: "occupant-replaced" });
    expect(w.fake.calls.map((c) => c.method)).not.toContain("terminal.kill");
  });

  test("the shell's own programs never fence it: a foreground change keeps the view and stop", async () => {
    const w = await world();
    const agent = w.fake.create(agentFields);
    const lease = await w.connect();
    const tab = browser();
    const { stream, address } = await w.floats.open(tab, {
      connectionId: "box",
      generation: lease.generation,
      terminal: agent,
      size: { cols: 80, rows: 24 },
    });
    w.floats.start(tab, stream);
    await until(() => Boolean(lease.runtime.core.terminal(address)));
    w.fake.foreground(address, {
      pid: 9,
      name: "vim",
      argv: ["vim"],
      cwd: "/srv/example",
    });
    await until(
      () =>
        (lease.runtime.core.terminal(address)?.foreground as { name?: string })
          ?.name === "vim",
    );
    w.floats.input(tab, stream, new TextEncoder().encode(":q"));
    // Another browser joins while the shell's foreground changes under the
    // attach in flight: the program is the same, so the view opens.
    w.fake.onCall = (method) => {
      if (method === "terminal.attach")
        w.fake.foreground(address, {
          pid: 10,
          name: "sh",
          argv: ["sh"],
          cwd: "/srv",
        });
    };
    const other = browser();
    const joined = await w.floats.open(other, {
      connectionId: "box",
      generation: lease.generation,
      terminal: agent,
      size: { cols: 80, rows: 24 },
    });
    expect(joined).toMatchObject({ address, created: false });
    w.fake.onCall = (method) => {
      if (method === "terminal.kill")
        w.fake.foreground(address, {
          pid: 11,
          name: "top",
          argv: ["top"],
          cwd: "/srv",
        });
    };
    await w.floats.stop(tab, stream);
    await until(() => Boolean(tab.closed(stream)));
  });

  test("kill -9 of core mid-stream closes the view; the old stream never resumes on the new core", async () => {
    const w = await world();
    const agent = w.fake.create(agentFields);
    const lease = await w.connect();
    const tab = browser();
    const { stream, address } = await w.floats.open(tab, {
      connectionId: "box",
      generation: lease.generation,
      terminal: agent,
      size: { cols: 80, rows: 24 },
    });
    w.floats.start(tab, stream);
    w.fake.output(address, "x".repeat(10_000));
    w.fake.kill(w.socket);
    await until(() => Boolean(tab.closed(stream)));
    expect(tab.closed(stream)).toMatchObject({ ended: false });
    expect(w.floats.openStreams).toBe(0);
    expect(() => w.floats.input(tab, stream, new Uint8Array([97]))).toThrow(
      FloatShellRefusal,
    );
    // Holders keep the shell; the next core serves it at the same address.
    w.fake.revive();
    await w.fake.listen(w.stateDir, join(w.root, "core", "run"));
    await until(() => w.manager.status("box").state === "ready");
    const next = w.manager.readyRuntimeLease("box")!;
    expect(next.generation).toBeGreaterThan(lease.generation);
    // The old generation is refused, never retargeted.
    await expect(
      w.floats.open(tab, {
        connectionId: "box",
        generation: lease.generation,
        terminal: agent,
        size: { cols: 80, rows: 24 },
      }),
    ).rejects.toThrow("reconnected");
    const again = await w.floats.open(tab, {
      connectionId: "box",
      generation: next.generation,
      terminal: agent,
      size: { cols: 80, rows: 24 },
    });
    expect(again).toMatchObject({ address, created: false });
  });

  test("lost ordering (an oversized missed, a heartbeat jump) closes views until reacquired", async () => {
    const w = await world();
    const agent = w.fake.create(agentFields);
    const lease = await w.connect();
    const tab = browser();
    const { stream } = await w.floats.open(tab, {
      connectionId: "box",
      generation: lease.generation,
      terminal: agent,
      size: { cols: 80, rows: 24 },
    });
    w.floats.start(tab, stream);
    w.fake.suppressEvents(1);
    w.fake.heartbeatNow();
    await until(() => Boolean(tab.closed(stream)));
    await until(
      () =>
        w.manager.status("box").state === "ready" &&
        w.manager.status("box").generation > lease.generation,
    );
  });

  test("exhausted credit: a browser that falls behind holds core's stream, then catches up", async () => {
    const w = await world();
    const agent = w.fake.create(agentFields);
    const lease = await w.connect();
    const tab = browser();
    const { stream, address } = await w.floats.open(tab, {
      connectionId: "box",
      generation: lease.generation,
      terminal: agent,
      size: { cols: 80, rows: 24 },
    });
    w.floats.start(tab, stream);
    await until(() => tab.bytes(stream) > 0);
    tab.setBehind(4 << 20);
    const before = tab.bytes(stream);
    const burst = STREAM_WINDOW * 3;
    w.fake.output(address, new Uint8Array(burst).fill(0x61));
    await Bun.sleep(150);
    // Core sent only its window; nothing more until World returns credit.
    expect(tab.bytes(stream) - before).toBeLessThanOrEqual(STREAM_WINDOW);
    tab.setBehind(0);
    await until(() => tab.bytes(stream) - before === burst, 4_000);
  });

  test("a browser that leaves releases its views; shells keep running", async () => {
    const w = await world();
    const agent = w.fake.create(agentFields);
    const lease = await w.connect();
    const tab = browser();
    const { address } = await w.floats.open(tab, {
      connectionId: "box",
      generation: lease.generation,
      terminal: agent,
      size: { cols: 80, rows: 24 },
    });
    w.floats.release(tab);
    await until(() => w.fake.viewersOf(address).length === 0);
    expect(w.fake.terminal(address)?.state).toBe("live");
    expect(w.floats.openStreams).toBe(0);
  });

  test("refusals: a core without shells, a connection not ready, an agent gone", async () => {
    const trimmed = await world();
    trimmed.fake.withoutMethods.add("terminal.run");
    const agent = trimmed.fake.create(agentFields);
    const lease = await trimmed.connect();
    const tab = browser();
    const request = {
      connectionId: "box",
      generation: lease.generation,
      terminal: agent,
      size: { cols: 80, rows: 24 },
    };
    await expect(trimmed.floats.open(tab, request)).rejects.toThrow(
      "does not offer shells",
    );
    expect(runCalls(trimmed.fake)).toEqual([]);

    const w = await world();
    const live = w.fake.create(agentFields);
    const current = await w.connect();
    const valid = {
      ...request,
      generation: current.generation,
      terminal: live,
    };
    await expect(
      w.floats.open(tab, { ...valid, connectionId: "nope" }),
    ).rejects.toThrow("not ready");
    await expect(
      w.floats.open(tab, { ...valid, terminal: "t99" }),
    ).rejects.toThrow("no longer running");
    await expect(
      w.floats.open(tab, { ...valid, size: { cols: Number.NaN, rows: 4 } }),
    ).rejects.toThrow("size");
    expect(runCalls(w.fake)).toEqual([]);
  });

  test("a folder core cannot start a shell in is refused with core's reason", async () => {
    const w = await world();
    const agent = w.fake.create({
      ...agentFields,
      foreground: { ...agentFields.foreground, cwd: "/nonexistent/example" },
    });
    const lease = await w.connect();
    await expect(
      w.floats.open(browser(), {
        connectionId: "box",
        generation: lease.generation,
        terminal: agent,
        size: { cols: 80, rows: 24 },
      }),
    ).rejects.toThrow("could not start a shell there");
  });

  test("rooms follow the read model: an app-placed agent gets its space's own shell", async () => {
    const w = await world();
    const placed = w.fake.create({
      ...agentFields,
      labels: { "herdr.space": "s1", where: "Web / main" },
    });
    const loose = w.fake.create(agentFields);
    const lease = await w.connect();
    const tab = browser();
    const request = (terminal: string) => ({
      connectionId: "box",
      generation: lease.generation,
      terminal,
      size: { cols: 80, rows: 24 },
    });
    const a = await w.floats.open(tab, request(placed));
    const b = await w.floats.open(tab, request(loose));
    expect(a.room).toBe("hc:space:s1");
    expect(b.room).toBe(CORE_UNPLACED_WORKSPACE);
    expect(a.address).not.toBe(b.address);
    expect(a.name).not.toBe(b.name);
  });
});
