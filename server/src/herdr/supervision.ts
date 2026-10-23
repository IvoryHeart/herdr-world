import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";

/**
 * Whether a live handoff can keep the panes of the Herdr server listening on
 * a socket. Herdr's handoff starts the new server as a detached child of the
 * old one and then lets the old process exit
 * (https://github.com/herdrdev/herdr/blob/v0.9.5/src/server/handoff.rs). A
 * supervisor that owns the old process treats that exit as the end of its
 * service: systemd's default KillMode=control-group then kills the child and
 * every pane, and launchd's KeepAlive or a wrapper starts a competing server.
 * Only a server proven to be outside any supervisor is "unsupervised":
 * on Linux, a daemonized server in a terminal or login scope. Anything else,
 * including every macOS server, is "unknown" and must be restarted instead.
 */
export type ServerSupervision = "unsupervised" | "supervised" | "unknown";

export interface SupervisionDeps {
  platform?: string;
  /** Linux: the procfs mount, replaced in tests. */
  procRoot?: string;
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

/** The parent PID from /proc/<pid>/stat; the command name may hold spaces. */
export function parentPid(stat: string): string | null {
  return (
    /\)\s+\S+\s+(\d+)/.exec(stat.slice(stat.lastIndexOf(")")))?.[1] ?? null
  );
}

export async function detectServerSupervision(
  socketPath: string,
  deps: SupervisionDeps = {},
): Promise<ServerSupervision> {
  const platform = deps.platform ?? process.platform;
  try {
    // macOS cannot show, without privileges, that no launchd job in any
    // domain (or a wrapper) supervises a process, so it is never proven safe.
    if (platform !== "linux") return "unknown";
    const procRoot = deps.procRoot ?? "/proc";
    const pids = linuxServerPids(socketPath, procRoot);
    if (pids.length !== 1) return "unknown";
    const leaf = cgroupLeaf(
      readFileSync(join(procRoot, pids[0], "cgroup"), "utf8"),
    );
    // A service's main process exit stops the service and its cgroup.
    if (leaf?.endsWith(".service")) return "supervised";
    // A scope (a terminal, a login session) has no main process to lose, but
    // a wrapper inside it could still restart the server; only a daemonized
    // server, reparented to init or the user's systemd manager, is proven safe.
    if (!leaf?.endsWith(".scope")) return "unknown";
    const parent = parentPid(
      readFileSync(join(procRoot, pids[0], "stat"), "utf8"),
    );
    if (parent === "1") return "unsupervised";
    if (!parent) return "unknown";
    const parentName = readFileSync(
      join(procRoot, parent, "comm"),
      "utf8",
    ).trim();
    return parentName === "systemd" ? "unsupervised" : "unknown";
  } catch {
    return "unknown";
  }
}
