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

/** An address as 16 bytes of hex, IPv4 as IPv4-mapped IPv6; null if unparsable. */
export function addressKey(address: string): string | null {
  const v4 = (text: string) => {
    const parts = text.split(".").map(Number);
    return parts.length === 4 &&
      parts.every((part) => Number.isInteger(part) && part >= 0 && part < 256)
      ? parts.map((part) => part.toString(16).padStart(2, "0")).join("")
      : null;
  };
  const plain = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (!plain.includes(":")) {
    const hex = v4(plain);
    return hex ? `00000000000000000000ffff${hex}` : null;
  }
  let text = plain;
  const tail = text.match(/:(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const hex = v4(tail[1]!);
    if (!hex) return null;
    text = `${text.slice(0, -tail[1]!.length)}${hex.slice(0, 4)}:${hex.slice(4)}`;
  }
  const [head, rest, ...extra] = text.split("::");
  if (extra.length) return null;
  const left = head ? head.split(":") : [];
  const right = rest !== undefined && rest ? rest.split(":") : [];
  const missing = 8 - left.length - right.length;
  if (rest === undefined ? missing !== 0 : missing < 1) return null;
  const groups = [
    ...left,
    ...Array(rest === undefined ? 0 : missing).fill("0"),
    ...right,
  ];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => group.padStart(4, "0")).join("");
}

/** A /proc/net/tcp{,6} address field ("0100007F:1F90") as addressKey and port. */
function procAddress(field: string): { key: string; port: number } | null {
  const [hex, port] = field.split(":");
  if (!hex || !port) return null;
  // The kernel prints each 32-bit word in host (little-endian) byte order.
  const words = hex.match(/.{8}/g) ?? [];
  const bytes = words
    .map((word) => word.match(/../g)!.reverse().join(""))
    .join("")
    .toLowerCase();
  const key =
    bytes.length === 8
      ? `00000000000000000000ffff${bytes}`
      : bytes.length === 32
        ? bytes
        : null;
  return key ? { key, port: Number.parseInt(port, 16) } : null;
}

const isLoopbackKey = (key: string) =>
  key === "00000000000000000000000000000001" ||
  key.startsWith("00000000000000000000ffff7f");

/**
 * The socket inode of the client end of this loopback connection: the one
 * established row whose local address and port are the peer's and whose
 * remote end is this service's port on loopback. Any ambiguity fails closed.
 */
function clientSocketInode(
  fs: ProcFs,
  peer: { address: string; port: number },
  serverPort: number,
): string | null {
  const peerKey = addressKey(peer.address);
  if (!peerKey) return null;
  const found: string[] = [];
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text: string;
    try {
      text = fs.read(table);
    } catch {
      continue;
    }
    for (const line of text.split("\n").slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 10 || fields[3] !== ESTABLISHED || fields[9] === "0")
        continue;
      const local = procAddress(fields[1]!);
      const remote = procAddress(fields[2]!);
      if (
        local?.key === peerKey &&
        local.port === peer.port &&
        remote?.port === serverPort &&
        isLoopbackKey(remote.key)
      )
        found.push(fields[9]!);
    }
  }
  return found.length === 1 ? found[0]! : null;
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

/** Where a socket was last found, so a polling caller is not searched again. */
const holderCaches = new WeakMap<
  ProcFs,
  Map<string, { pid: number; fd: string }>
>();

/** Processes under `roots`, the roots first, read from each task's children. */
function descendants(fs: ProcFs, roots: readonly number[]): number[] {
  const seen = new Set<number>();
  const queue = roots.filter((pid) => pid > 1);
  while (queue.length && seen.size < MAX_DESCENDANTS) {
    const pid = queue.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    for (const task of safeList(fs, `/proc/${pid}/task`))
      try {
        for (const child of fs
          .read(`/proc/${pid}/task/${task}/children`)
          .trim()
          .split(/\s+/))
          if (/^\d+$/.test(child)) queue.push(Number(child));
      } catch {
        // Exited meanwhile.
      }
  }
  return [...seen];
}

const MAX_DESCENDANTS = 4096;

function socketHolder(
  fs: ProcFs,
  inode: string,
  roots?: readonly number[],
): number | null {
  const target = `socket:[${inode}]`;
  let holders = holderCaches.get(fs);
  if (!holders) holderCaches.set(fs, (holders = new Map()));
  const cached = holders.get(inode);
  if (cached) {
    try {
      if (fs.link(`/proc/${cached.pid}/fd/${cached.fd}`) === target)
        return cached.pid;
    } catch {
      // Gone: search again.
    }
    holders.delete(inode);
  }
  const found: { pid: number; fd: string }[] = [];
  const candidates = roots
    ? descendants(fs, roots).map(String)
    : safeList(fs, "/proc");
  for (const entry of candidates) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    for (const fd of safeList(fs, `/proc/${entry}/fd`)) {
      try {
        if (fs.link(`/proc/${entry}/fd/${fd}`) === target) {
          found.push({ pid: Number(entry), fd });
          break;
        }
      } catch {
        // Not readable, or closed meanwhile.
      }
    }
  }
  // A socket shared by several processes (an inherited descriptor) is not one caller.
  if (found.length !== 1) return null;
  if (holders.size >= 64) holders.delete(holders.keys().next().value!);
  holders.set(inode, found[0]!);
  return found[0]!.pid;
}

/** Finds the caller among the processes under `roots` (a pane's shell and foreground). */
export type CallerLocator = (
  roots: readonly number[],
) => CallerProcess[] | null;

/**
 * The process holding the client end of a loopback connection to this
 * service, and its ancestors (nearest first). Null when it cannot be found
 * unambiguously, for example off Linux or for another user's process. With
 * `roots`, only those processes and their descendants are searched: the
 * service then reads a pane's few processes, not every descriptor on the
 * machine, and a socket shared with a process outside them goes unseen.
 */
export function callerProcesses(
  peer: { address: string; port: number },
  serverPort: number,
  fs: ProcFs = realProc,
  roots?: readonly number[],
): CallerProcess[] | null {
  const inode = clientSocketInode(fs, peer, serverPort);
  const owner = inode ? socketHolder(fs, inode, roots) : null;
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

/** The pane's shell and foreground processes, where its callers run. */
export function paneRoots(info: PaneProcessInfo | null | undefined): number[] {
  return (info?.foreground_processes ?? [])
    .map((entry) => entry.pid)
    .concat(info?.shell_pid)
    .filter((pid): pid is number => typeof pid === "number" && pid > 1);
}

/**
 * True when the caller or an ancestor is the pane's shell or one of its
 * foreground processes. A shared process group alone is not enough.
 */
export function runsInPane(
  chain: readonly CallerProcess[],
  info: PaneProcessInfo | null | undefined,
): boolean {
  const pids = new Set(paneRoots(info));
  return chain.some((entry) => pids.has(entry.pid));
}
