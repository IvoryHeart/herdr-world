import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CHROME,
  TEST,
  affected,
  buildGraph,
  coverageOwners,
  gitChanges,
  type Affected,
} from "./affected";
import { worldBrowserSuites, worldTimedSuites } from "./world-browser-suites";

/**
 * The local delivery gate, in lanes.
 *
 *   static         format, lint, types, build, site, specs; serial and first,
 *                  because later lanes read the build
 *   verification   behavioral verification, from then on ────────────────┐
 *   unit, browser  alongside it: unit tests, and World browser suites    │
 *                  that assert no timings                                │
 *   quiet          once unit and browser finish: Chrome-driven tests and │
 *                  suites with wall-clock budgets, which fail when the   │
 *                  CPU is contended (verification alone leaves room) ────┘
 *
 * `--full` runs everything (`check:delivery`). Without it (`check:changed`,
 * the pre-push default) only what the change affects runs (see affected.ts);
 * CI's full gate stays the authority. `--browser` runs only the Chrome lanes
 * (`test:browser`). Each lane writes its own log; the
 * summary and any failing lane's output come last. One gate runs at a time
 * per machine: a second waits rather than competing for the CPU.
 */

type Lane = {
  name: string;
  commands: string[][];
  env?: Record<string, string>;
};

const args = process.argv.slice(2);
const browserOnly = args.includes("--browser");
const full = args.includes("--full") || browserOnly;
const base = args.find((arg) => arg.startsWith("--base="))?.slice(7);
const root = process.cwd();
const logs = join(root, ".agents/delivery/lanes");

function scope(): Affected & { why: string } {
  if (full) return { full: true, reason: "requested", why: "full gate" };
  const from = base || mergeBase();
  if (!from)
    return { full: true, reason: "no base", why: "no base to compare" };
  const { tracked, changed, deleted } = gitChanges(root, from);
  const result = affected(
    buildGraph(root, tracked, deleted),
    changed,
    worldBrowserSuites,
    coverageOwners(root),
  );
  return {
    ...result,
    why: result.full
      ? result.reason
      : `${changed.length} changed files since ${from.slice(0, 8)}`,
  };
}

function mergeBase() {
  const result = Bun.spawnSync(["git", "merge-base", "HEAD", "origin/main"], {
    cwd: root,
  });
  return result.exitCode === 0 ? result.stdout.toString().trim() : null;
}

const STATIC = [
  "notices:check",
  "format:check",
  "lint",
  "typecheck",
  "typecheck:bun",
  "build",
  "build:site",
  "spec:check",
].map((script) => ["bun", "run", script]);

function trackedTests() {
  const result = Bun.spawnSync(["git", "ls-files"], { cwd: root });
  return result.stdout
    .toString()
    .split("\n")
    .filter((path) => TEST.test(path));
}

function plan(selection: Affected) {
  const world = new Set(worldBrowserSuites);
  const timed = new Set(worldTimedSuites);
  const browser = selection.full ? worldBrowserSuites : selection.browser;
  const tests = (selection.full ? trackedTests() : selection.unit).filter(
    (path) => !world.has(path),
  );
  const chrome = tests.filter((path) =>
    CHROME.test(readFileSync(join(root, path), "utf8")),
  );
  const unit = tests.filter((path) => !chrome.includes(path));
  const busy: Lane[] = [];
  if (unit.length && !browserOnly)
    busy.push({
      name: "unit",
      commands: [["bun", "scripts/run-tests.ts", ...unit]],
    });
  const untimed = browser.filter((path) => !timed.has(path));
  if (untimed.length)
    busy.push({
      name: "browser",
      commands: [["bun", "scripts/run-world-tests.ts", ...untimed]],
      env: { HERDR_WORLD_TEST_LABEL: "browser" },
    });
  const quiet: Lane[] = [];
  const timedSuites = browser.filter((path) => timed.has(path));
  if (chrome.length || timedSuites.length)
    quiet.push({
      name: "quiet",
      commands: [
        ...(chrome.length
          ? [["bun", "scripts/run-tests.ts", ...chrome, "--parallel=2"]]
          : []),
        ...(timedSuites.length
          ? [
              [
                "bun",
                "scripts/run-world-tests.ts",
                ...timedSuites,
                "--parallel=2",
              ],
            ]
          : []),
      ],
      env: { HERDR_WORLD_TEST_LABEL: "timed" },
    });
  const verification: Lane[] =
    !browserOnly && (selection.full || selection.verification)
      ? [
          {
            name: "verification",
            commands: [["bun", "run", "verification:gate"]],
          },
        ]
      : [];
  return { busy, quiet, verification };
}

