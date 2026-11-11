import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
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
  type StartupLocalProfile,
  type TuiManagedProfile,
} from "../connections/profile-service";
import { ConnectionProfileStore } from "../connections/profiles";
import { silentLogger } from "../utils/logger";
import { createCoreConnections } from "./connections";
import { CoreFenceError, CoreOperationFence } from "./fence";
import { CORE_FIXTURE_CONNECTION_ID, createCoreFixture } from "./fixture";
import type { CoreObservation } from "./observations";
import { readCoreScreen } from "./runtime";
import { coreAgentStatus } from "./topology";
import { handleCoreSharedRpc } from "../rpc/core-shared";
import { localCoreTransport } from "./transport";
import { FakeCore } from "./testing/fake-core";

const roots: string[] = [];
const cores: Array<{ fake: FakeCore; socket: string }> = [];
afterEach(async () => {
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

const startup: StartupLocalProfile = {
  id: "startup-default",
  label: "Default",
  type: "local",
  control_socket_path: "/synthetic/herdr.sock",
  client_socket_path: "/synthetic/herdr-client.sock",
  auto_connect: false,
};

function world() {
  const root = mkdtempSync(join(tmpdir(), "hcw-t-"));
  roots.push(root);
  const tuiManager = new ConnectionManager<ConnectionRuntime>(
    "startup-default",
  );
  const tuiRuntime =
    (profile: TuiManagedProfile) => (context: ConnectionRuntimeContext) => ({
      identity: {
        id: profile.id,
        label: profile.label,
        source: "local-profile",
      },
      context,
      startTransport: async () => {},
      startBackground: () => {},
      stop: async () => {},
    });
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
      manager: tuiManager,
      core: core.support as never,
      store,
      bootstrap: loadConnectionProfileBootstrap({
        store,
        startupProfile: startup,
        explicitStartupOverride: false,
      }),
      createRuntime: tuiRuntime,
      retry: { baseDelayMs: 5, maxDelayMs: 20, random: () => 0 },
    });
  return { root, service, core, tuiManager };
}

async function servedCore(root: string, name = "core") {
  const fake = new FakeCore({ heartbeatMs: 60_000 });
  const stateDir = join(root, name, "state");
  const socket = await fake.listen(stateDir, join(root, name, "run"));
  cores.push({ fake, socket });
  return { fake, stateDir, socket };
}

const coreProfile = (id: string, stateDir: string) => ({
  id,
  label: id,
  type: "local",
  runtime: "herdr-core",
  core_session: "default",
  core_state_dir: stateDir,
  auto_connect: true,
});

const observed = (w: ReturnType<typeof world>, id: string) =>
  w.core.observations.get(id) as CoreObservation | null;

