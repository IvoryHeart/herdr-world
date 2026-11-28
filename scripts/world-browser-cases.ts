import assert from "node:assert/strict";

// Six runners (the full run's sixteen-job cap) each run three logical
// queues, packed longest case first by recorded CI time.
const WORLD_BROWSER_SHARDS = 6;
const WORLD_BROWSER_WORKERS = 3;

export type CaseTimings = Record<string, Record<string, number>>;
type WorldCaseTask = {
  file: string;
  names: string[];
  // Exactly one task per file catches cases absent from the timing table.
  remaining: boolean;
  seconds: number;
};

/** Longest cases first across bounded, process-isolated workers. */
export function planWorldBrowserCases(
  files: readonly string[],
  timings: CaseTimings,
  shards = WORLD_BROWSER_SHARDS,
  workers = WORLD_BROWSER_WORKERS,
): WorldCaseTask[][][] {
  assert(Number.isInteger(shards) && shards > 0, "Invalid shard count");
  assert(Number.isInteger(workers) && workers > 0, "Invalid worker count");
  assert(new Set(files).size === files.length, "Duplicate World suite");
  const queues: WorldCaseTask[][] = Array.from(
    { length: shards * workers },
    () => [],
  );
  const loads = queues.map(() => 0);
  const cases = files
    .flatMap((file) =>
      Object.entries(timings[file] ?? {}).map(([name, seconds]) => {
        assert(
          name && Number.isFinite(seconds) && seconds > 0,
          `Invalid case timing: ${file} ${name}`,
        );
        return { file, name, seconds };
      }),
    )
    .sort(
      (a, b) =>
        b.seconds - a.seconds ||
        a.file.localeCompare(b.file) ||
        a.name.localeCompare(b.name),
    );
  for (const { file, name, seconds } of cases) {
    const index = loads.indexOf(Math.min(...loads));
    let task = queues[index]!.find((task) => task.file === file);
    if (!task) {
      task = { file, names: [], remaining: false, seconds: 0 };
      queues[index]!.push(task);
    }
    task.names.push(name);
    task.seconds += seconds;
    loads[index]! += seconds;
  }
  for (const file of files) {
    const candidates = queues.flatMap((queue, index) =>
      queue.some((task) => task.file === file) ? [index] : [],
    );
    const index = (
      candidates.length ? candidates : queues.map((_, index) => index)
    ).sort((a, b) => loads[a]! - loads[b]! || a - b)[0]!;
    let task = queues[index]!.find((task) => task.file === file);
    if (!task) {
      task = { file, names: [], remaining: false, seconds: 10 };
      queues[index]!.push(task);
      loads[index]! += 10;
    }
    task.remaining = true;
  }
  return Array.from({ length: shards }, (_, index) =>
    queues.slice(index * workers, (index + 1) * workers),
  );
}

const escaped = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Exact names, plus the complement on one worker. Never filter across files. @internal */
export function worldCasePattern(
  task: WorldCaseTask,
  timings: CaseTimings,
): string {
  const names = task.names.map(escaped);
  // Unlike $, this also distinguishes a name ending in a newline.
  const end = "(?![\\s\\S])";
  if (task.remaining) {
    const others = Object.keys(timings[task.file] ?? {})
      .filter((name) => !task.names.includes(name))
      .map(escaped);
    if (!others.length) return "";
    return `^(?!(?:${others.join("|")})${end})[\\s\\S]*${end}`;
  }
  assert(names.length, "Empty World case task");
  return `^(?:${names.join("|")})${end}`;
}

/** Bun arguments shared by the runner and executable selector regressions. */
export function worldCaseTestArgs(
  task: WorldCaseTask,
  timings: CaseTimings,
): string[] {
  const pattern = worldCasePattern(task, timings);
  return [
    ...(pattern ? [`--test-name-pattern=${pattern}`] : []),
    // Timing rows can outlive a rename/deletion. The complement still owns
    // every current case and must retain Bun's missing-test failure.
    ...(!task.remaining ? ["--pass-with-no-tests"] : []),
  ];
}

/** Keep CI's isolated scenes isolated even when cases span logical workers. */
export function worldCaseConcurrency(args: readonly string[]): number {
  const index = args.findIndex((arg) => /^--parallel(?:=|$)/.test(arg));
  if (index < 0) return WORLD_BROWSER_WORKERS;
  const count = Number(
    args[index]!.includes("=") ? args[index]!.split("=")[1] : args[index + 1],
  );
  assert(
    Number.isInteger(count) && count > 0,
    "Invalid World case concurrency",
  );
  return Math.min(count, WORLD_BROWSER_WORKERS);
}

/** Finish every case group, even after a failed assertion; keep workers bounded. */
export async function executeWorldBrowserCases(
  workers: readonly (readonly WorldCaseTask[])[],
  files: readonly string[],
  run: (task: WorldCaseTask, worker: number, index: number) => Promise<number>,
  concurrency = WORLD_BROWSER_WORKERS,
): Promise<number> {
  assert(
    workers.length <= WORLD_BROWSER_WORKERS,
    "Too many World case workers",
  );
  assert(
    Number.isInteger(concurrency) &&
      concurrency > 0 &&
      concurrency <= WORLD_BROWSER_WORKERS,
    "Invalid World case concurrency",
  );
  let active = 0;
  const waiting: (() => void)[] = [];
  const limitedRun = async (
    task: WorldCaseTask,
    worker: number,
    index: number,
  ) => {
    if (active === concurrency)
      await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await run(task, worker, index);
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
  const results = await Promise.allSettled(
    workers.map(async (tasks, worker) => {
      let result = 0;
      for (const [index, task] of tasks.entries()) {
        if (!files.includes(task.file)) continue;
        const code = await limitedRun(task, worker, index);
        if (code !== 0) result = code;
        // Assertion failures report later cases; a signal/crash stops the worker.
        if (code !== 0 && code !== 1) return code;
      }
      return result;
    }),
  );
  for (const result of results)
    if (result.status === "rejected") throw result.reason;
  return (
    results.flatMap((result) =>
      result.status === "fulfilled" && result.value !== 0 ? [result.value] : [],
    )[0] ?? 0
  );
}
