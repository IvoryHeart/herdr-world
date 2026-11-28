import { spawnSync } from "node:child_process";
import { addressKey, type CallerProcess } from "./caller-identity";

const LIMITS = { timeout: 1_000, maxBuffer: 256 * 1024 };
const MAX_PROCESSES = 4096;
const MAX_ANCESTORS = 64;

/** Read-only process inspection; null includes missing tools, timeout and overflow. */
export type ProcessLookupCommand = (
  file: string,
  args: readonly string[],
  limits: typeof LIMITS,
) => string | null;

const inspect: ProcessLookupCommand = (file, args, limits) => {
  try {
    const result = spawnSync(file, args, {
      ...limits,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, LC_ALL: "C" },
    });
    return !result.error && result.status === 0 ? result.stdout : null;
  } catch {
    return null;
  }
};

function endpoint(value: string) {
  const match = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(value);
  if (!match) return null;
  const key = addressKey(match[1]!);
  const port = Number(match[2]);
  return key && port > 0 && port <= 65535 ? { key, port } : null;
}

const loopback = (key: string) =>
  key === "00000000000000000000000000000001" ||
  key.startsWith("00000000000000000000ffff7f");

/** lsof field output: p starts a process, f a descriptor, n its numeric endpoints. */
function socketOwner(
  text: string,
  peer: { address: string; port: number },
  serverPort: number,
): number | null {
  const peerKey = addressKey(peer.address);
  const matches = new Map<string, number>();
  let pid = 0;
  let name = "";
  let state = "";
  const finish = () => {
    if (pid <= 1 || pid === process.pid || state !== "ESTABLISHED") return;
    const [from, to, extra] = name.split("->");
    if (!from || !to || extra !== undefined) return;
    const local = endpoint(from);
    const remote = endpoint(to);
    if (
      local?.key === peerKey &&
      local.port === peer.port &&
      remote?.port === serverPort &&
      loopback(remote.key)
    )
      matches.set(`${pid}:${remote.key}`, pid);
  };
  for (const field of text.split("\n")) {
    if (field.startsWith("p") || field.startsWith("f")) {
      finish();
      name = state = "";
      if (field.startsWith("p"))
        pid = /^p[1-9]\d*$/.test(field) ? Number(field.slice(1)) : 0;
    } else if (field.startsWith("n")) name = field.slice(1);
    else if (field.startsWith("TST=")) state = field.slice(4);
  }
  finish();
  return matches.size === 1 ? matches.values().next().value! : null;
}

/**
 * macOS has no /proc. Inspect only established sockets on the peer port, then
 * follow a numeric process snapshot. Both commands have fixed executable paths,
 * no shell, no privilege escalation, a 1 s deadline and a 256 KiB output cap.
 * No command names, arguments or environment values are collected. Ambiguous
 * sockets, missing tools, unreadable processes and exhausted bounds fail closed.
 */
export function darwinCallerProcesses(
  peer: { address: string; port: number },
  serverPort: number,
  roots?: readonly number[],
  run: ProcessLookupCommand = inspect,
): CallerProcess[] | null {
  const key = addressKey(peer.address);
  if (
    !key ||
    !loopback(key) ||
    ![peer.port, serverPort].every(
      (port) => Number.isInteger(port) && port > 0 && port <= 65535,
    ) ||
    (roots && !roots.some((pid) => Number.isSafeInteger(pid) && pid > 1))
  )
    return null;
  try {
    const sockets = run(
      "/usr/sbin/lsof",
      ["-nP", "-a", `-iTCP:${peer.port}`, "-sTCP:ESTABLISHED", "-FpnT"],
      LIMITS,
    );
    if (sockets === null || sockets.length > LIMITS.maxBuffer) return null;
    const owner = socketOwner(sockets, peer, serverPort);
    if (owner === null) return null;
    const snapshot = run("/bin/ps", ["-A", "-o", "pid=,ppid=,pgid="], LIMITS);
    if (snapshot === null || snapshot.length > LIMITS.maxBuffer) return null;
    const processes = new Map<number, CallerProcess>();
    for (const row of snapshot.trim().split("\n")) {
      const fields = row.trim().split(/\s+/);
      if (fields.length !== 3 || !fields.every((field) => /^\d+$/.test(field)))
        return null;
      const [pid, ppid, pgrp] = fields.map(Number) as [number, number, number];
      if (
        ![pid, ppid, pgrp].every(Number.isSafeInteger) ||
        pid < 1 ||
        processes.has(pid)
      )
        return null;
      processes.set(pid, { pid, ppid, pgrp });
      if (processes.size > MAX_PROCESSES) return null;
    }
    const chain: CallerProcess[] = [];
    const seen = new Set<number>();
    for (let pid = owner; pid > 1; ) {
      if (seen.has(pid) || chain.length === MAX_ANCESTORS) return null;
      const entry = processes.get(pid);
      if (!entry) break;
      seen.add(pid);
      chain.push(entry);
      pid = entry.ppid;
    }
    return chain.length &&
      (!roots || chain.some((entry) => roots.includes(entry.pid)))
      ? chain
      : null;
  } catch {
    return null;
  }
}
