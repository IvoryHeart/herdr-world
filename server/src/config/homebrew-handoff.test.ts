import { afterEach, expect, test } from "bun:test";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createTestCli } from "../cli/test-context";
import { finishUpdate } from "../cli/update-finish";
import {
  bridgeOlderKegs,
  type HandoffDeps,
  handOffHomebrewService,
  homebrewKeg,
  listLinuxProcesses,
  movePinnedHomebrewService,
  parseDarwinProcesses,
  type WorldProcess,
} from "./homebrew-handoff";
import {
  renderLaunchdService,
  renderSystemdService,
  resolveServicePaths,
} from "./service-definitions";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/** A Homebrew prefix with 0.3.7 and 0.3.8 kegs; opt selects 0.3.8. */
function brew() {
  const root = mkdtempSync(join(tmpdir(), "world-brew-handoff-"));
  roots.push(root);
  const prefix = join(root, "brew");
  const old = join(prefix, "Cellar/herdr-world/0.3.7/libexec/herdr-world");
  const current = join(prefix, "Cellar/herdr-world/0.3.8/libexec/herdr-world");
  const opt = join(prefix, "opt/herdr-world/libexec/herdr-world");
  for (const [path, body] of [
    [old, "old"],
    [current, "new"],
  ] as const) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body, { mode: 0o755 });
  }
  mkdirSync(join(prefix, "opt"), { recursive: true });
  symlinkSync(
    join(prefix, "Cellar/herdr-world/0.3.8"),
    join(prefix, "opt/herdr-world"),
  );
  return { root, prefix, old, current, opt, keg: homebrewKeg(current)! };
}

function fakeDeps(sequence: WorldProcess[][], selfPid = 1) {
  const signalled: number[] = [];
  const logs: string[] = [];
  let clock = 0;
  let step = 0;
  const deps: HandoffDeps = {
    listProcesses: () => sequence[Math.min(step, sequence.length - 1)] ?? [],
    signal: (pid) => {
      signalled.push(pid);
    },
    sleep: async (ms) => {
      clock += ms;
      step += 1;
    },
    now: () => clock,
    selfPid,
    log: (message) => logs.push(message),
  };
  return { deps, signalled, logs };
}

test("an older keg's executable runs the opt World until cleanup", () => {
  if (process.platform === "win32") return;
  const { old, current, opt, keg } = brew();
  expect(bridgeOlderKegs(keg)).toEqual([old]);
  expect(lstatSync(old).isSymbolicLink()).toBe(true);
  expect(readFileSync(old, "utf8")).toBe("new");
  expect(lstatSync(current).isSymbolicLink()).toBe(false);
  // Idempotent, and a foreign rack is never touched.
  expect(bridgeOlderKegs(keg)).toEqual([]);
  expect(homebrewKeg("/usr/local/bin/herdr-world")).toBeNull();
  expect(homebrewKeg(opt)).toBeNull();
});

test("the handoff restarts only the managed service and waits for opt", async () => {
  if (process.platform === "win32") return;
  const { prefix, old, opt, keg } = brew();
  const other = join(prefix, "Cellar/other/1.0/bin/other");
  const { deps, signalled } = fakeDeps(
    [
      [
        { pid: 40, command: old, managed: false }, // a terminal World
        { pid: 41, command: other, managed: true },
        { pid: 42, command: old, managed: true },
      ],
      // Restarted from the bridged old path, then moved to opt.
      [{ pid: 43, command: old, managed: true }],
      [{ pid: 44, command: opt, managed: true }],
    ],
    7,
  );
  expect(await handOffHomebrewService(keg, deps)).toBe("restarted");
  expect(signalled).toEqual([42]);
});

test("the handoff reports no service and times out without a restart", async () => {
  if (process.platform === "win32") return;
  const { old, keg } = brew();
  const none = fakeDeps([[{ pid: 5, command: old, managed: false }]]);
  expect(await handOffHomebrewService(keg, none.deps)).toBe("none");
  expect(none.signalled).toEqual([]);
  const stuck = fakeDeps([[{ pid: 6, command: old, managed: true }]]);
  expect(await handOffHomebrewService(keg, stuck.deps, 2_000)).toBe("timeout");
  expect(stuck.signalled).toEqual([6]);
  expect(stuck.logs.join("\n")).toContain("herdr-world service install");
});

