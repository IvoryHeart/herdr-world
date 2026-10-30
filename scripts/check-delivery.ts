import { mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { CHROME, TEST, type Affected } from "./affected";
import {
  acquireAllCheckSlots,
  acquireCheckSlot,
  type CheckClass,
  heldEnv,
} from "./check-lock";
import { guardDiskSpace } from "./disk-guard";
import { repositorySelection } from "./validation-scope";
import { worldBrowserSuites } from "./world-browser-suites";

/**
 * The local delivery gate, in lanes.
 *
 *   static         format, lint, types, build, site, specs; serial and first,
 *                  because later lanes read the build
 *   verification   behavioral verification, from then on ────────────────┐
 *   unit, browser  alongside it: unit tests, and World browser suites    │
 *   quiet          once unit and browser finish: Chrome-driven tests     │
 *                  outside World, which fail when the CPU is contended   │
 *                  (verification alone leaves room) ─────────────────────┘
 *
 * `--full` runs everything (`check:delivery`). Without it (`check:changed`,
 * the pre-push default) only what the change affects runs (see affected.ts);
 * CI's full gate stays the authority. `--browser` runs only the Chrome lanes
 * (`test:browser`), and `--static` only the static lane (`check:static`, the
 * pre-push check for a push that only merges main). Each lane writes its own
 * log; the summary and any failing lane's output come last. Each lane waits
 * for its slot in the machine-wide check queue (check-lock.ts), so gates in
 * other worktrees share the CPU instead of competing: one browser lane and
 * one verification at a time, two light lanes.
 */

type Lane = {
  name: string;
  /** "all": the lane needs the whole machine (contention-sensitive Chrome tests). */
  queue: CheckClass | "all";
  commands: string[][];
  env?: Record<string, string>;
};

const args = process.argv.slice(2);
const browserOnly = args.includes("--browser");
const staticOnly = args.includes("--static");
const full = args.includes("--full") || browserOnly || staticOnly;
const base = args.find((arg) => arg.startsWith("--base="))?.slice(7);
const scopeBase = args
  .find((arg) => arg.startsWith("--scope-base="))
  ?.slice(13);
let tooling = false;
const root = process.cwd();
const logs = join(root, ".agents/delivery/lanes");

function scope(): Affected & { why: string } {
  if (staticOnly)
    return { full: true, reason: "requested", why: "static checks only" };
  if (full) return { full: true, reason: "requested", why: "full gate" };
  const common = mergeBase(scopeBase);
  const from = base || common;
  if (!from)
    return { full: true, reason: "no base", why: "no base to compare" };
  const result = repositorySelection(root, common || from, "HEAD", from);
  tooling = result.tooling;
  if (result.full)
    return { full: true, reason: result.reason, why: result.reason };
  return {
    full: false,
    unit: [...result.unit, ...result.web],
    browser: result.world,
    verification: result.verification,
    why: `${tooling ? "tooling-only" : "scoped"}; ${result.reason}`,
  };
}

function mergeBase(ref = "origin/main") {
  const result = Bun.spawnSync(["git", "merge-base", "HEAD", ref], {
    cwd: root,
  });
  return result.exitCode === 0 ? result.stdout.toString().trim() : null;
}

const STATIC = [
  "notices:check",
  "changelog:check",
  "check:size",
  "check:commit",
  // `build` below generates and validates production assets. Avoid the extra
  // web build in server's pretypecheck while checking all three TS projects.
  "typecheck:quick",
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
      queue: "light",
      commands: [["bun", "scripts/run-tests.ts", ...unit]],
    });
  if (browser.length)
    busy.push({
      name: "browser",
      queue: "browser",
      commands: [["bun", "scripts/run-world-tests.ts", ...browser]],
      env: { HERDR_WORLD_TEST_LABEL: "browser" },
    });
  const quiet: Lane[] = [];
  if (chrome.length)
    quiet.push({
      name: "quiet",
      queue: "all",
      commands: [["bun", "scripts/run-tests.ts", ...chrome, "--parallel=2"]],
    });
  const verification: Lane[] =
    !browserOnly && (selection.full || selection.verification)
      ? [
          {
            name: "verification",
            queue: "verification",
            commands: [["bun", "run", "verification:gate"]],
          },
        ]
      : [];
  return staticOnly
    ? { busy: [], quiet: [], verification: [] }
    : { busy, quiet, verification };
}

type Result = { name: string; code: number; seconds: number; log: string };

async function runLane(lane: Lane): Promise<Result> {
  const log = join(logs, `${lane.name}.log`);
  const options = { lane: lane.name, worktree: basename(root) };
  const release =
    lane.queue === "all"
      ? await acquireAllCheckSlots(options)
      : await acquireCheckSlot(lane.queue, options);
  try {
    return await runLaneCommands(lane, log);
  } finally {
    release();
  }
}

async function runLaneCommands(lane: Lane, log: string): Promise<Result> {
  const began = performance.now();
  const out = Bun.file(log).writer();
  let code = 0;
  for (const command of lane.commands) {
    out.write(`$ ${command.join(" ")}\n`);
    const child = Bun.spawn(command, {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        ...lane.env,
        ...heldEnv(lane.queue === "all" ? "browser" : lane.queue),
      },
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

guardDiskSpace(
  browserOnly ? "the browser checks" : full ? "the full gate" : "the gate",
  root,
);
const selection = scope();
const { busy, quiet, verification } = plan(selection);
const lanes = [...verification, ...busy, ...quiet];
mkdirSync(logs, { recursive: true });
console.info(
  `[gate] ${staticOnly ? "static" : browserOnly ? "browser" : tooling ? "tooling" : selection.full ? "full" : "changed"}: ${selection.why}; lanes: ${[...(browserOnly ? [] : ["static"]), ...lanes.map((lane) => lane.name)].join(", ")}`,
);
if (!selection.full)
  console.info(
    `[gate] unit ${selection.unit.length}, browser ${selection.browser.length}, verification ${selection.verification ? "yes" : "no"}`,
  );
const results: Result[] = [];
if (!browserOnly)
  results.push(
    await runLane({ name: "static", queue: "light", commands: STATIC }),
  );
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
