import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type IdeChild, IdeInstances, systemIdeSpawn } from "./instances";
import { ownedProcesses, parseProcessRows } from "./process-tree";
import {
  type ProcessTreeStandIn,
  processTreeStandIn,
} from "./testing/process-tree-stand-in";

const dirs: string[] = [];
const standIns: ProcessTreeStandIn[] = [];
afterEach(() => {
  for (const standIn of standIns.splice(0)) standIn.cleanup();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

test("the owned set follows the group and descendants, never World or its parents", () => {
  const rows = parseProcessRows(
    [
      "  1     0     1 Ss",
      " 10     1    10 S",
      " 20    10    20 S", // World
      " 30    20    30 Ss", // the IDE, its own group
      " 31    30    30 S", // its server
      " 32    31    32 Ss", // a terminal shell, its own session
      " 33     1    30 S", // re-parented, still in the group
      " 34    31    30 Z", // exited, not yet reaped
      " 40     1    40 S", // unrelated
    ].join("\n"),
  );
  expect(ownedProcesses(rows, [30], 30, 20)).toEqual([30, 31, 32, 33]);
  // A shell seen before its parent exited stays owned.
  expect(ownedProcesses(rows, [32], undefined, 20)).toEqual([32]);
  // Never World or anything above it, even when named.
  expect(ownedProcesses(rows, [10], 10, 20)).toEqual([30, 31, 32]);
});

test("Stop ends the local server's whole process tree, escalating to SIGKILL", async () => {
  const top = mkdtempSync(join(tmpdir(), "hw-ide-instances-"));
  dirs.push(top);
  const folder = join(top, "project");
  mkdirSync(folder);
  const standIn = processTreeStandIn(top);
  standIns.push(standIn);
  const instances = new IdeInstances({
    runtimeRoot: top,
    spawn: systemIdeSpawn({ PATH: "/usr/bin:/bin", HOME: top }),
    probe: async () => 200,
  });
  const { instance, ready } = instances.open({
    provider: "code-server",
    binary: standIn.launcher,
    connectionId: "local",
    generation: 1,
    folder,
  });
  expect((await ready).state).toBe("ready");
  const pids = await standIn.started();
  expect(standIn.survivors()).toHaveLength(3);
  expect(Object.values(pids)).not.toContain(process.pid);

  // The launcher ends on SIGTERM; its server and the shell ignore it.
  expect(await instances.stop(instance.id)).toBe(true);
  expect(standIn.survivors()).toEqual([]);
  expect(instances.list()).toEqual([]);
}, 15_000);

test("Stop over SSH ends input first and lets the host clean up before signalling ssh", async () => {
  const top = mkdtempSync(join(tmpdir(), "hw-ide-instances-"));
  dirs.push(top);
  const events: string[] = [];
  const instances = new IdeInstances({
    runtimeRoot: top,
    sleep: async () => {},
    probe: async () => 200,
    spawn: ({ command }) => {
      writeFileSync(command[command.indexOf("-L") + 1].split(":")[0], "");
      let exit: (code: number | null) => void = () => {};
      const child: IdeChild = {
        pid: 4242,
        exited: new Promise((resolve) => {
          exit = resolve;
        }),
        kill: (signal) => {
          events.push(signal);
          exit(null);
        },
        endInput: () => {
          events.push("end of input");
          // The host stops its tree, then the session ends.
          setTimeout(() => exit(143), 50);
        },
      };
      return child;
    },
  });
  const { instance, ready } = instances.open({
    provider: "vscode",
    binary: "/opt/code/bin/code",
    connectionId: "devbox",
    generation: 1,
    folder: "/srv/project",
    ssh: { destination: "dev@devbox.example", hostLabel: "devbox" },
  });
  expect((await ready).state).toBe("ready");
  expect(await instances.stop(instance.id)).toBe(true);
  expect(events).toEqual(["end of input"]);
});
