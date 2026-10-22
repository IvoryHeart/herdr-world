import { readdirSync, readFileSync, readlinkSync } from "node:fs";

/**
 * Who is calling the World CLI endpoint. A caller names its pane with
 * HERDR_PANE_ID, which any process can set, so the service checks it: the
 * calling process (found from its loopback TCP connection) or one of its
 * ancestors must be the pane's shell or a foreground process in Herdr. This
 * works for panes of a local Herdr on Linux; elsewhere the claim stays
 * unverified and is labelled so.
 */

export type CallerProcess = { pid: number; ppid: number; pgrp: number };

export type ProcFs = {
  read(path: string): string;
  list(path: string): string[];
  link(path: string): string;
};

const realProc: ProcFs = {
  read: (path) => readFileSync(path, "utf8"),
  list: (path) => readdirSync(path),
  link: (path) => readlinkSync(path),
};

const ESTABLISHED = "01";

/** The socket inode of the client end of a loopback TCP connection. */
function clientSocketInode(
  fs: ProcFs,
  clientPort: number,
  serverPort: number,
): string | null {
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text: string;
    try {
      text = fs.read(table);
    } catch {
      continue;
    }
    for (const line of text.split("\n").slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 10 || fields[3] !== ESTABLISHED) continue;
      const local = Number.parseInt(fields[1]!.split(":").pop()!, 16);
      const remote = Number.parseInt(fields[2]!.split(":").pop()!, 16);
      if (local === clientPort && remote === serverPort && fields[9] !== "0")
        return fields[9]!;
    }
  }
  return null;
}

function processOf(fs: ProcFs, pid: number): CallerProcess | null {
  try {
    const stat = fs.read(`/proc/${pid}/stat`);
    // The command name may hold spaces and parentheses: fields follow the last ")".
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return { pid, ppid: Number(fields[1]), pgrp: Number(fields[2]) };
  } catch {
    return null;
  }
}

/**
 * The process holding the client end of a loopback connection to this
 * service, and its ancestors (nearest first). Null when it cannot be found,
 * for example off Linux or for another user's process.
 */
export function callerProcesses(
  clientPort: number,
  serverPort: number,
  fs: ProcFs = realProc,
): CallerProcess[] | null {
  const inode = clientSocketInode(fs, clientPort, serverPort);
  if (!inode) return null;
  const target = `socket:[${inode}]`;
  let owner: number | null = null;
  for (const entry of safeList(fs, "/proc")) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    if (
      safeList(fs, `/proc/${entry}/fd`).some((fd) => {
        try {
          return fs.link(`/proc/${entry}/fd/${fd}`) === target;
        } catch {
          return false;
        }
      })
    ) {
      owner = Number(entry);
      break;
    }
  }
  if (owner === null) return null;
  const chain: CallerProcess[] = [];
  for (let pid = owner; pid > 1 && chain.length < 64; ) {
    const entry = processOf(fs, pid);
    if (!entry) break;
    chain.push(entry);
    pid = entry.ppid;
  }
  return chain.length ? chain : null;
}

function safeList(fs: ProcFs, path: string) {
  try {
    return fs.list(path);
  } catch {
    return [];
  }
}

/** Herdr's `pane.process_info` answer, as far as the check needs it. */
export type PaneProcessInfo = {
  shell_pid?: number;
  foreground_process_group_id?: number;
  foreground_processes?: { pid?: number }[];
};

/**
 * True when the caller or an ancestor runs in the pane: it is the pane's
 * shell, one of its foreground processes or in its foreground process group.
 */
export function runsInPane(
  chain: readonly CallerProcess[],
  info: PaneProcessInfo | null | undefined,
): boolean {
  if (!info) return false;
  const group = info.foreground_process_group_id;
  const pids = new Set(
    (info.foreground_processes ?? [])
      .map((entry) => entry.pid)
      .concat(info.shell_pid)
      .filter((pid): pid is number => typeof pid === "number" && pid > 1),
  );
  return chain.some(
    (entry) =>
      pids.has(entry.pid) ||
      (typeof group === "number" && group > 1 && entry.pgrp === group),
  );
}
