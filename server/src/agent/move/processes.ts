import { harnessOfArgv } from "../../herdr-core/harness";
import { basename } from "node:path";
export type MoveProcess = {
  pid: number;
  ppid: number;
  group: number;
  name: string;
  args: string;
};
export function moveProcesses(text: string): MoveProcess[] {
  const rows = text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line);
      if (!m) throw new Error("World could not check background processes.");
      return {
        pid: Number(m[1]),
        ppid: Number(m[2]),
        group: Number(m[3]),
        name: basename(m[4]!.split(/\s+/)[0]!),
        args: m[4]!,
      };
    });
  if (!rows.length)
    throw new Error("World could not check background processes.");
  return rows;
}
/** Refuse tools, servers and background jobs, including descendants in other groups. */
export function assertNoBackground(
  rows: MoveProcess[],
  foreground: number,
  kind: string,
): number[] {
  const roots = rows.filter((p) => p.group === foreground);
  if (!roots.length)
    throw new Error("World could not identify the agent process.");
  const descendants = new Set(roots.map((p) => p.pid));
  for (let changed = true; changed; ) {
    changed = false;
    for (const p of rows)
      if (descendants.has(p.ppid) && !descendants.has(p.pid)) {
        descendants.add(p.pid);
        changed = true;
      }
  }
  if (
    rows.some(
      (p) =>
        descendants.has(p.pid) &&
        (p.group !== foreground || harnessOfArgv(p.args.split(/\s+/)) !== kind),
    )
  )
    throw new Error(
      "This agent has background work or a tool process running. Let it finish before moving.",
    );
  return [...descendants];
}
