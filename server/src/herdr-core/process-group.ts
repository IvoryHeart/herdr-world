import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { readsTerminal } from "../adapters/terminal-readers";
import type { ProcFs } from "../world/caller-identity";

/**
 * The other processes in a terminal's foreground process group, read on the
 * host for a core on this machine. Core 0.1.21 reports only the group's
 * leader (`foreground`), so an agent run by a wrapper (`bash run.sh` running
 * `claude -p … | tee log` with job control off) is a member World cannot see
 * from core's record. Herdr's TUI already looks through the whole job
 * (`identify_agent_process_in_job`); core reporting the group's processes is
 * an upstream ask, after which this read is no longer needed.
 *
 * Linux only (`/proc`); elsewhere, or when the leader cannot be read, the
 * answer is null: unknown, never "no agent".
 */
export type ForegroundGroupReader = (
  leader: number,
  command?: string,
  input?: { argv?: string[] },
) => string[][] | null;

const realProc: ProcFs = {
  read: (path) => readFileSync(path, "utf8"),
  list: (path) => readdirSync(path),
  link: (path) => readlinkSync(path),
};

/** At most this many members are read: a wrapper's group is a few processes. */
const MAX_MEMBERS = 64;

function groupOf(fs: ProcFs, pid: number): number | null {
  try {
    const stat = fs.read(`/proc/${pid}/stat`);
    // The command name may hold spaces and parentheses: fields follow the last ")".
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const group = Number(fields[2]);
    return Number.isSafeInteger(group) ? group : null;
  } catch {
    return null;
  }
}

function argvOf(fs: ProcFs, pid: number): string[] {
  try {
    return fs.read(`/proc/${pid}/cmdline`).split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

function childrenOf(fs: ProcFs, pid: number): number[] | null {
  let tasks: string[];
  try {
    tasks = fs.list(`/proc/${pid}/task`);
  } catch {
    return null;
  }
  const children: number[] = [];
  for (const task of tasks)
    try {
      for (const child of fs
        .read(`/proc/${pid}/task/${task}/children`)
        .trim()
        .split(/\s+/))
        if (/^\d+$/.test(child)) children.push(Number(child));
    } catch {
      // The thread ended meanwhile.
    }
  return children;
}

/**
 * The leader's descendants still in its process group, nearest first, as
 * argv lists. Null when `leader` is not a readable group leader, or when it
 * does not run `command` (core's argv[0]): then the pid is not the one core
 * meant (another pid namespace, or the leader already ended). In input mode,
 * include a leader slot first (empty when its stdin is elsewhere), then members whose
 * stdin is that terminal's PTY, including pipeline siblings. Discovery keeps
 * its existing descendant walk for harness identification.
 */
export function readForegroundGroup(
  leader: number,
  command?: string,
  fs: ProcFs = realProc,
  inputReadersOnly = false,
): string[][] | null {
  if (!Number.isSafeInteger(leader) || leader <= 1) return null;
  if (groupOf(fs, leader) !== leader) return null;
  if (command !== undefined && argvOf(fs, leader)[0] !== command) return null;
  if (inputReadersOnly) {
    try {
      const leaderArgv = argvOf(fs, leader);
      if (!leaderArgv.length) return null;
      const leaderReads = readsTerminal(fs, leader, leader);
      const pids = fs.list("/proc").filter((pid) => /^\d+$/.test(pid));
      if (pids.length > 8192) return null;
      const readers = [leaderReads ? leaderArgv : []];
      // Pipeline members can be siblings of the leader, not its descendants.
      for (const text of pids) {
        const pid = Number(text);
        if (pid === leader || groupOf(fs, pid) !== leader) continue;
        if (readsTerminal(fs, pid, leader)) readers.push(argvOf(fs, pid));
        if (readers.length > MAX_MEMBERS) return null;
      }
      return readers;
    } catch {
      return null;
    }
  }
  const members: string[][] = [];
  const seen = new Set<number>([leader]);
  const queue = [leader];
  while (queue.length && members.length < MAX_MEMBERS) {
    const children = childrenOf(fs, queue.shift()!);
    if (!children) {
      if (members.length === 0 && seen.size === 1) return null;
      continue;
    }
    for (const child of children) {
      if (seen.has(child) || members.length >= MAX_MEMBERS) continue;
      seen.add(child);
      if (groupOf(fs, child) !== leader) continue;
      members.push(argvOf(fs, child));
      queue.push(child);
    }
  }
  return members;
}

/** The host-side reader for a local core, or none where it cannot work. */
export function localForegroundGroups(
  platform: NodeJS.Platform = process.platform,
): ForegroundGroupReader | undefined {
  return platform === "linux"
    ? (leader, command, input) =>
        readForegroundGroup(leader, command, realProc, Boolean(input))
    : undefined;
}
