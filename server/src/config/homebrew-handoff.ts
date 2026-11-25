import { spawn, spawnSync } from "node:child_process";
import {
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  resolveServicePaths,
  resolveServicePlatform,
} from "./service-definitions";
import { ownsHomebrewService } from "./service-executable";

// Homebrew runs a formula's post-install steps in a sandbox that cannot read
// the home folder, so `update --finish-install` cannot read or rewrite the
// service definition there. It can still write this formula's Cellar rack,
// list processes and signal them. The handoff below uses only those, and the
// restarted World (outside the sandbox) moves its own definition to opt.

export interface HomebrewKeg {
  /** Homebrew prefix, e.g. /opt/homebrew. */
  prefix: string;
  /** Formula name: herdr-world or herdr-world-rc. */
  name: string;
  /** This keg's version directory name. */
  version: string;
  /** Executable path inside a keg, e.g. libexec/herdr-world. */
  relative: string;
}

export function homebrewKeg(executable: string): HomebrewKeg | null {
  const keg = /^(.*)\/Cellar\/(herdr-world(?:-rc)?)\/([^/]+)\/(.+)$/.exec(
    resolve(executable),
  );
  if (!keg) return null;
  return {
    prefix: keg[1]!,
    name: keg[2]!,
    version: keg[3]!,
    relative: keg[4]!,
  };
}

function homebrewOptExecutable(keg: HomebrewKeg): string {
  return `${keg.prefix}/opt/${keg.name}/${keg.relative}`;
}

function rack(keg: HomebrewKeg): string {
  return `${keg.prefix}/Cellar/${keg.name}`;
}

/**
 * A service definition written by an older World may name an older keg's
 * executable. Point every older keg's executable at opt, so the service
 * manager starts the new World from that path until the new World moves its
 * definition to opt. Old kegs are removed by `brew cleanup` later.
 */
/** @internal */
export function bridgeOlderKegs(keg: HomebrewKeg): string[] {
  const stable = homebrewOptExecutable(keg);
  const bridged: string[] = [];
  let versions: string[];
  try {
    versions = readdirSync(rack(keg));
  } catch {
    return bridged;
  }
  for (const version of versions) {
    if (version === keg.version) continue;
    const executable = join(rack(keg), version, keg.relative);
    try {
      const stat = lstatSync(executable);
      if (stat.isSymbolicLink() && readlinkSync(executable) === stable)
        continue;
      if (!stat.isFile() && !stat.isSymbolicLink()) continue;
    } catch {
      continue;
    }
    // Replace atomically: the running old process keeps its open inode.
    const temporary = `${executable}.world-handoff-${process.pid}`;
    try {
      rmSync(temporary, { force: true });
      symlinkSync(stable, temporary);
      renameSync(temporary, executable);
      bridged.push(executable);
    } catch {
      rmSync(temporary, { force: true });
    }
  }
  return bridged;
}

/** @internal */
export interface WorldProcess {
  pid: number;
  /** The path the process was started with (argv[0]). */
  command: string;
  /** Started directly by the World service manager (its main process). */
  managed: boolean;
}

/** Linux: the main process of the herdr-world.service user unit. */
/** @internal */
export function listLinuxProcesses(procRoot = "/proc"): WorldProcess[] {
  const entries: {
    pid: number;
    ppid: number;
    unit: boolean;
    command: string;
  }[] = [];
  let names: string[];
  try {
    names = readdirSync(procRoot);
  } catch {
    return [];
  }
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const cgroup = readFileSync(join(procRoot, name, "cgroup"), "utf8");
      const stat = readFileSync(join(procRoot, name, "stat"), "utf8");
      // The command name may hold spaces and parentheses; ppid follows the last ")".
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      const command =
        readFileSync(join(procRoot, name, "cmdline"), "utf8").split("\0")[0] ??
        "";
      entries.push({
        pid: Number(name),
        ppid,
        unit: /\/herdr-world\.service$/m.test(cgroup),
        command,
      });
    } catch {
      /* The process exited while listing. */
    }
  }
  const inUnit = new Set(entries.filter((e) => e.unit).map((e) => e.pid));
  return entries.map((entry) => ({
    pid: entry.pid,
    command: entry.command,
    managed: entry.unit && !inUnit.has(entry.ppid),
  }));
}

