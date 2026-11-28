import { readFileSync, readlinkSync } from "node:fs";
import type { ProcFs } from "../world/caller-identity";

type Row = Record<string, unknown>;
export type TerminalReaders = (info: Row) => Promise<boolean[]>;

/** /proc's tty_nr encodes the controlling terminal's device number. */
function ptyDevice(path: string): number | null {
  const match = /^\/dev\/pts\/(\d+)$/.exec(path);
  if (!match) return null;
  const minor = Number(match[1]);
  return Number.isSafeInteger(minor) && minor <= 0xfffff
    ? ((136 << 8) | (minor & 255) | ((minor & ~255) << 12)) >>> 0
    : null;
}

// A group member counts only when fd 0 is this terminal's PTY.
/** @internal */
export function terminalReaderEvidence(
  stat: string,
  stdin: string,
  group: number,
  tty?: string,
): boolean {
  const fields = stat
    .slice(stat.lastIndexOf(")") + 2)
    .trim()
    .split(/\s+/);
  if (fields.length < 6 || fields.slice(1, 6).some((v) => !/^-?\d+$/.test(v)))
    throw new Error("Unreadable terminal process");
  if (Number(fields[2]) !== group) return false;
  const device = ptyDevice(stdin);
  return (
    device !== null &&
    device === Number(fields[4]) >>> 0 &&
    Number(fields[5]) === group &&
    (tty === undefined || stdin === tty)
  );
}

export function readsTerminal(
  fs: Pick<ProcFs, "read" | "link">,
  pid: number,
  group: number,
  tty?: string,
): boolean {
  return terminalReaderEvidence(
    fs.read(`/proc/${pid}/stat`),
    fs.link(`/proc/${pid}/fd/0`),
    group,
    tty,
  );
}

function targets(info: Row): { group: number; pids: number[]; tty: string } {
  const group = Number(info.foreground_process_group_id);
  const tty = info.tty;
  const pids = (info.foreground_processes as Row[]).map((p) => Number(p.pid));
  if (
    !Number.isSafeInteger(group) ||
    group <= 1 ||
    typeof tty !== "string" ||
    ptyDevice(tty) === null ||
    !pids.length ||
    pids.length > 64 ||
    pids.some((pid) => !Number.isSafeInteger(pid) || pid <= 1)
  )
    throw new Error("Unreadable terminal readers");
  return { group, pids, tty };
}

export const localTerminalReaders: TerminalReaders = async (info) => {
  const { group, pids, tty } = targets(info);
  return pids.map((pid) =>
    readsTerminal(
      {
        read: (path) => readFileSync(path, "utf8"),
        link: readlinkSync,
      },
      pid,
      group,
      tty,
    ),
  );
};

/** Read the qualified TUI host, never the local machine for a remote PID. */
export function remoteTerminalReaders(
  read: (command: string) => Promise<string>,
): TerminalReaders {
  return async (info) => {
    const { group, pids, tty } = targets(info);
    // Only validated integers enter shell syntax; no terminal or user text does.
    const command = `set -eu; for pid in ${pids.join(" ")}; do cat /proc/$pid/stat; readlink /proc/$pid/fd/0; done`;
    const lines = (await read(command)).trimEnd().split("\n");
    if (lines.length !== pids.length * 2)
      throw new Error("Unreadable terminal readers");
    return pids.map((_, index) =>
      terminalReaderEvidence(
        lines[index * 2]!,
        lines[index * 2 + 1]!,
        group,
        tty,
      ),
    );
  };
}