test("Linux finds the unit's main process; macOS finds launchd's", () => {
  const proc = mkdtempSync(join(tmpdir(), "world-proc-"));
  roots.push(proc);
  const unit = "0::/user.slice/app.slice/herdr-world.service\n";
  for (const [pid, ppid, cgroup, argv0] of [
    [100, 90, unit, "/brew/opt/herdr-world/libexec/herdr-world"],
    [101, 100, unit, "/usr/local/bin/herdr-core"],
    [
      102,
      80,
      "0::/user.slice/session-2.scope\n",
      "/brew/opt/herdr-world/libexec/herdr-world",
    ],
  ] as const) {
    mkdirSync(join(proc, String(pid)));
    writeFileSync(join(proc, String(pid), "cgroup"), cgroup);
    writeFileSync(
      join(proc, String(pid), "stat"),
      `${pid} (herdr world) S ${ppid} 1 1 0`,
    );
    writeFileSync(join(proc, String(pid), "cmdline"), `${argv0}\0`);
  }
  mkdirSync(join(proc, "self"));
  expect(listLinuxProcesses(proc).sort((a, b) => a.pid - b.pid)).toEqual([
    {
      pid: 100,
      command: "/brew/opt/herdr-world/libexec/herdr-world",
      managed: true,
    },
    { pid: 101, command: "/usr/local/bin/herdr-core", managed: false },
    {
      pid: 102,
      command: "/brew/opt/herdr-world/libexec/herdr-world",
      managed: false,
    },
  ]);
  const job = "/opt/homebrew/opt/herdr-world/libexec/herdr-world";
  const keg = "/opt/homebrew/Cellar/herdr-world/0.3.7/libexec/herdr-world";
  const darwin = parseDarwinProcesses(
    [
      "  1     0 /sbin/launchd",
      // The generated launchd job: launchd sets XPC_SERVICE_NAME to its label.
      ` 512     1 ${job} PATH=/usr/bin XPC_SERVICE_NAME=dev.herdr-world`,
      // A terminal World still attached to its shell.
      ` 600   555 ${keg} XPC_SERVICE_NAME=0`,
      // A nohup'd terminal World reparented to launchd after its shell exited.
      ` 612     1 ${keg} XPC_SERVICE_NAME=application.example.Terminal`,
      // Another launchd job whose label only starts with World's.
      ` 613     1 ${keg} XPC_SERVICE_NAME=dev.herdr-world.other`,
      // A launchd process whose environment ps could not read.
      ` 614     1 ${keg}`,
    ].join("\n"),
  );
  expect(darwin.map(({ pid, managed }) => [pid, managed])).toEqual([
    [1, false],
    [512, true],
    [600, false],
    [612, false],
    [613, false],
    [614, false],
  ]);
  expect(darwin[1]!.command.startsWith(job)).toBe(true);
});

test("the handoff never signals a terminal World reparented to launchd", async () => {
  // A prefix that does not exist, so bridging older kegs touches nothing.
  const keg = "/synthetic-brew/Cellar/herdr-world/0.3.7/libexec/herdr-world";
  const processes = parseDarwinProcesses(
    ` 612     1 ${keg} XPC_SERVICE_NAME=application.example.Terminal\n`,
  );
  const signalled: number[] = [];
  const result = await handOffHomebrewService(
    homebrewKeg(
      "/synthetic-brew/Cellar/herdr-world/0.3.8/libexec/herdr-world",
    )!,
    {
      listProcesses: () => processes,
      signal: (pid) => signalled.push(pid),
      sleep: async () => {},
      now: () => 0,
      selfPid: 999,
      log: () => {},
    },
  );
  expect(result).toBe("none");
  expect(signalled).toEqual([]);
});

test("a supervised World moves a keg-pinned definition to opt before it listens", async () => {
  if (process.platform === "win32") return;
  for (const platform of ["linux", "darwin"]) {
    const { root, old, current, opt } = brew();
    const paths = resolveServicePaths(
      platform === "linux" ? "systemd" : "launchd",
      root,
    );
    mkdirSync(dirname(paths.definition), { recursive: true });
    const render = (path: string) =>
      platform === "linux"
        ? renderSystemdService(path, paths.config)
        : renderLaunchdService(path, paths);
    writeFileSync(paths.definition, render(old));
    const installs: string[] = [];
    const move = (supervised: boolean, execPath = old) =>
      movePinnedHomebrewService({
        execPath,
        platform,
        homeDir: root,
        supervised,
        log: () => {},
        install: async (path) => {
          installs.push(path);
          return 0;
        },
      });
    expect(await move(false)).toBeNull();
    // Started through the bridged old path, it is the new keg's World.
    bridgeOlderKegs(homebrewKeg(current)!);
    expect(await move(true)).toBe(0);
    expect(installs).toEqual([current]);
    writeFileSync(paths.definition, render(opt));
    expect(await move(true)).toBeNull();
    writeFileSync(paths.definition, render("/usr/local/bin/herdr-world"));
    expect(await move(true)).toBeNull();
    expect(installs).toHaveLength(1);
  }
});

test("finish-install in Homebrew's sandbox hands off when it cannot see the definition", async () => {
  if (process.platform === "win32") return;
  const { old, current, opt, keg } = brew();
  const cli = createTestCli({ runtime: { platform: "linux" } });
  try {
    cli.context.runtime.execPath = current;
    const { deps, signalled } = fakeDeps([
      [{ pid: 30, command: old, managed: true }],
      [{ pid: 31, command: opt, managed: true }],
    ]);
    const runProcess = async () => ({ code: 0, stdout: "", stderr: "" });
    expect(await finishUpdate(cli.context, runProcess, true, deps)).toBe(0);
    expect(signalled).toEqual([30]);
    expect(cli.output).toContain("Restarted the service.");
    expect(readFileSync(old, "utf8")).toBe("new");
    expect(keg.version).toBe("0.3.8");
  } finally {
    cli.cleanup();
  }
});
