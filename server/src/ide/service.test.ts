import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHostLines } from "./host";
import { type IdeForward, type IdeHostRun, systemHostRun } from "./hosts";
import type { IdeDetectEnvironment } from "./providers";
import { type IdeConnection, IdeService, type IdeServiceDeps } from "./service";
import { type IdeSettingsStore, memoryIdeSettingsStore } from "./settings";

/**
 * World attaches to an IDE server per connection generation: a reconnect
 * or a change of host detaches it (its route and open sockets close) and
 * the server runs on; World reattaches when the connection is back, also
 * after a restart. Only Stop stops it: disabling the provider or removing
 * the connection leaves it running and listed.
 * The host scripts run for real under the local `sh`; the IDE is a fake
 * program that makes its socket and sleeps.
 */
const dirs: string[] = [];
const services: IdeService[] = [];
afterEach(async () => {
  for (const service of services.splice(0))
    await service.instances.stopWhere(() => true);
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const LOCAL: IdeConnection = {
  id: "local-a",
  label: "This computer",
  type: "local",
  generation: 1,
};

const SSH_CONNECTION: IdeConnection = {
  id: "ssh-b",
  label: "devbox",
  type: "ssh",
  generation: 4,
  sshDestination: "dev@devbox.example",
};

function alive(pid: number) {
  const stat = Bun.spawnSync(["ps", "-o", "stat=", "-p", String(pid)])
    .stdout.toString()
    .trim();
  return stat !== "" && !stat.startsWith("Z");
}

async function until(done: () => boolean, what: string) {
  const deadline = Date.now() + 10_000;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`timed out: ${what}`);
    await Bun.sleep(10);
  }
}

function scratch() {
  const top = mkdtempSync(join(tmpdir(), "hw-ide-service-"));
  dirs.push(top);
  const project = join(top, "project");
  const host = join(top, "host-home");
  mkdirSync(project, { recursive: true });
  mkdirSync(host, { recursive: true });
  const pids = join(top, "pids");
  const program = join(top, "bin", "ide");
  mkdirSync(join(top, "bin"));
  writeFileSync(
    program,
    `#!/bin/sh\necho $$ >> '${pids}'\nwhile [ $# -gt 0 ]; do case "$1" in --socket|--socket-path) : > "$2" ;; esac; shift; done\nexec sleep 600\n`,
  );
  chmodSync(program, 0o755);
  return { top, project, host, program, pids };
}

type Scratch = ReturnType<typeof scratch>;

