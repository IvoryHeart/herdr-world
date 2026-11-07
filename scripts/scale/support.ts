import { readFileSync } from "node:fs";

export async function deadline<T>(
  promise: Promise<T>,
  label: string,
  ms = 120_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Completion deadline: ${label}`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function processSample(pid: number) {
  if (process.platform !== "linux") return null;
  const fields = readFileSync(`/proc/${pid}/stat`, "utf8")
    .split(") ")[1]!
    .split(" ");
  return {
    ticks: Number(fields[11]) + Number(fields[12]),
    rssPages: Number(fields[21]),
  };
}

export function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
  return {
    n: values.length,
    min: sorted[0] ?? null,
    median: at(0.5),
    p95: at(0.95),
    max: sorted.at(-1) ?? null,
  };
}
