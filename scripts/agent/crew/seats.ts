import type { Database } from "bun:sqlite";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { Run } from "../gate/observe";
import { type Deps, herdrIds } from "./deps";
import { digest, loadSettings } from "./plan";
import type { Options } from "./review";
import { deleteMeta, feed, getMeta, metaWithPrefix, setMeta } from "./store";
import { seatArgv } from "./worker";

export type Seat = { name: string; status: string; focused: boolean };

/** Herdr's named agents; an empty list if Herdr can't be read. */
export function seats(run: Run): Seat[] {
  const result = run(["herdr", "agent", "list"]);
  if (result.code !== 0) return [];
  try {
    const agents = (
      JSON.parse(result.stdout) as {
        result?: { agents?: Record<string, unknown>[] };
      }
    ).result?.agents;
    return (agents ?? [])
      .filter((agent) => typeof agent.name === "string")
      .map((agent) => ({
        name: agent.name as string,
        status: String(agent.agent_status ?? "unknown"),
        focused: agent.focused === true,
      }));
  } catch {
    return [];
  }
}

/** Relative imports and re-exports, static or dynamic, in a source file. */
const IMPORTS = /\b(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/gu;

/**
 * The code a watcher started from `entry` runs, as of the files on disk: a
 * digest of every source reached through relative imports, so a merged change
 * to the gate, the shared pull request rules or the server's GitHub readers
 * counts as much as one to the crew itself.
 */
export function crewCodeVersion(
  entry = join(import.meta.dir, "..", "crew.ts"),
) {
  const files = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (files.has(file) || !existsSync(file)) continue;
    files.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(IMPORTS)) {
      const base = resolve(dirname(file), match[1]!);
      const found = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        join(base, "index.ts"),
      ].find(
        (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
      );
      if (found) queue.push(found);
    }
  }
  const root = dirname(entry);
  return digest(
    [...files]
      .sort()
      .map((file) => `${relative(root, file)}\0${readFileSync(file, "utf8")}`)
      .join("\0"),
  );
}

/** What one watcher process records about its code, under `watcher:<pid>`. */
export type WatcherCode = {
  /** The version it loaded at start. */
  loaded: string;
  /** Its checkout's version at its latest pass. */
  disk: string;
  /** The checkout version the owner was last told about. */
  told?: string;
};

/**
 * Records this watcher's loaded and on-disk code versions for `status`,
 * under its own pid so watchers in different checkouts don't mix, and tells
 * the owner once per version that it still runs the code it started with: a
 * merged crew change waits for a restart. One Herdr didn't show is retried.
 */
export function noticeStaleWatcher(
  crew: Database,
  loaded: string,
  disk: string,
  dir: string,
  deps: Deps,
  now = Date.now(),
  pid = process.pid,
) {
  forgetGoneWatchers(crew, deps.alive, pid);
  const key = `watcher:${pid}`;
  const raw = getMeta(crew, key);
  const told = raw ? (JSON.parse(raw) as WatcherCode).told : undefined;
  const record = (entry: WatcherCode) =>
    setMeta(crew, key, JSON.stringify(entry));
  record({ loaded, disk, ...(told ? { told } : {}) });
  if (disk === loaded || told === disk) return;
  const result = deps.run([
    "herdr",
    "notification",
    "show",
    "Crew: restart the watcher",
    "--body",
    "The crew code in the checkout changed since this watcher started; restart `bun run agent:crew -- watch` to run it.",
    "--sound",
    "request",
  ]);
  if (result.code !== 0) return;
  record({ loaded, disk, told: disk });
  feed(
    join(dir, "feed.log"),
    now,
    `watcher ${pid} runs older crew code than its checkout; told the owner to restart it`,
  );
}

/**
 * Drops the records of watchers whose process is gone, so a stopped
 * watcher's record can't be read again once the OS reuses its pid.
 */
export function forgetGoneWatchers(
  crew: Database,
  alive: (pid: number) => boolean,
  own = process.pid,
) {
  for (const { key } of metaWithPrefix(crew, "watcher:")) {
    const pid = Number(key.slice("watcher:".length));
    if (pid !== own && !alive(pid)) deleteMeta(crew, key);
  }
}

/**
 * `seat start <seat>`: a new Herdr tab in the primary checkout running the
 * seat on its roster harness, model, effort and persona, as a named agent.
 */
export function startSeat(options: Options, dir: string, deps: Deps) {
  const [verb, name] = options.args;
  if (verb !== "start" || !name || options.args.length !== 2)
    throw new Error("Usage: agent:crew -- seat start SEAT");
  const settings = loadSettings(join(dir, "config.json"));
  const entry = settings.roster[name];
  if (!entry) throw new Error(`${name} is not in the roster`);
  const launch = seatArgv(entry);
  if (!launch)
    throw new Error(`${name}'s roster model ${entry.model} has no harness`);
  if (!/^[a-z][a-z0-9_-]{0,31}$/u.test(name))
    throw new Error(`${name} is not a Herdr agent name`);
  if (seats(deps.run).some((seat) => seat.name === name))
    throw new Error(`${name} is already running`);
  const created = deps.run([
    "herdr",
    "tab",
    "create",
    ...(process.env.HERDR_WORKSPACE_ID
      ? ["--workspace", process.env.HERDR_WORKSPACE_ID]
      : []),
    "--cwd",
    dirname(dirname(dir)),
    "--label",
    name,
  ]);
  const { pane, tab } = herdrIds(created.stdout);
  if (created.code !== 0 || !pane)
    throw new Error(`Herdr couldn't open a tab for ${name}`);
  // A seat that doesn't start leaves no stray shell tab behind.
  const fail = (message: string) => {
    if (tab) deps.run(["herdr", "tab", "close", tab]);
    return new Error(message);
  };
  const argv = [
    "herdr",
    "agent",
    "start",
    name,
    "--kind",
    launch.kind,
    "--pane",
    pane,
    "--timeout",
    "60000",
    "--",
    ...launch.args,
  ];
  // A new tab's shell may not be at its prompt yet.
  for (let attempt = 1; ; attempt++) {
    const result = deps.run(argv);
    if (result.code === 0) break;
    const error = (result.stderr || result.stdout).trim();
    if (!error.includes("agent_pane_busy") || attempt >= 10)
      throw fail(`Herdr couldn't start ${name}: ${error.slice(0, 200)}`);
    Bun.sleepSync(1000);
  }
  deps.out(
    `started ${name}: ${launch.kind} ${entry.model}${entry.effort ? ` (${entry.effort})` : ""}`,
  );
  return 0;
}

/** Live seats Herdr names that the roster doesn't. */
export function unrostered(live: Seat[], roster: Record<string, unknown>) {
  return live.map((seat) => seat.name).filter((name) => !roster[name]);
}