function harness(
  options: {
    at?: Scratch;
    settings?: IdeSettingsStore;
    version?: () => Promise<string>;
    remoteDetect?: IdeServiceDeps["remoteDetect"];
  } = {},
) {
  const at = options.at ?? scratch();
  let connections: IdeConnection[] = [LOCAL];
  const local = systemHostRun({ PATH: "/usr/bin:/bin", HOME: at.top });
  const remote = systemHostRun({ PATH: "/usr/bin:/bin", HOME: at.host });
  const scripts: { target: string; script: string; stdin?: string }[] = [];
  const outcomes: string[] = [];
  const run: IdeHostRun = async (target, script, runOptions) => {
    scripts.push({
      target: target.kind === "ssh" ? target.destination : "local",
      script,
      stdin: runOptions.stdin,
    });
    // "SSH" runs the same script with the host's HOME.
    const result = await (target.kind === "ssh" ? remote : local)(
      { kind: "local" },
      script,
      runOptions,
    );
    const outcome = parseHostLines(result.stdout).values.get("result");
    if (outcome) outcomes.push(outcome);
    return result;
  };
  const forwards: { remote: string; drop(): void }[] = [];
  const forward: IdeForward = (_destination, remoteSocket, localSocket) => {
    let drop = () => {};
    const exited = new Promise((resolve) => {
      drop = () => resolve(null);
    });
    writeFileSync(localSocket, "");
    forwards.push({ remote: remoteSocket, drop });
    return { exited, kill: drop };
  };
  const environment: IdeDetectEnvironment = {
    platform: "linux",
    which: () => null,
    exists: () => true,
    realpath: (path) => path,
    isExecutableFile: (path) => path === at.program,
    version: options.version ?? (async () => "4.0.0"),
    homeDir: "",
  };
  const settings =
    options.settings ??
    memoryIdeSettingsStore({
      version: 1,
      providers: {
        "code-server": { enabled: true, trusted_at: "x", binary: at.program },
        vscode: {
          enabled: true,
          trusted_at: "x",
          terms_accepted_at: "x",
          binary: at.program,
        },
      },
    });
  const service = new IdeService({
    settings,
    environment,
    localRoot: join(at.top, "data"),
    instanceOptions: {
      run,
      forward,
      probe: async (upstream) => (existsSync(upstream.socketPath) ? 200 : null),
      sleep: (ms) => Bun.sleep(Math.min(ms, 10)),
      stopGraceMs: 300,
    },
    connection: (id) => connections.find((entry) => entry.id === id) ?? null,
    connectionIds: () => connections.map((entry) => entry.id),
    remoteDetect: options.remoteDetect,
  });
  services.push(service);
  const revoked: string[] = [];
  service.onRevoked((id) => revoked.push(id));
  const state = (id: string) => service.instances.get(id)?.state;
  const open = async (provider = "code-server") => {
    const connection = connections.find((entry) => entry.id === LOCAL.id);
    const result = await service.open({
      provider,
      connectionId: LOCAL.id,
      generation: connection?.generation,
      folder: at.project,
    });
    if (!result.ok) throw new Error(result.refusal.message);
    await until(() => state(result.instance.id) === "ready", "ready");
    expect(service.upstream(result.instance.id)).not.toBeNull();
    return result.instance;
  };
  const launched = () =>
    existsSync(at.pids)
      ? readFileSync(at.pids, "utf8").trim().split("\n").map(Number)
      : [];
  return {
    at,
    service,
    settings,
    open,
    state,
    revoked,
    scripts,
    outcomes,
    forwards,
    launched,
    set(next: IdeConnection[]) {
      connections = next;
    },
  };
}

test("a reconnect detaches the IDE and reattaches under the new generation; the server runs on", async () => {
  const h = harness();
  const instance = await h.open();
  expect(instance.generation).toBe(1);
  const [pid] = h.launched();
  h.set([{ ...LOCAL, generation: 2 }]);
  // The route alone refuses, before World hears of the change.
  expect(h.service.upstream(instance.id)).toBeNull();
  expect(h.revoked).toEqual([instance.id]);
  expect(h.state(instance.id)).toBe("detached");
  expect(alive(pid)).toBe(true);
  // World hears of it: it reattaches once to the same server.
  await h.service.reconcile();
  await until(() => h.state(instance.id) === "ready", "reattached");
  expect(h.service.instances.get(instance.id)?.generation).toBe(2);
  expect(h.outcomes).toEqual(["started"]);
  expect(h.launched()).toEqual([pid]);
});

test("a connection change while detection is pending starts no server", async () => {
  let detected!: (value: string) => void;
  const h = harness({
    version: () =>
      new Promise((resolve) => {
        detected = resolve;
      }),
  });
  const opening = h.service.open({
    provider: "code-server",
    connectionId: "local-a",
    generation: 1,
    folder: h.at.project,
  });
  for (let i = 0; i < 50 && !detected; i++) await Bun.sleep(1);
  h.set([
    {
      id: "local-a",
      label: "devbox",
      type: "ssh",
      generation: 2,
      sshDestination: "devbox.example",
    },
  ]);
  await h.service.reconcile();
  detected("4.0.0");
  const result = await opening;
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.refusal.code).toBe("stale");
  expect(h.scripts).toEqual([]);
  expect(h.service.instances.list()).toEqual([]);
});