describe("herdr-core connections", () => {
  test("connected, stale after kill -9, then the same terminals at the same addresses", async () => {
    const w = world();
    const { fake, stateDir, socket } = await servedCore(w.root);
    const agent = fake.create({
      name: "agent",
      argv: ["claude"],
      reported: true,
      status: { state: "working" },
    });
    fake.create({ name: "shell" });
    const created = await w.service.create(coreProfile("box-core", stateDir));
    expect(created).toMatchObject({
      id: "box-core",
      runtime: "herdr-core",
      state: "ready",
    });
    expect(observed(w, "box-core")).toMatchObject({
      state: "live",
      core: { id: fake.coreId, name: "example-host" },
      counts: { live: 2, finished: 0, remote: 0 },
    });
    // Herdr consumers never see a core runtime.
    expect(w.service.list().map((c) => c.id)).not.toContain("box-core");
    expect(w.service.coreList().map((c) => c.id)).toEqual(["box-core"]);
    const before = observed(w, "box-core")!.terminals.map((t) => [
      t.address,
      t.name,
    ]);

    fake.kill(socket);
    await until(() => w.core.manager.status("box-core").state !== "ready");
    expect(observed(w, "box-core")).toMatchObject({
      state: "stale",
      reason: "disconnected",
    });
    expect(
      observed(w, "box-core")!.terminals.map((t) => [t.address, t.name]),
    ).toEqual(before);
    expect(w.core.manager.status("box-core").state).toBe("reconnecting");

    fake.revive();
    await fake.listen(stateDir, join(w.root, "core", "run"));
    await until(() => w.core.manager.status("box-core").state === "ready");
    const back = observed(w, "box-core")!;
    expect(back.state).toBe("live");
    expect(back.core?.pid).toBe(fake.pid);
    expect(back.terminals.map((t) => [t.address, t.name])).toEqual(before);
    expect(back.terminals.find((t) => t.address === agent)?.status).toBe(
      "working",
    );
  });

  test("with no core nothing starts: no socket, no lock, only an unavailable connection", async () => {
    const w = world();
    const stateDir = join(w.root, "absent", "state");
    const result = w.service.create(coreProfile("absent", stateDir));
    await expect(result).resolves.toMatchObject({ id: "absent" });
    expect(["reconnecting", "error"]).toContain(
      w.core.manager.status("absent").state,
    );
    expect(w.core.manager.status("absent").error?.message).toContain(
      "no herdr-core has run",
    );
    expect(existsSync(stateDir)).toBe(false);
    w.service.stopSupervision();
  });

  test("a silently dropped event (heartbeat jump) retires actionability, then reacquires", async () => {
    const w = world();
    const { fake, stateDir } = await servedCore(w.root);
    fake.create();
    await w.service.create(coreProfile("jump", stateDir));
    const generation = w.core.manager.status("jump").generation;
    fake.suppressEvents(1);
    fake.heartbeatNow();
    await until(
      () =>
        w.core.manager.status("jump").generation > generation + 1 &&
        w.core.manager.status("jump").state === "ready",
    );
    expect(observed(w, "jump")?.state).toBe("live");
  });

  test("an operation keeps its original lease, core and occupant", async () => {
    const w = world();
    const { fake, stateDir, socket } = await servedCore(w.root);
    const t1 = fake.create({
      argv: ["claude"],
      reported: true,
      foreground: { pid: 7, name: "claude", argv: ["claude"], cwd: "/tmp" },
    });
    await w.service.create(coreProfile("a", stateDir));
    const lease = w.core.manager.readyRuntimeLease("a")!;
    const fence = CoreOperationFence.admit(lease, t1);
    fence.check("dispatch");
    // A kept replacement: same address, a shell now.
    fake.replaceWithShell(t1);
    await until(() => lease.runtime.core.terminal(t1)?.argv[0] === "/bin/sh");
    expect(() => fence.check("dispatch")).toThrow(CoreFenceError);
    try {
      fence.check("publication");
    } catch (error) {
      expect((error as CoreFenceError).reason).toBe("occupant-replaced");
    }
    // A new occupant fence would pass; the old one stays refused across a restart.
    const fresh = CoreOperationFence.admit(lease, t1);
    fake.kill(socket);
    await until(() => !lease.isCurrent());
    expect(() => fresh.check("dispatch")).toThrow("lease");
  });

  test("a screen read whose occupant is replaced before its reply is refused at publication", async () => {
    const w = world();
    const { fake, stateDir, socket } = await servedCore(w.root);
    const t1 = fake.create({
      argv: ["claude"],
      reported: true,
      foreground: { pid: 7, name: "claude", argv: ["claude"], cwd: "/tmp" },
    });
    await w.service.create(coreProfile("r", stateDir));
    const lease = w.core.manager.readyRuntimeLease("r")!;
    expect(await readCoreScreen(lease, t1)).toMatchObject({ how: "screen" });
    const reads = () =>
      fake.calls.filter((c) => c.method === "terminal.read").length;
    const release = fake.holdReads();
    const pending = readCoreScreen(lease, t1);
    pending.catch(() => {});
    await until(() => reads() === 2);
    const pid = lease.runtime.core.terminal(t1)?.pid;
    fake.replaceWithShell(t1);
    await until(() => lease.runtime.core.terminal(t1)?.pid !== pid);
    release();
    await expect(pending).rejects.toMatchObject({
      stage: "publication",
      reason: "occupant-replaced",
    });
    expect(fake.calls.at(-1)?.params).toMatchObject({ terminal: t1, lines: 0 });
    // The new occupant is a new admission; a lapsed lease admits nothing.
    expect(await readCoreScreen(lease, t1)).toMatchObject({ how: "screen" });
    fake.kill(socket);
    await until(() => !lease.isCurrent());
    await expect(readCoreScreen(lease, t1)).rejects.toMatchObject({
      stage: "admission",
      reason: "lease",
    });
    expect(reads()).toBe(3);
  });

  test("a fence never dispatches through another runtime", async () => {
    const w = world();
    const { fake, stateDir } = await servedCore(w.root);
    const t1 = fake.create({ argv: ["claude"] });
    await w.service.create(coreProfile("a", stateDir));
    await w.service.create(coreProfile("b", stateDir));
    const fromA = CoreOperationFence.admit(
      w.core.manager.readyRuntimeLease("a")!,
      t1,
    );
    const b = w.core.manager.readyRuntimeLease("b")!;
    await expect(b.runtime.readScreen(fromA)).rejects.toMatchObject({
      stage: "dispatch",
      reason: "lease",
    });
    expect(fake.calls.some((c) => c.method === "terminal.read")).toBe(false);
  });

  test("profile A's delayed work never dispatches through profile B on the same core", async () => {
    const w = world();
    const { fake, stateDir } = await servedCore(w.root);
    const t1 = fake.create({ argv: ["claude"] });
    await w.service.create(coreProfile("a", stateDir));
    await w.service.create(coreProfile("b", stateDir));
    const fromA = CoreOperationFence.admit(
      w.core.manager.readyRuntimeLease("a")!,
      t1,
    );
    await w.service.disconnect("a");
    const b = w.core.manager.readyRuntimeLease("b")!;
    expect(b.runtime.core.epoch?.coreId).toBe(fake.coreId);
    expect(b.runtime.core.terminal(t1)).toBeDefined();
    expect(() => fromA.check("dispatch")).toThrow(CoreFenceError);
    expect(fromA.connectionId).toBe("a");
  });

  test("a runtime kind is part of a connection's identity", async () => {
    const w = world();
    const { stateDir } = await servedCore(w.root);
    await w.service.create(coreProfile("c", stateDir));
    await expect(w.service.setDefault("c")).rejects.toThrow(
      "must be a Herdr connection",
    );
    await expect(
      w.service.update("c", {
        id: "c",
        label: "c",
        type: "local",
        control_socket_path: "/x/a.sock",
        client_socket_path: "/x/b.sock",
        auto_connect: false,
      }),
    ).rejects.toThrow("runtime cannot be changed");
    const saved = JSON.parse(
      readFileSync(join(w.root, "data", "connections.json"), "utf8"),
    );
    expect(saved.default_connection_id).not.toBe("c");
    expect(
      saved.profiles.find((p: { id: string }) => p.id === "c").runtime,
    ).toBe("herdr-core");
    // The connection test reaches the core directly and starts nothing.
    await expect(w.service.test({ id: "c" })).resolves.toMatchObject({
      ok: true,
      version: "0.1.20",
      protocol: 1,
    });
    expect(readdirSync(join(w.root, "core", "run"))).toEqual(["default.sock"]);
  });

  test("the preview fixture: start, kill, start again, remove", async () => {
    const w = world();
    const fixture = createCoreFixture(() => w.service);
    expect(await fixture.start()).toMatchObject({ running: true });
    await until(() => w.core.manager.status("core-fixture").state === "ready");
    const first = observed(w, "core-fixture")!;
    expect(first.state).toBe("live");
    expect(first.terminals.map((t) => [t.name, t.status])).toEqual([
      ["reviewer", "blocked"],
      ["builder", "working"],
      ["tests", "working"],
      ["preview-server", null],
      ["scout", "working"],
      ["helper", null],
      ["fixture-shell", null],
    ]);
    expect(fixture.kill()).toMatchObject({ running: false });
    await until(() => observed(w, "core-fixture")?.state === "stale");
    // Killed: World retries, but nothing starts a core.
    await Bun.sleep(60);
    expect(fixture.status().running).toBe(false);
    expect(w.core.manager.status("core-fixture").state).toBe("reconnecting");
    await fixture.start();
    await until(() => observed(w, "core-fixture")?.state === "live");
    expect(
      observed(w, "core-fixture")!.terminals.map((t) => [t.address, t.name]),
    ).toEqual(first.terminals.map((t) => [t.address, t.name]));
    await fixture.remove();
    expect(w.service.coreList()).toEqual([]);
  });

  test("the preview fixture walks the shared seen and favourite try-out", async () => {
    const w = world();
    const fixture = createCoreFixture(() => w.service, { finishMs: 20 });
    expect(() => fixture.otherApp("unread")).toThrow("start");
    await fixture.start();
    await until(() => w.core.manager.status("core-fixture").state === "ready");
    const lease = () => w.core.manager.readyRuntimeLease("core-fixture")!;
    const address = observed(w, "core-fixture")!.terminals.find(
      (t) => t.name === "scout",
    )!.address;
    const scout = () => lease().runtime.core.terminal(address)!;
    const status = () => coreAgentStatus(scout(), 0);
    await until(() => status() === "done");
    const call = async (method: string, extra: Record<string, unknown>) => {
      let error: unknown = null;
      await handleCoreSharedRpc({
        id: "1",
        method,
        params: {
          connection_id: "core-fixture",
          connection_generation: lease().generation,
          terminal: address,
          ...extra,
        },
        sendReply: () => true,
        sendError: (_context, failure) => {
          error = failure;
        },
        services: { core: { manager: w.core.manager } },
      });
      expect(error).toBeNull();
    };
    // Looking in World clears done for every client.
    await call("world.core.seen", { turn: 1, seen: null });
    await until(() => status() === "idle");
    // The phone marks it unread: done again in World too. (The browser
    // shares a turn once per look, so a screen left on does not undo it.)
    fixture.otherApp("unread");
    await until(() => status() === "done");
    expect(scout().labels).toMatchObject({ "herdr.seen": "0" });
    // Another turn while hidden: done until looked at.
    fixture.turn();
    await until(() => scout().turn === 2);
    expect(status()).toBe("done");
    // Favourite both ways.
    fixture.otherApp("pin");
    await until(() => scout().labels?.["herdr.pinned"] === "1");
    await call("world.core.favourite", { favourite: false });
    await until(() => scout().labels?.["herdr.pinned"] === undefined);
    await fixture.remove();
  });

  test("the fixture never adopts or removes a profile it does not own", async () => {
    const w = world();
    const { stateDir } = await servedCore(w.root);
    const mine = coreProfile(CORE_FIXTURE_CONNECTION_ID, stateDir);
    await w.service.create({ ...mine, label: "Existing user core" });
    const fixture = createCoreFixture(() => w.service);
    // Remove without ever starting, then start: both refuse to touch it.
    await expect(fixture.remove()).rejects.toThrow("left in place");
    await expect(fixture.start()).rejects.toThrow("is not this fixture's");
    expect(fixture.status().running).toBe(false);
    await expect(fixture.remove()).rejects.toThrow("left in place");
    const kept = w.service.coreList();
    expect(kept.map((c) => [c.id, c.label, c.core_state_dir])).toEqual([
      [CORE_FIXTURE_CONNECTION_ID, "Existing user core", stateDir],
    ]);
    const saved = JSON.parse(
      readFileSync(join(w.root, "data", "connections.json"), "utf8"),
    );
    expect(
      saved.profiles.find(
        (p: { id: string }) => p.id === CORE_FIXTURE_CONNECTION_ID,
      )?.label,
    ).toBe("Existing user core");
  });

  test("an earlier run's profile is left for the person to remove", async () => {
    const w = world();
    const earlier = createCoreFixture(() => w.service);
    await earlier.start();
    const leftDir = w.service.coreList()[0]!.core_state_dir;
    // An earlier World stopped without removing the fixture's profile.
    earlier.dispose();
    const fixture = createCoreFixture(() => w.service);
    await expect(fixture.start()).rejects.toThrow("remove it in Settings");
    await expect(fixture.remove()).rejects.toThrow("left in place");
    expect(w.service.coreList().map((c) => c.core_state_dir)).toEqual([
      leftDir,
    ]);
    // Once the person removes it, the fixture starts as usual.
    await w.service.remove(CORE_FIXTURE_CONNECTION_ID);
    await fixture.start();
    await fixture.remove();
    expect(w.service.coreList()).toEqual([]);
  });

  test("a user profile at a fixture-like path is never removed", async () => {
    const w = world();
    const dir = join(tmpdir(), "hcw-fixture-user-managed", "state");
    await w.service.create(coreProfile(CORE_FIXTURE_CONNECTION_ID, dir));
    const fixture = createCoreFixture(() => w.service);
    await expect(fixture.remove()).rejects.toThrow("left in place");
    expect(w.service.coreList().map((c) => c.core_state_dir)).toEqual([dir]);
  });
});
