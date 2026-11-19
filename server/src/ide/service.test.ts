import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type IdeChild, IdeInstances } from "./instances";
import type { IdeDetectEnvironment } from "./providers";
import { type IdeConnection, IdeService, type IdeServiceDeps } from "./service";
import { memoryIdeSettingsStore } from "./settings";

/**
 * Admission is per connection generation: a reconnect, a change to SSH or
 * removal ends the IDE World opened, its route and its open sockets.
 */
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const PROGRAM = "/opt/example/code-server/bin/code-server";
const VSCODE = "/opt/example/vscode/bin/code-tunnel";

function harness(
  version: () => Promise<string> = async () => "4.0.0",
  remoteDetect?: IdeServiceDeps["remoteDetect"],
) {
  const top = mkdtempSync(join(tmpdir(), "hw-ide-service-"));
  dirs.push(top);
  const project = join(top, "project");
  mkdirSync(project, { recursive: true });
  let connection: IdeConnection | null = {
    id: "local-a",
    label: "This computer",
    type: "local",
    generation: 1,
  };
  const killed: number[] = [];
  const launches: { command: string[]; stdin?: string }[] = [];
  let spawned = 0;
  let pid = 100;
  const instances = new IdeInstances({
    runtimeRoot: top,
    sleep: async () => {},
    probe: async () => 200,
    spawn: ({ command, stdin }) => {
      spawned++;
      launches.push({ command, stdin });
      // The fake server is the socket file: code-server's `--socket`,
      // VS Code's `--socket-path`, or the local end of ssh's `-L`.
      const flag = ["--socket", "--socket-path", "-L"].find((name) =>
        command.includes(name),
      );
      if (!flag) throw new Error("no socket in the launch");
      const value = command[command.indexOf(flag) + 1];
      writeFileSync(flag === "-L" ? value.split(":")[0] : value, "");
      let exit: (code: number | null) => void = () => {};
      const child: IdeChild = {
        pid: ++pid,
        exited: new Promise((resolve) => {
          exit = resolve;
        }),
        kill: () => {
          killed.push(child.pid);
          exit(0);
        },
      };
      return child;
    },
  });
  const environment: IdeDetectEnvironment = {
    platform: "linux",
    which: () => null,
    exists: () => true,
    realpath: (path) => path,
    isExecutableFile: (path) => path === PROGRAM || path === VSCODE,
    version,
    homeDir: "",
  };
  const service = new IdeService({
    settings: memoryIdeSettingsStore({
      version: 1,
      providers: {
        "code-server": { enabled: true, trusted_at: "x", binary: PROGRAM },
        vscode: {
          enabled: true,
          trusted_at: "x",
          terms_accepted_at: "x",
          binary: VSCODE,
        },
      },
    }),
    environment,
    connection: (id) => (connection?.id === id ? connection : null),
    connectionIds: () => (connection ? [connection.id] : []),
    instances,
    remoteDetect,
  });
  const revoked: string[] = [];
  service.onRevoked((id) => revoked.push(id));
  const open = async () => {
    const result = await service.open({
      provider: "code-server",
      connectionId: "local-a",
      generation: connection?.generation,
      folder: project,
    });
    if (!result.ok) throw new Error(result.refusal.message);
    // The fake answers at once; wait for the readiness loop to see it.
    for (let i = 0; i < 50 && !service.upstream(result.instance.id); i++)
      await Bun.sleep(1);
    expect(service.upstream(result.instance.id)).not.toBeNull();
    return result.instance;
  };
  return {
    service,
    project,
    open,
    revoked,
    killed,
    launches,
    spawned: () => spawned,
    set(next: IdeConnection | null) {
      connection = next;
    },
  };
}

test("a reconnect ends the IDE opened under the old generation", async () => {
  const h = harness();
  const instance = await h.open();
  expect(instance.generation).toBe(1);
  h.set({
    id: "local-a",
    label: "This computer",
    type: "local",
    generation: 2,
  });
  // The route alone refuses, before World hears of the change.
  expect(h.service.upstream(instance.id)).toBeNull();
  await Bun.sleep(1);
  expect(h.revoked).toEqual([instance.id]);
  expect(h.killed).toHaveLength(1);
  expect(h.service.instances.list()).toEqual([]);
  // Reopening admits a new server under the new generation.
  const again = await h.open();
  expect(again.id).not.toBe(instance.id);
  expect(again.generation).toBe(2);
});