/** macOS: launchd (pid 1) starts the dev.herdr-world agent's process. */
function listDarwinProcesses(): WorldProcess[] {
  // /bin/ps is the one process Homebrew's macOS sandbox lets us run unsandboxed.
  const result = spawnSync("/bin/ps", ["-axww", "-o", "pid=,ppid=,command="], {
    encoding: "utf8",
  });
  if (result.status !== 0) return [];
  return parseDarwinProcesses(result.stdout);
}

/** @internal */
export function parseDarwinProcesses(output: string): WorldProcess[] {
  return output.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) return [];
    return [
      {
        pid: Number(match[1]),
        command: match[3]!,
        managed: match[2] === "1",
      },
    ];
  });
}

export interface HandoffDeps {
  listProcesses: () => WorldProcess[];
  signal: (pid: number) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  selfPid: number;
  log: (message: string) => void;
}

export function systemHandoffDeps(
  platform: string,
  log: (message: string) => void,
): HandoffDeps {
  return {
    listProcesses:
      platform === "linux" ? () => listLinuxProcesses() : listDarwinProcesses,
    signal: (pid) => process.kill(pid, "SIGTERM"),
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    now: () => Date.now(),
    selfPid: process.pid,
    log,
  };
}

function serviceProcess(
  keg: HomebrewKeg,
  deps: HandoffDeps,
): WorldProcess | undefined {
  const roots = [`${rack(keg)}/`, `${keg.prefix}/opt/${keg.name}/`];
  return deps
    .listProcesses()
    .find(
      (entry) =>
        entry.managed &&
        entry.pid !== deps.selfPid &&
        roots.some((root) => entry.command.startsWith(root)),
    );
}

/** Long enough for a restart, a definition move and a second restart. */
const HANDOFF_TIMEOUT_MS = 120_000;

/**
 * Restart this formula's running World service on the newly linked keg.
 * Waits until the service runs from opt, so `brew cleanup` cannot remove the
 * old keg before the service has moved off it.
 */
export async function handOffHomebrewService(
  keg: HomebrewKeg,
  deps: HandoffDeps,
  timeoutMs = HANDOFF_TIMEOUT_MS,
): Promise<"restarted" | "none" | "timeout"> {
  bridgeOlderKegs(keg);
  const running = serviceProcess(keg, deps);
  if (!running) return "none";
  deps.log(`Restarting the World service (process ${running.pid}).`);
  try {
    deps.signal(running.pid);
  } catch (error) {
    deps.log(
      `The service was not restarted: ${(error as Error).message}. Run \`herdr-world service install\`.`,
    );
    return "timeout";
  }
  const stable = `${keg.prefix}/opt/${keg.name}/`;
  const deadline = deps.now() + timeoutMs;
  while (deps.now() < deadline) {
    await deps.sleep(500);
    const next = serviceProcess(keg, deps);
    if (next && next.pid !== running.pid && next.command.startsWith(stable))
      return "restarted";
  }
  deps.log(
    "The World service did not come back on the new version in time; run `herdr-world service install`.",
  );
  return "timeout";
}

/**
 * At service startup: a definition written by an older World names a
 * versioned keg, which `brew cleanup` removes. Re-register it with opt.
 * `service install` restarts the service, ending this process; it runs in
 * its own session so a launchd bootout of this job does not end it.
 * Returns the install exit code, or null when nothing needed to move.
 */
export async function movePinnedHomebrewService(options: {
  execPath: string;
  platform: string;
  homeDir: string;
  supervised: boolean;
  log: (message: string) => void;
  install?: (execPath: string) => Promise<number>;
}): Promise<number | null> {
  if (!options.supervised) return null;
  let executable: string;
  try {
    executable = realpathSync(options.execPath);
  } catch {
    return null;
  }
  const keg = homebrewKeg(executable);
  if (!keg) return null;
  let definition: string;
  try {
    const platform = resolveServicePlatform(options.platform);
    if (platform === "windows-task") return null;
    definition = readFileSync(
      resolveServicePaths(platform, options.homeDir).definition,
      "utf8",
    );
  } catch {
    return null;
  }
  if (
    !ownsHomebrewService(executable, definition) ||
    definition.includes(homebrewOptExecutable(keg))
  )
    return null;
  options.log(
    "The service names an older Homebrew keg; moving it to the stable opt path.",
  );
  const install =
    options.install ??
    ((path: string) =>
      new Promise<number>((done) => {
        const child = spawn(path, ["service", "install"], {
          detached: true,
          stdio: "inherit",
        });
        child.on("error", () => done(1));
        child.on("exit", (code) => done(code ?? 1));
      }));
  return install(executable);
}
