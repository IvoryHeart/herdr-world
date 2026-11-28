import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHostLines } from "./host";
import { type IdeForward, type IdeHostRun, systemHostRun } from "./hosts";
import { IdeInstances, type IdeOpenRequest } from "./instances";
import type { IdeServerRecord } from "./settings";
import {
  hasSetsid,
  type ProcessTreeStandIn,
  parentOf,
  processTreeStandIn,
} from "./testing/process-tree-stand-in";

/**
 * World's side of an IDE server's lifetime (#1009), with the real host
 * scripts under the local `sh` and a stand-in IDE. SSH runs the same
 * scripts with HOME pointed at a scratch "host"; its forward is a double.
 * Each case is one of the lifetime's ordering and ownership questions:
 * reattach after a restart, two opens for one folder, Stop racing a
 * reattach or an open, and Stop reaching a re-parented terminal.
 */
const dirs: string[] = [];
const standIns: ProcessTreeStandIn[] = [];
const worlds: IdeInstances[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0))
    await world.stopWhere(() => true).catch(() => {});
  for (const standIn of standIns.splice(0)) standIn.cleanup();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const WORLD = "world-aaaaaaaaaaaaaaaa";

function alive(pid: number) {
  const stat = Bun.spawnSync(["ps", "-o", "stat=", "-p", String(pid)])
    .stdout.toString()
    .trim();
  return stat !== "" && !stat.startsWith("Z");
}

async function until(done: () => boolean, what: string, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`timed out: ${what}`);
    await Bun.sleep(10);
  }
}

function setup() {
  const top = mkdtempSync(join(tmpdir(), "hw-ide-inst-"));
  dirs.push(top);
  const project = join(top, "project");
  const host = join(top, "host-home");
  mkdirSync(project, { recursive: true });
  mkdirSync(host, { recursive: true });
  const standIn = processTreeStandIn(top);
  standIns.push(standIn);
  const local = systemHostRun({ PATH: "/usr/bin:/bin", HOME: top });
  const remote = systemHostRun({ PATH: "/usr/bin:/bin", HOME: host });
  const outcomes: string[] = [];
  // "SSH" runs the same script with the host's HOME; nothing else differs.
  const run: IdeHostRun = async (target, script, options) => {
    const result = await (target.kind === "ssh" ? remote : local)(
      { kind: "local" },
      script,
      options,
    );
    const outcome = parseHostLines(result.stdout).values.get("result");
    if (outcome) outcomes.push(outcome);
    return result;
  };
  const forwards: { remote: string; local: string; drop(): void }[] = [];
  const forward: IdeForward = (_destination, remoteSocket, localSocket) => {
    let drop = () => {};
    const exited = new Promise((resolve) => {
      drop = () => resolve(null);
    });
    writeFileSync(localSocket, "");
    forwards.push({ remote: remoteSocket, local: localSocket, drop });
    return { exited, kill: drop };
  };
  const world = (name = "data") => {
    const instances = new IdeInstances({
      localRoot: join(top, name),
      worldId: () => WORLD,
      run,
      forward,
      // The stand-in answers once it has made its socket.
      probe: async (upstream) => (existsSync(upstream.socketPath) ? 200 : null),
      sleep: () => new Promise((resolve) => setImmediate(resolve)),
      stopGraceMs: 300,
    });
    worlds.push(instances);
    return instances;
  };
  const request = (
    overrides: Partial<IdeOpenRequest> = {},
  ): IdeOpenRequest => ({
    provider: "vscode",
    binary: standIn.launcher,
    connectionId: "local-a",
    generation: 1,
    folder: project,
    ...overrides,
  });
  return { top, host, standIn, outcomes, forwards, world, request };
}