test("a change to SSH detaches the server; Open attaches again; removing the connection leaves it running", async () => {
  const h = harness();
  const first = await h.open();
  const [pid] = h.launched();
  h.set([{ ...LOCAL, type: "ssh", sshDestination: "devbox.example" }]);
  // World calls this on every connection change; streams close at once.
  await h.service.reconcile();
  expect(h.revoked).toEqual([first.id]);
  expect(h.service.upstream(first.id)).toBeNull();
  expect(h.state(first.id)).toBe("detached");
  expect(h.service.instances.get(first.id)?.reason).toContain(
    "still runs there",
  );

  h.set([LOCAL]);
  // Not reattached on its own under the generation it was opened in.
  await h.service.reconcile();
  expect(h.state(first.id)).toBe("detached");
  const second = await h.open();
  expect(second.id).toBe(first.id);
  expect(h.outcomes).toEqual(["started"]);
  expect(alive(pid)).toBe(true);

  h.set([]);
  h.service.connectionRemoved("local-a");
  expect(h.state(first.id)).toBe("detached");
  expect(alive(pid)).toBe(true);
  // On World's own computer it stays stoppable.
  const [listed] = (await h.service.status()).instances;
  expect(listed).toMatchObject({ id: first.id, state: "detached" });
  expect(listed.unreachable).toBeUndefined();
  expect(await h.service.stop(first.id)).toEqual({ ok: true });
  expect(alive(pid)).toBe(false);
});

test("disable leaves its servers running and listed; only Stop ends them", async () => {
  const h = harness();
  const instance = await h.open();
  const [pid] = h.launched();
  await h.service.configure("code-server", h.at.program);
  expect(h.state(instance.id)).toBe("ready");
  await h.service.disable("code-server");
  expect(h.state(instance.id)).toBe("detached");
  expect(h.service.upstream(instance.id)).toBeNull();
  expect(h.service.instances.get(instance.id)?.reason).toContain("disabled");
  // Not reattached while disabled, also after a status read.
  await h.service.status({ refresh: true });
  expect(h.state(instance.id)).toBe("detached");
  expect(alive(pid)).toBe(true);
  expect(await h.service.stop(instance.id)).toEqual({ ok: true });
  expect(alive(pid)).toBe(false);
});

test("a removed SSH host's servers stay listed as unreachable, with how to stop them by hand, across a restart", async () => {
  const at = scratch();
  const remoteDetect: IdeServiceDeps["remoteDetect"] = async (
    _destination,
    provider,
  ) => ({
    provider,
    state: "detected",
    path: at.program,
    version: "1.0.0",
    configured: false,
  });
  const before = harness({ at, remoteDetect });
  before.set([SSH_CONNECTION]);
  const result = await before.service.open({
    provider: "code-server",
    connectionId: "ssh-b",
    generation: 4,
    folder: at.project,
  });
  if (!result.ok) throw new Error(result.refusal.message);
  await until(() => before.launched().length === 1, "launched");
  const [pid] = before.launched();
  before.set([]);
  before.service.connectionRemoved("ssh-b");
  before.service.closeAll();

  // A restarted World, without that connection: still listed, still
  // counted, never reached through another connection.
  const after = harness({ at, settings: before.settings, remoteDetect });
  after.set([LOCAL]);
  const [listed] = (await after.service.status()).instances;
  // Read before toMatchObject, which swaps matched fields for matchers.
  const byHandCommand = listed.stopByHand ?? "";
  expect(listed).toMatchObject({
    id: result.instance.id,
    state: "detached",
    sshDestination: SSH_CONNECTION.sshDestination,
    hostLabel: "devbox",
    unreachable: expect.stringContaining("connection was removed"),
    stopByHand: expect.stringContaining(
      `herdr-world/ide/${result.instance.id}`,
    ),
  });
  expect(after.scripts.some((entry) => entry.target !== "local")).toBe(false);
  const refused = await after.service.stop(result.instance.id);
  expect(refused).toMatchObject({ ok: false });
  expect(alive(pid)).toBe(true);

  // The hand command, run on the "host", ends it; then forget it.
  const byHand = await systemHostRun({ PATH: "/usr/bin:/bin", HOME: at.host })(
    { kind: "local" },
    byHandCommand,
    { timeoutMs: 10_000 },
  );
  expect(byHand.stderr).toBe("");
  expect(byHand.code).toBe(0);
  await until(() => !alive(pid), "stopped by hand");
  expect(after.service.forget(result.instance.id)).toEqual({ ok: true });
  expect((await after.service.status()).instances).toEqual([]);
  expect(after.settings.read().servers).toBeUndefined();
});

