import type { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Run } from "../gate/observe";
import { type Deps, herdrIds } from "./deps";
import { digest, loadSettings } from "./plan";
import type { Options } from "./review";
import { feed, getMeta, setMeta } from "./store";
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

/** The crew and gate code as of the files on disk, to tell a stale watcher. */
export function crewCodeVersion(root = join(import.meta.dir, "..")) {
  const files = [join(root, "crew.ts"), join(root, "gate.ts")];
  for (const folder of ["crew", "gate"])
    for (const name of readdirSync(join(root, folder)).sort())
      if (name.endsWith(".ts") && !name.endsWith(".test.ts"))
        files.push(join(root, folder, name));
  return digest(
    files
      .filter((file) => existsSync(file))
      .map((file) => readFileSync(file, "utf8"))
      .join("\0"),
  );
}

/**
 * Tells the owner once per checkout version that this watcher still runs
 * the code it started with: a merged crew change waits for a restart.
 */
export function noticeStaleWatcher(
  crew: Database,
  loaded: string,
  dir: string,
  deps: Deps,
) {
  const disk = crewCodeVersion();
  if (disk === loaded || getMeta(crew, "watcher.stale") === disk) return;
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
  setMeta(crew, "watcher.stale", disk);
  feed(
    join(dir, "feed.log"),
    Date.now(),
    "watcher runs older crew code than the checkout; told the owner to restart it",
  );
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
  const { pane } = herdrIds(created.stdout);
  if (created.code !== 0 || !pane)
    throw new Error(`Herdr couldn't open a tab for ${name}`);
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
      throw new Error(`Herdr couldn't start ${name}: ${error.slice(0, 200)}`);
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