test.if(hasSetsid())(
  "World stopping leaves the server running; the next World finds it, checks it, and reattaches with its token",
  async () => {
    const h = setup();
    const first = h.world();
    const opened = await first.open(h.request());
    await until(() => first.get(opened.id)?.state === "ready", "ready");
    const token = first.upstream(opened.id)?.token;
    expect(token).toBeTruthy();
    const pids = await h.standIn.started();

    first.closeAll();
    expect(first.upstream(opened.id)).toBeNull();
    expect(h.standIn.survivors().sort()).toEqual(
      [pids.launcher, pids.server, pids.shell].sort(),
    );

    // A restarted World: same data folder and World ID, nothing in memory.
    const second = h.world();
    expect(second.list()).toEqual([]);
    await second.discover({});
    expect(second.list()).toEqual([
      expect.objectContaining({
        id: opened.id,
        connectionId: "local-a",
        folder: opened.folder,
        state: "detached",
        startedAt: opened.startedAt,
      }),
    ]);
    await second.reattach(opened.id, 2);
    await until(() => second.get(opened.id)?.state === "ready", "reattached");
    expect(second.upstream(opened.id)?.token).toBe(token);
    expect(second.get(opened.id)?.generation).toBe(2);
    // Once per generation: a detach doesn't loop back on its own.
    second.detachWhere(() => true);
    await second.reattach(opened.id, 2);
    expect(second.get(opened.id)?.state).toBe("detached");
    // Nothing new was launched.
    expect(h.outcomes).toEqual(["started"]);

    expect(await second.stop(opened.id)).toEqual({ ok: true });
    expect(second.list()).toEqual([]);
    expect([pids.launcher, pids.server, pids.shell].filter(alive)).toEqual([]);
  },
  30_000,
);

test.if(hasSetsid())(
  "two opens for one folder start one server, also across two Worlds sharing a host",
  async () => {
    const h = setup();
    const world = h.world();
    const [a, b] = await Promise.all([
      world.open(h.request()),
      world.open(h.request()),
    ]);
    expect(a.id).toBe(b.id);
    expect(world.list()).toHaveLength(1);
    await until(() => world.get(a.id)?.state === "ready", "ready");
    expect(h.outcomes).toEqual(["started"]);
    expect(await world.stop(a.id)).toEqual({ ok: true });

    // A restarted World racing the old one's start on the same host.
    h.outcomes.length = 0;
    const one = h.world();
    const two = h.world();
    const [x, y] = await Promise.all([
      one.open(h.request()),
      two.open(h.request()),
    ]);
    expect(x.id).toBe(y.id);
    expect(h.outcomes.sort()).toEqual(["running", "started"]);
    await until(
      () =>
        one.get(x.id)?.state === "ready" && two.get(x.id)?.state === "ready",
      "both attached",
    );
    expect(one.upstream(x.id)?.token).toBe(two.upstream(x.id)?.token);
    const pids = await h.standIn.started();
    expect(await one.stop(x.id)).toEqual({ ok: true });
    expect([pids.launcher, pids.server, pids.shell].filter(alive)).toEqual([]);
  },
  30_000,
);

test.if(hasSetsid())(
  "Stop racing a reattach and an open ends the old server completely before a new one starts",
  async () => {
    const h = setup();
    const first = h.world();
    const opened = await first.open(h.request());
    await until(() => first.get(opened.id)?.state === "ready", "ready");
    const old = await h.standIn.started();
    first.closeAll();

    const world = h.world();
    await world.discover({});
    h.standIn.forget();
    // Reattach, Stop and Open, all at once, in that order.
    const reattach = world.reattach(opened.id, 2);
    const stop = world.stop(opened.id);
    const open = world.open(h.request({ generation: 2 }));
    expect(world.get(opened.id)?.stopping).toBe(true);
    expect(world.upstream(opened.id)).toBeNull();
    await reattach;
    expect(await stop).toEqual({ ok: true });
    // Every process of the old launch is gone before the new one starts.
    expect([old.launcher, old.server, old.shell].filter(alive)).toEqual([]);
    const reopened = await open;
    expect(reopened.id).toBe(opened.id);
    const fresh = await h.standIn.started();
    expect(fresh.server).not.toBe(old.server);
    await until(() => world.get(opened.id)?.state === "ready", "reopened");
    expect(await world.stop(opened.id)).toEqual({ ok: true });
    expect([fresh.launcher, fresh.server, fresh.shell].filter(alive)).toEqual(
      [],
    );
  },
  30_000,
);

