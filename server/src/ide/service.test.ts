import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type IdeChild, IdeInstances } from "./instances";
import type { IdeDetectEnvironment } from "./providers";
import { type IdeConnection, IdeService } from "./service";
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

function harness() {
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
  let pid = 100;
  const instances = new IdeInstances({
    runtimeRoot: top,
    sleep: async () => {},
    probe: async () => 200,
    spawn: ({ command }) => {
      // code-server's `--socket <path>`: the fake server is the file.
      writeFileSync(command[command.indexOf("--socket") + 1], "");
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
    isExecutableFile: (path) => path === PROGRAM,
    version: async () => "4.0.0",
    homeDir: "",
  };
  const service = new IdeService({
    settings: memoryIdeSettingsStore({
      version: 1,
      providers: {
        "code-server": { enabled: true, trusted_at: "x", binary: PROGRAM },
      },
    }),
    environment,
    connection: (id) => (connection?.id === id ? connection : null),
    connectionIds: () => (connection ? [connection.id] : []),
    instances,
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
    open,
    revoked,
    killed,
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

test("stock VS Code is refused with a desktop handoff, never started", async () => {
  const h = harness();
  const result = await h.service.open({
    provider: "vscode",
    connectionId: "local-a",
    generation: 1,
    folder: "/",
  });
  expect(result).toMatchObject({
    ok: false,
    refusal: {
      code: "origin",
      handoff: { command: "code '/'", url: "vscode://file/" },
    },
  });
  expect(h.killed).toEqual([]);
  expect(h.service.instances.list()).toEqual([]);
});
