/**
 * The processes an IDE server World started owns (#1009): its process
 * group and every process descended from it. VS Code's `serve-web` starts
 * a separate server, which starts extension hosts and terminal shells;
 * terminal shells run in sessions of their own, so signalling the group
 * alone misses them, and once a parent exits its children are re-parented
 * and no longer look like descendants. Stopping therefore collects the
 * tree before signalling and keeps every process it has seen until that
 * process is gone.
 */
export type ProcessRow = {
  pid: number;
  ppid: number;
  pgid: number;
  /** Exited, waiting to be reaped: no longer running. */
  zombie: boolean;
};

/** Every process on this computer, from `ps` (Linux and macOS). */
export function listProcesses(): ProcessRow[] | null {
  try {
    const result = Bun.spawnSync(
      ["ps", "-A", "-o", "pid=", "-o", "ppid=", "-o", "pgid=", "-o", "stat="],
      { stdout: "pipe", stderr: "ignore", stdin: "ignore" },
    );
    if (result.exitCode !== 0) return null;
    return parseProcessRows(result.stdout.toString());
  } catch {
    return null;
  }
}

export function parseProcessRows(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split("\n")) {
    const [pid, ppid, pgid, stat = ""] = line.trim().split(/\s+/);
    const row = {
      pid: Number(pid),
      ppid: Number(ppid),
      pgid: Number(pgid),
      zombie: stat.startsWith("Z"),
    };
    if (Number.isInteger(row.pid) && row.pid > 0) rows.push(row);
  }
  return rows;
}

/**
 * The running processes among `roots`, the members of `group`, and all of
 * their descendants. Never World itself or anything above it.
 */
export function ownedProcesses(
  rows: ProcessRow[],
  roots: Iterable<number>,
  group?: number,
  self = process.pid,
): number[] {
  const want = new Set<number>(roots);
  if (group !== undefined && group > 1)
    for (const row of rows) if (row.pgid === group) want.add(row.pid);
  for (let added = true; added; ) {
    added = false;
    for (const row of rows)
      if (!want.has(row.pid) && want.has(row.ppid)) {
        want.add(row.pid);
        added = true;
      }
  }
  const above = new Set<number>();
  const parent = new Map(rows.map((row) => [row.pid, row.ppid]));
  let pid: number | undefined = self;
  while (pid && !above.has(pid)) {
    above.add(pid);
    pid = parent.get(pid);
  }
  return rows
    .filter(
      (row) =>
        want.has(row.pid) && !row.zombie && row.pid > 1 && !above.has(row.pid),
    )
    .map((row) => row.pid);
}

export function signalProcesses(
  pids: Iterable<number>,
  signal: NodeJS.Signals,
) {
  for (const pid of pids)
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone.
    }
}