test.if(hasSetsid())(
  "over SSH a dropped forward detaches without stopping; Stop on the host ends a re-parented terminal",
  async () => {
    const h = setup();
    const world = h.world();
    const ssh = { destination: "dev@devbox.example.test", hostLabel: "devbox" };
    const opened = await world.open(h.request({ connectionId: "box", ssh }));
    await until(() => world.get(opened.id)?.state === "ready", "ready");
    expect(opened.sshDestination).toBe(ssh.destination);
    // World's socket is the forward's local end, under its own folder.
    expect(h.forwards[0].local).toBe(
      join(h.top, "data", "forwards", `${opened.id}.sock`),
    );
    expect(h.forwards[0].remote).toBe(
      join(h.host, ".local/state/herdr-world/ide", opened.id, "ide.sock"),
    );
    const pids = await h.standIn.started();
    expect(parentOf(pids.shell)).not.toBe(pids.server);

    const revoked: string[] = [];
    world.onRevoked((id) => revoked.push(id));
    h.forwards[0].drop();
    await until(() => world.get(opened.id)?.state === "detached", "detached");
    expect(world.get(opened.id)?.reason).toContain("still runs there");
    expect(revoked).toContain(opened.id);
    expect(h.standIn.survivors()).toHaveLength(3);

    // Open attaches again through a new forward; nothing new starts.
    await world.open(h.request({ connectionId: "box", ssh, generation: 2 }));
    await until(() => world.get(opened.id)?.state === "ready", "reattached");
    expect(h.forwards).toHaveLength(2);
    expect(h.outcomes).toEqual(["started"]);

    expect(await world.stop(opened.id)).toEqual({ ok: true });
    expect([pids.launcher, pids.server, pids.shell].filter(alive)).toEqual([]);
  },
  30_000,
);

test("a server that doesn't answer in time is detached, not stopped", async () => {
  const h = setup();
  let now = 0;
  const world = new IdeInstances({
    localRoot: join(h.top, "data"),
    worldId: () => WORLD,
    run: async () => ({
      code: 0,
      stdout: "root=/x\nresult=started\n",
      stderr: "",
    }),
    probe: async () => null,
    now: () => new Date(now),
    sleep: async () => {
      now += 30_000;
    },
    startTimeoutMs: 60_000,
  });
  const opened = await world.open(h.request());
  await until(() => world.get(opened.id)?.state === "detached", "detached");
  expect(world.get(opened.id)?.reason).toContain("still runs on this computer");
});

test("VS Code retrying its server download is detached with why, not left waiting", async () => {
  const h = setup();
  let now = 0;
  let downloads = 3;
  const world = new IdeInstances({
    localRoot: join(h.top, "data"),
    worldId: () => WORLD,
    // Its CLI logs one line per download attempt and never why one failed.
    run: async (_target: unknown, script: string) =>
      script.includes("downloads=")
        ? {
            code: 0,
            stdout: `state=running\ndownloads=${downloads++}\n`,
            stderr: "",
          }
        : { code: 0, stdout: "root=/x\nresult=started\n", stderr: "" },
    probe: async () => null,
    now: () => new Date(now),
    sleep: async () => {
      now += 3_000;
    },
  });
  worlds.push(world);
  const opened = await world.open(h.request());
  await until(() => world.get(opened.id)?.state === "detached", "detached");
  expect(world.get(opened.id)?.reason).toContain(
    "couldn't download its web server on this computer",
  );
  // Attempts before World began waiting don't count against it.
  expect(world.get(opened.id)?.reason).toContain("tried 5 times");
});

test("Stop that can't reach the host keeps the server listed with why", async () => {
  const h = setup();
  let reachable = true;
  const world = new IdeInstances({
    localRoot: join(h.top, "data"),
    worldId: () => WORLD,
    run: async () =>
      reachable
        ? { code: 0, stdout: "root=/x\nresult=started\n", stderr: "" }
        : { code: 255, stdout: "", stderr: "" },
    forward: () => ({ exited: new Promise(() => {}), kill() {} }),
    probe: async () => 200,
    sleep: async () => {},
  });
  const ssh = { destination: "dev@devbox.example.test", hostLabel: "devbox" };
  const opened = await world.open(h.request({ connectionId: "box", ssh }));
  reachable = false;
  const result = await world.stop(opened.id);
  expect(result.ok).toBe(false);
  expect(world.get(opened.id)).toMatchObject({
    state: "detached",
    reason: expect.stringContaining("It still runs there"),
  });
  // No answer to the first start: World can't tell whether it runs, so it
  // stays listed until the host shows it gone.
  let answer: "none" | "gone" = "none";
  const failing = new IdeInstances({
    localRoot: join(h.top, "data2"),
    worldId: () => WORLD,
    run: async () =>
      answer === "none"
        ? { code: 255, stdout: "", stderr: "" }
        : { code: 0, stdout: "root=/x\nresult=gone\n", stderr: "" },
  });
  expect(await failing.discover({ ssh })).toBe(false);
  const unsure = await failing.open(h.request({ connectionId: "box", ssh }));
  expect(unsure.state).toBe("detached");
  expect(unsure.reason).toContain("may be running there");
  expect((await failing.stop(unsure.id)).ok).toBe(false);
  expect(failing.list()).toHaveLength(1);
  answer = "gone";
  expect(await failing.stop(unsure.id)).toEqual({ ok: true });
  expect(failing.list()).toEqual([]);
});