test("a restarted World lists the servers the last one started and reattaches", async () => {
  const before = harness();
  const instance = await before.open();
  const [pid] = before.launched();
  // World stops: it lets go and the server runs on.
  before.service.closeAll();
  expect(alive(pid)).toBe(true);

  const after = harness({ at: before.at, settings: before.settings });
  after.set([{ ...LOCAL, generation: 7 }]);
  const status = await after.service.status();
  expect(status.instances).toEqual([
    expect.objectContaining({ id: instance.id, folder: instance.folder }),
  ]);
  await until(() => after.state(instance.id) === "ready", "reattached");
  expect(after.service.instances.get(instance.id)?.startedAt).toBe(
    instance.startedAt,
  );
  expect(after.launched()).toEqual([pid]);
  expect(await after.service.stop(instance.id)).toEqual({ ok: true });
  expect(alive(pid)).toBe(false);
});

test("stock VS Code runs serve-web on World's computer and is embedded", async () => {
  const h = harness();
  const instance = await h.open("vscode");
  const start = h.scripts.find((entry) =>
    entry.script.includes("result=started"),
  );
  expect(start?.script).toContain(`'${h.at.program}' 'serve-web'`);
  expect(start?.script).toContain("'--accept-server-license-terms'");
  expect(instance.url).toBe(`/ide/${instance.id}/`);
});

test("an SSH project runs the host's own VS Code, detached from ssh, through an OpenSSH socket forward", async () => {
  const asked: string[] = [];
  const at = scratch();
  const h = harness({
    at,
    remoteDetect: async (destination, provider) => {
      asked.push(`${destination} ${provider}`);
      return {
        provider,
        state: "detected",
        path: at.program,
        version: "1.147.0",
        configured: false,
      };
    },
  });
  h.set([SSH_CONNECTION]);
  const result = await h.service.open({
    provider: "vscode",
    connectionId: "ssh-b",
    generation: 4,
    // A folder on the host (here, the scratch "host").
    folder: at.project,
  });
  if (!result.ok) throw new Error(result.refusal.message);
  expect(asked).toEqual(["dev@devbox.example vscode"]);
  const start = h.scripts.find((entry) =>
    entry.script.includes("result=started"),
  );
  expect(start?.target).toBe("dev@devbox.example");
  // The token goes on stdin, never into the script or a command line.
  expect(start?.stdin).toMatch(/^[A-Za-z0-9_-]{20,}\n$/);
  expect(start?.script).not.toContain(start?.stdin?.trim() ?? "");
  expect(h.forwards[0].remote).toBe(
    join(
      at.host,
      ".local/state/herdr-world/ide",
      result.instance.id,
      "ide.sock",
    ),
  );
  expect(result.instance.sshDestination).toBe("dev@devbox.example");
  await until(() => h.state(result.instance.id) === "ready", "ready");
  // The fake forward's socket is there at once; the program may lag.
  await until(() => h.launched().length === 1, "launched");
  const [pid] = h.launched();

  // The same connection now pointing at another host: World detaches.
  h.set([{ ...SSH_CONNECTION, sshDestination: "dev@other.example" }]);
  expect(h.service.upstream(result.instance.id)).toBeNull();
  expect(h.revoked).toEqual([result.instance.id]);
  expect(alive(pid)).toBe(true);
  // Stop still reaches the host it runs on.
  expect(await h.service.stop(result.instance.id)).toEqual({ ok: true });
  expect(h.scripts.at(-1)?.target).toBe("dev@devbox.example");
  expect(alive(pid)).toBe(false);
});

test("an SSH host without the IDE is refused with the host's name", async () => {
  const h = harness({
    remoteDetect: async (_destination, provider, hostLabel) => ({
      provider,
      state: "missing",
      reason: `Visual Studio Code isn't installed on ${hostLabel}.`,
      configured: false,
    }),
  });
  h.set([SSH_CONNECTION]);
  const result = await h.service.open({
    provider: "vscode",
    connectionId: "ssh-b",
    generation: 4,
    folder: "/srv/example/project",
  });
  expect(result).toMatchObject({
    ok: false,
    refusal: { code: "missing", message: expect.stringContaining("devbox") },
  });
  expect(h.scripts).toEqual([]);
});