test("a connection change while detection is pending starts no server", async () => {
  let detected!: (value: string) => void;
  const h = harness(
    () =>
      new Promise((resolve) => {
        detected = resolve;
      }),
  );
  const opening = h.service.open({
    provider: "code-server",
    connectionId: "local-a",
    generation: 1,
    folder: h.project,
  });
  for (let i = 0; i < 50 && !detected; i++) await Bun.sleep(1);
  h.set({
    id: "local-a",
    label: "devbox",
    type: "ssh",
    generation: 2,
    sshDestination: "devbox.example",
  });
  await h.service.retireStale();
  detected("4.0.0");
  const result = await opening;
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.refusal.code).toBe("stale");
  expect(h.spawned()).toBe(0);
  expect(h.service.instances.list()).toEqual([]);
});

test("a change to SSH or removal revokes the server and its streams", async () => {
  const h = harness();
  const first = await h.open();
  h.set({
    id: "local-a",
    label: "devbox",
    type: "ssh",
    generation: 1,
    sshDestination: "devbox.example",
  });
  // World calls this on every connection change; streams close at once.
  await h.service.retireStale();
  expect(h.revoked).toEqual([first.id]);
  expect(h.service.upstream(first.id)).toBeNull();

  h.set({
    id: "local-a",
    label: "This computer",
    type: "local",
    generation: 1,
  });
  const second = await h.open();
  h.set(null);
  await h.service.retireStale();
  expect(h.revoked).toEqual([first.id, second.id]);
  expect(h.service.instances.list()).toEqual([]);
});

test("stock VS Code runs serve-web on World's computer and is embedded", async () => {
  const h = harness();
  const result = await h.service.open({
    provider: "vscode",
    connectionId: "local-a",
    generation: 1,
    folder: h.project,
  });
  expect(result.ok).toBe(true);
  expect(h.launches[0].command.slice(0, 2)).toEqual([VSCODE, "serve-web"]);
  if (result.ok)
    expect(result.instance.url).toBe(`/ide/${result.instance.id}/`);
});

const SSH_CONNECTION: IdeConnection = {
  id: "ssh-b",
  label: "devbox",
  type: "ssh",
  generation: 4,
  sshDestination: "dev@devbox.example",
};

test("an SSH project runs the host's own VS Code through an OpenSSH socket forward", async () => {
  const asked: string[] = [];
  const h = harness(undefined, async (destination, provider) => {
    asked.push(`${destination} ${provider}`);
    return {
      provider,
      state: "detected",
      path: "/home/dev/.local/bin/code",
      version: "1.147.0",
      configured: false,
    };
  });
  h.set(SSH_CONNECTION);
  const result = await h.service.open({
    provider: "vscode",
    connectionId: "ssh-b",
    generation: 4,
    // A folder on the host: World's computer does not have it.
    folder: "/srv/example/project",
  });
  if (!result.ok) throw new Error(result.refusal.message);
  expect(asked).toEqual(["dev@devbox.example vscode"]);
  const launch = h.launches[0];
  expect(launch.command[0]).toBe("ssh");
  const forward = launch.command[launch.command.indexOf("-L") + 1];
  expect(forward).toMatch(
    /\/ide\.sock:\/tmp\/hw-ide-[A-Za-z0-9_-]{16,}\/ide\.sock$/,
  );
  expect(launch.command).toContain("dev@devbox.example");
  // The token goes on stdin, never on a command line.
  expect(launch.stdin).toMatch(/^[A-Za-z0-9_-]{20,}\n$/);
  expect(launch.command.join(" ")).not.toContain(launch.stdin?.trim() ?? "");
  expect(result.instance.sshDestination).toBe("dev@devbox.example");
  for (let i = 0; i < 50 && !h.service.upstream(result.instance.id); i++)
    await Bun.sleep(1);
  expect(h.service.upstream(result.instance.id)).not.toBeNull();

  // The same connection now pointing at another host: the old IDE ends.
  h.set({ ...SSH_CONNECTION, sshDestination: "dev@other.example" });
  expect(h.service.upstream(result.instance.id)).toBeNull();
  await h.service.retireStale();
  expect(h.revoked).toEqual([result.instance.id]);
});

test("an SSH host without the IDE is refused with the host's name", async () => {
  const h = harness(undefined, async (_destination, provider, hostLabel) => ({
    provider,
    state: "missing",
    reason: `Visual Studio Code isn't installed on ${hostLabel}.`,
    configured: false,
  }));
  h.set(SSH_CONNECTION);
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
  expect(h.spawned()).toBe(0);
});