test.if(hasSetsid())(
  "a start whose answer is lost stays listed and counted until Stop reaches its host and ends every process",
  async () => {
    const h = setup();
    const ssh = { destination: "dev@devbox.example.test", hostLabel: "devbox" };
    const remote = systemHostRun({ PATH: "/usr/bin:/bin", HOME: h.host });
    let reachable = true;
    let loseNextAnswer = true;
    const world = new IdeInstances({
      localRoot: join(h.top, "data"),
      worldId: () => WORLD,
      // The start really runs on the "host"; only its answer is lost, as
      // when SSH drops right after the launch (ssh exits 255).
      run: async (_target, script, options) => {
        if (!reachable) return { code: 255, stdout: "", stderr: "" };
        const result = await remote({ kind: "local" }, script, options);
        if (loseNextAnswer && script.includes("result=started")) {
          loseNextAnswer = false;
          return { code: 255, stdout: "", stderr: "" };
        }
        return result;
      },
      forward: () => ({ exited: new Promise(() => {}), kill() {} }),
      probe: async () => null,
      sleep: () => new Promise((resolve) => setImmediate(resolve)),
      stopGraceMs: 300,
      maxInstances: 1,
    });
    worlds.push(world);
    const opened = await world.open(h.request({ connectionId: "box", ssh }));
    const pids = await h.standIn.started();
    expect(world.get(opened.id)).toMatchObject({
      state: "detached",
      reason: expect.stringContaining("may be running there"),
    });
    // It counts against the cap: World refuses another, stops nothing.
    await expect(
      world.open(
        h.request({ connectionId: "box", ssh, folder: join(h.top, "other") }),
      ),
    ).rejects.toThrow("at most 1");
    expect(h.standIn.survivors()).toHaveLength(3);

    // Stop that can't reach the host proves nothing: it stays listed.
    reachable = false;
    expect((await world.stop(opened.id)).ok).toBe(false);
    expect(world.get(opened.id)?.state).toBe("detached");
    expect(h.standIn.survivors()).toHaveLength(3);

    reachable = true;
    expect(await world.stop(opened.id)).toEqual({ ok: true });
    expect(world.list()).toEqual([]);
    expect([pids.launcher, pids.server, pids.shell].filter(alive)).toEqual([]);
  },
  30_000,
);

test("World keeps the servers it started across a restart, also on a host it no longer reaches", async () => {
  const h = setup();
  let saved: IdeServerRecord[] = [];
  const inventory = {
    read: () => saved,
    write: (records: IdeServerRecord[]) => {
      saved = records;
    },
  };
  const asked: string[] = [];
  const make = () =>
    new IdeInstances({
      localRoot: join(h.top, "data"),
      worldId: () => WORLD,
      run: async (target) => {
        asked.push(target.kind === "ssh" ? target.destination : "local");
        return { code: 0, stdout: "root=/x\nresult=started\n", stderr: "" };
      },
      forward: (_destination, _remote, localSocket) => {
        writeFileSync(localSocket, "");
        return { exited: new Promise(() => {}), kill() {} };
      },
      probe: async () => 200,
      sleep: async () => {},
      maxInstances: 1,
      inventory,
    });
  const first = make();
  const ssh = { destination: "dev@old.example.test", hostLabel: "old box" };
  const opened = await first.open(h.request({ connectionId: "box", ssh }));
  await until(() => first.get(opened.id)?.state === "ready", "ready");
  expect(saved).toEqual([
    expect.objectContaining({
      id: opened.id,
      ssh_destination: ssh.destination,
      host_label: "old box",
    }),
  ]);
  first.closeAll();

  asked.length = 0;
  const second = make();
  // Listed before World reaches (or ever again asks) its host.
  expect(second.list()).toEqual([
    expect.objectContaining({
      id: opened.id,
      state: "detached",
      sshDestination: ssh.destination,
      hostLabel: "old box",
      startedAt: opened.startedAt,
    }),
  ]);
  await expect(
    second.open(h.request({ connectionId: "local-b" })),
  ).rejects.toThrow("at most 1");
  expect(asked).toEqual([]);
  // Forgetting (after a stop by hand) is the only way off the list
  // without its host.
  expect(second.forget(opened.id)).toBe(true);
  expect(saved).toEqual([]);
});