type Result = { name: string; code: number; seconds: number; log: string };

async function runLane(lane: Lane): Promise<Result> {
  const log = join(logs, `${lane.name}.log`);
  const began = performance.now();
  const out = Bun.file(log).writer();
  let code = 0;
  for (const command of lane.commands) {
    out.write(`$ ${command.join(" ")}\n`);
    const child = Bun.spawn(command, {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...lane.env },
    });
    const pump = async (stream: ReadableStream<Uint8Array>) => {
      for await (const chunk of stream) out.write(chunk);
    };
    await Promise.all([pump(child.stdout), pump(child.stderr)]);
    code = await child.exited;
    if (code !== 0) break;
  }
  await out.end();
  return {
    name: lane.name,
    code,
    seconds: (performance.now() - began) / 1000,
    log,
  };
}

/** One gate per machine: wait for a running one rather than compete. */
async function lock() {
  const dir = join(tmpdir(), "herdr-world-delivery-gate.lock");
  const owner = join(dir, "pid");
  let waited = false;
  for (;;) {
    try {
      mkdirSync(dir);
      writeFileSync(owner, String(process.pid));
      return () => rmSync(dir, { recursive: true, force: true });
    } catch {
      let pid = 0;
      try {
        pid = Number(readFileSync(owner, "utf8"));
      } catch {
        // Being created or removed: try again.
      }
      const alive = (() => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      })();
      if (pid && !alive) {
        rmSync(dir, { recursive: true, force: true });
        continue;
      }
      if (!waited) {
        console.info(
          `[gate] another delivery gate (pid ${pid || "?"}) is running; waiting`,
        );
        waited = true;
      }
      await Bun.sleep(2000);
    }
  }
}

const selection = scope();
const { busy, quiet, verification } = plan(selection);
const lanes = [...verification, ...busy, ...quiet];
mkdirSync(logs, { recursive: true });
console.info(
  `[gate] ${browserOnly ? "browser" : selection.full ? "full" : "changed"}: ${selection.why}; lanes: ${[...(browserOnly ? [] : ["static"]), ...lanes.map((lane) => lane.name)].join(", ")}`,
);
if (!selection.full)
  console.info(
    `[gate] unit ${selection.unit.length}, browser ${selection.browser.length}, verification ${selection.verification ? "yes" : "no"}`,
  );
const release = await lock();
const results: Result[] = [];
try {
  if (!browserOnly)
    results.push(await runLane({ name: "static", commands: STATIC }));
  if (results.every((result) => result.code === 0)) {
    const ok = (list: Result[]) => list.every((result) => result.code === 0);
    const tests = (async () => {
      const done = await Promise.all(busy.map(runLane));
      // Quiet lanes need the CPU: they start once the busy lanes finish,
      // and only if those passed.
      return ok(done)
        ? [...done, ...(await Promise.all(quiet.map(runLane)))]
        : done;
    })();
    const [checked, tested] = await Promise.all([
      Promise.all(verification.map(runLane)),
      tests,
    ]);
    results.push(...checked, ...tested);
  }
} finally {
  release();
}

const failed = results.filter((result) => result.code !== 0);
for (const result of failed) {
  // The failing lane's output, so the hook's log and tail show it.
  console.error(`\n===== ${result.name} (exit ${result.code}) =====`);
  console.error(readFileSync(result.log, "utf8"));
}
for (const result of results)
  console.info(
    `[gate] ${result.name}: ${result.code === 0 ? "passed" : `failed (exit ${result.code})`} in ${result.seconds.toFixed(0)}s — ${result.log}`,
  );
process.exitCode = failed.length ? 1 : 0;
