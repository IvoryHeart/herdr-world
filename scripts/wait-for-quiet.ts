import { readFileSync } from "node:fs";

/**
 * Wait until this machine is quiet before a latency measurement: the World
 * latency trend workflow runs it after installing, so dependency setup and its
 * tail do not land inside a measurement. Quiet means at least `idle` of the CPU
 * time was idle in each of `needed` consecutive one-second samples. After
 * `limit` seconds it carries on and says so; the report then shows the noise.
 */

export type CpuSample = { idle: number; total: number };

/** The aggregate "cpu" line of /proc/stat. */
export function parseStat(text: string): CpuSample {
  const line = text.split("\n").find((row) => row.startsWith("cpu "));
  if (!line) throw new Error("/proc/stat has no aggregate cpu line");
  const values = line.trim().split(/\s+/).slice(1).map(Number);
  // user nice system idle iowait irq softirq steal…: idle and iowait idle.
  const idle = (values[3] ?? 0) + (values[4] ?? 0);
  return { idle, total: values.reduce((sum, value) => sum + value, 0) };
}

/** The idle share between two samples. */
export function idleShare(before: CpuSample, after: CpuSample) {
  const total = after.total - before.total;
  return total > 0 ? (after.idle - before.idle) / total : 1;
}

export async function waitForQuiet({
  read = () => parseStat(readFileSync("/proc/stat", "utf8")),
  sleep = (ms: number) => Bun.sleep(ms),
  idle = 0.9,
  needed = 3,
  limit = 60,
}: {
  read?: () => CpuSample;
  sleep?: (ms: number) => Promise<unknown>;
  idle?: number;
  needed?: number;
  limit?: number;
} = {}) {
  let previous = read();
  let quiet = 0;
  const shares: number[] = [];
  for (let second = 1; second <= limit; second++) {
    await sleep(1000);
    const current = read();
    const share = idleShare(previous, current);
    previous = current;
    shares.push(share);
    quiet = share >= idle ? quiet + 1 : 0;
    if (quiet >= needed) return { quiet: true, seconds: second, shares };
  }
  return { quiet: false, seconds: limit, shares };
}

if (import.meta.main) {
  const result = await waitForQuiet();
  const last = result.shares
    .slice(-3)
    .map((share) => `${Math.round(share * 100)}%`);
  console.info(
    result.quiet
      ? `[quiet] idle for 3 s after ${result.seconds} s (${last.join(", ")} idle)`
      : `[quiet] still busy after ${result.seconds} s (${last.join(", ")} idle); measuring anyway`,
  );
}
