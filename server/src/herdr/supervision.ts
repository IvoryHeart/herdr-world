import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { runProcessWithCodeTimeout } from "../utils/process-utils";

/**
 * Whether a live handoff can keep the panes of the Herdr server listening on
 * a socket. Herdr's handoff starts the new server as a detached child of the
 * old one and then lets the old process exit
 * (https://github.com/herdrdev/herdr/blob/v0.9.5/src/server/handoff.rs). A
 * supervisor that owns the old process treats that exit as the end of its
 * service: systemd's default KillMode=control-group then kills the child and
 * every pane, and launchd's KeepAlive starts a competing server. Only a
 * server proven to be outside any supervisor is "unsupervised"; anything
 * that cannot be identified is "unknown" and must be restarted instead.
 */
export type ServerSupervision = "unsupervised" | "supervised" | "unknown";

type Run = typeof runProcessWithCodeTimeout;

export interface SupervisionDeps {
  platform?: string;
  /** Linux: the procfs mount, replaced in tests. */
  procRoot?: string;
  /** macOS: runs lsof and launchctl. */
  run?: Run;
}

const SOCKET_LISTENING_FLAG = 0x10000; // __SO_ACCEPTCON in /proc/net/unix

/** Inodes of listening Unix sockets bound to socketPath. */
export function listeningSocketInodes(netUnix: string, socketPath: string) {
  const inodes = new Set<string>();
  for (const line of netUnix.split("\n").slice(1)) {
    const fields = line.trim().split(/\s+/);
    // Num RefCount Protocol Flags Type St Inode Path
    if (fields.length < 8 || fields.slice(7).join(" ") !== socketPath) continue;
    if (Number.parseInt(fields[3], 16) & SOCKET_LISTENING_FLAG)
      inodes.add(fields[6]);
  }
  return inodes;
}

/** The last segment of a process's cgroup v2 path, or null without one. */
export function cgroupLeaf(cgroup: string): string | null {
  const unified = cgroup
    .split("\n")
    .find((line) => line.startsWith("0::"))
    ?.slice(3)
    .trim();
  if (!unified || unified === "/") return null;
  return unified.split("/").at(-1) ?? null;
}

function linuxServerPids(socketPath: string, procRoot: string): string[] {
  const inodes = listeningSocketInodes(
    readFileSync(join(procRoot, "net", "unix"), "utf8"),
    socketPath,
  );
  if (!inodes.size) return [];
  const pids: string[] = [];
  for (const pid of readdirSync(procRoot)) {
    if (!/^\d+$/.test(pid)) continue;
    let fds: string[];
    try {
      fds = readdirSync(join(procRoot, pid, "fd"));
    } catch {
      continue; // Another user's process, or it exited.
    }
    for (const fd of fds) {
      let target: string;
      try {
        target = readlinkSync(join(procRoot, pid, "fd", fd));
      } catch {
        continue;
      }
      const inode = /^socket:\[(\d+)\]$/.exec(target)?.[1];
      if (inode && inodes.has(inode)) {
        pids.push(pid);
        break;
      }
    }
  }
  return pids;
}

async function macosSupervision(
  socketPath: string,
  run: Run,
): Promise<ServerSupervision> {
  const holders = await run(["lsof", "-t", "--", socketPath], 10_000);
  const pids = [
    ...new Set(holders.stdout.split("\n").map((pid) => pid.trim())),
  ].filter((pid) => /^\d+$/.test(pid));
  if (holders.code !== 0 || pids.length !== 1) return "unknown";
  // The user's launchd jobs, as "PID Status Label"; a daemonized server that
  // launchd merely adopted is not listed.
  const jobs = await run(["launchctl", "list"], 10_000);
  if (jobs.code !== 0) return "unknown";
  const supervised = jobs.stdout
    .split("\n")
    .some((line) => line.trim().split(/\s+/)[0] === pids[0]);
  return supervised ? "supervised" : "unsupervised";
}

export async function detectServerSupervision(
  socketPath: string,
  deps: SupervisionDeps = {},
): Promise<ServerSupervision> {
  const platform = deps.platform ?? process.platform;
  try {
    if (platform === "darwin") {
      return await macosSupervision(
        socketPath,
        deps.run ?? runProcessWithCodeTimeout,
      );
    }
    if (platform !== "linux") return "unknown";
    const procRoot = deps.procRoot ?? "/proc";
    const pids = linuxServerPids(socketPath, procRoot);
    if (pids.length !== 1) return "unknown";
    const leaf = cgroupLeaf(
      readFileSync(join(procRoot, pids[0], "cgroup"), "utf8"),
    );
    // A scope (a terminal, a login session) has no main process to lose;
    // a service's main process exit stops the service and its cgroup.
    if (leaf?.endsWith(".scope")) return "unsupervised";
    if (leaf?.endsWith(".service")) return "supervised";
    return "unknown";
  } catch {
    return "unknown";
  }
}
