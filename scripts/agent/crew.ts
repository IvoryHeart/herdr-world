import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { shortSha } from "../../shared/pullRequests";
import { gateDir, loadConfig, runPass } from "./gate";
import type { Run } from "./gate/observe";
import type { GateInput, Verdict } from "./gate/predicate";
import { openStore } from "./gate/store";
import { type Deps, realDeps } from "./crew/deps";
import {
  type Action,
  authorOf,
  digest,
  type CrewSettings,
  inScope,
  loadSettings,
  plan,
} from "./crew/plan";
import {
  checkoutOf,
  openChat,
  type Options,
  review,
  runs,
} from "./crew/review";
import {
  actionsIn,
  activeRuns,
  addAction,
  addRun,
  closeRound,
  feed,
  finishRun,
  getAction,
  holdLock,
  getRun,
  latestRun,
  openCrewStore,
  openLock,
  openRounds,
  recentActions,
  recentRuns,
  roundFor,
  roundPanes,
  roundTabs,
  runsOf,
  setAction,
  setRoundTab,
  setRunPane,
  setRunPid,
  type StoredAction,
} from "./crew/store";

/**
 * agent:crew, the crew watcher. Each pass reads GitHub through agent:gate,
 * plans what each in-scope pull request needs next, and acts once per
 * action: it prompts the one seat that must act when that seat is idle,
 * runs fresh reviewers, and tells the owner about READY and judgment calls.
 * Everything it does is also written to the crew feed. It never merges,
 * pushes, approves or writes to GitHub itself.
 */

const USAGE = `Usage: bun run agent:crew -- <command> [options]

  pass [--pr N]... [--dry-run]   One pass: read, plan, act; --dry-run only prints the plan
  watch [--interval SECONDS]     A pass every interval (default 300) until stopped
  status                         Open actions and recent reviewer runs
  feed [--lines N]               The last lines of the crew feed (default 40)
  runs [--pr N] [--lines N]      Reviewer runs: round, RESULT, tokens and how to reopen each
  open --run ID | --pr N --reviewer NAME [--round K]
                                 Reopen a reviewer's session as a chat in a new Herdr tab
  review --pr N --reviewer NAME --head SHA [--since SHA] [--author SEAT] [--run ID]
                                 Run one fresh reviewer now (the watcher starts these itself)

Settings live under "crew" in the gate config (.agents/crew-gate/config.json).`;

/** Kinds whose target is a seat that has to do something. */
const AUTHOR_KINDS = new Set(["fix", "ci", "conflict", "screenshots"]);
const RUN_KINDS = new Set(["review", "confirm"]);
/** A finished reviewer run whose RESULT hasn't shown up by then is stuck. */
const STUCK_MS = 15 * 60_000;
/** Reviewer runs per action, the first included. */
const RUN_ATTEMPTS = 2;
/** Failed prompts to one seat before the owner hears about it. */
const PROMPT_ATTEMPTS = 3;
/** A run whose worker hasn't reported its pid by then never started. */
const START_MS = 3 * 60_000;

export type Seat = { name: string; status: string; focused: boolean };

/** A round tab's name for a PR: its number and its branch's short name. */
export function roundLabel(
  pr: number,
  branch: string | undefined,
  round: number,
) {
  const name = branch?.split("/").slice(1).join("/") || branch;
  return `#${pr}${name ? ` ${name}` : ""} · r${round}`;
}

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

/**
 * Only a seat that is idle and not focused gets a prompt: a prompt types
 * into the seat's input box, and a focused pane may hold someone's draft.
 */
export function promptable(seat: Seat | undefined, settings: CrewSettings) {
  if (!seat) return "no live seat";
  if (settings.neverPrompt.includes(seat.name)) return "never prompted";
  if (seat.focused) return "focused";
  if (seat.status !== "idle" && seat.status !== "done") return seat.status;
  return null;
}

/** An in-scope PR's author seat and branch. */
type Item = { author: string | null; branch: string | undefined };

type PassContext = {
  /** One gate pass over the open PRs (or `prs`): verdicts and what they judged. */
  judge: () => { verdicts: Verdict[]; inputs: GateInput[] };
  crew: Database;
  /** Held while a pass acts; see `openLock`. */
  lock: Database;
  configPath: string;
  dir: string;
  prs: number[];
  dryRun: boolean;
  now: number;
  deps: Deps;
  /** The command that starts a reviewer run, before its own arguments. */
  worker: string[];
};

export function crewPass(context: PassContext) {
  const { crew, configPath, dir, dryRun, now, deps } = context;
  const settings = loadSettings(configPath);
  const feedPath = join(dir, "feed.log");
  const say = (text: string) => {
    if (!dryRun) feed(feedPath, Math.max(now, Date.now()), text);
  };
  // One pass at a time reads and acts: a second process waits for the lock,
  // then reads GitHub after the first has acted, so it never acts on older
  // reads. Each step is committed as it happens, so a crash never forgets a
  // prompt that was already sent. A dry run changes nothing and takes no lock.
  const pass = () => {
    const { verdicts, inputs } = context.judge();
    const live = seats(deps.run);
    const names = [
      ...new Set([...Object.keys(settings.roster), ...live.map((s) => s.name)]),
    ];
    const byNumber = new Map(inputs.map((input) => [input.number, input]));
    const planned: Action[] = [];
    const authors = new Map<number, Item>();
    for (const verdict of verdicts) {
      const input = byNumber.get(verdict.number);
      if (!input || !inScope(input, settings)) continue;
      authors.set(verdict.number, {
        author: authorOf(verdict.number, input.item?.branch, settings, names),
        branch: input.item?.branch,
      });
      planned.push(...plan(verdict, input, settings, names));
    }
    if (dryRun) {
      deps.out(`plan: ${planned.length} action(s) for ${authors.size} PR(s)`);
      for (const entry of planned) deps.out(`  ${entry.kind}\t${entry.text}`);
      return planned;
    }
    act(crew, context, settings, planned, verdicts, live, authors, say);
    return planned;
  };
  return dryRun ? pass() : holdLock(context.lock, pass);
}

/** A notice to the owner that belongs to another action: `<parent>|<suffix>`. */
function notice(parent: Action, suffix: string, text: string): Action {
  return {
    key: `${parent.key}|${suffix}`,
    pr: parent.pr,
    head: parent.head,
    kind: "judgment",
    target: "owner",
    text,
  };
}

function act(
  crew: Database,
  context: PassContext,
  settings: CrewSettings,
  planned: Action[],
  verdicts: Verdict[],
  live: Seat[],
  authors: Map<number, Item>,
  say: (text: string) => void,
) {
  const { prs, now, deps } = context;
  const record = (entry: Action) => {
    if (addAction(crew, entry, now))
      say(`#${entry.pr} plan ${entry.kind} ${entry.target}: ${entry.text}`);
  };
  // Record each action once; a repeat of a finished run means it is stuck.
  for (const entry of planned) {
    record(entry);
    if (!RUN_KINDS.has(entry.kind)) continue;
    const known = getAction(crew, entry.key)!;
    const stuck =
      (known.state === "done" && now - known.updatedAt > STUCK_MS) ||
      known.state === "failed";
    if (stuck)
      record(
        notice(
          entry,
          "stuck",
          `NEEDS-OWNER #${entry.pr} at ${shortSha(entry.head)}: ${entry.target}'s fresh run ${known.state === "failed" ? "failed" : "finished"} without a RESULT on this head; log ${latestRun(crew, entry.key)?.log ?? "missing"}`,
        ),
      );
  }

  // Only a newer head, a merge or a close makes waiting actions moot. On the
  // same head an action this pass didn't plan stays: a rerun, a hold or an
  // unknown mergeable state is temporary, and a reviewer that has just
  // posted is still finishing. A pass over every open PR also retires
  // the actions of PRs no longer open; a reopened PR plans them afresh.
  const observed = new Set(verdicts.map((verdict) => verdict.number));
  const heads = new Map(
    verdicts
      .filter(
        (verdict) => verdict.state !== "MERGED" && verdict.state !== "CLOSED",
      )
      .map((verdict) => [verdict.number, verdict.head]),
  );
  for (const waiting of actionsIn(crew, ["pending", "running"])) {
    if (prs.length && !observed.has(waiting.pr)) continue;
    if (heads.get(waiting.pr) === waiting.head) continue;
    if (waiting.state === "running") {
      const active = latestRun(crew, waiting.key);
      if (active && active.finishedAt === null)
        stopRun(crew, active.id, -15, now, deps);
    }
    setAction(crew, waiting.key, "superseded", now);
    say(`#${waiting.pr} superseded ${waiting.kind} ${waiting.target}`);
  }

  // A pod lasts as long as its PR: each round's tab stays, stopped runs
  // included, for the owner to read until the PR merges or closes.
  // Its tabs close first, chats reopened from its runs included, then the
  // checkouts those chats recreated go. A step that fails keeps the round
  // open, so the next pass tries again.
  for (const round of openRounds(crew)) {
    if (heads.has(round.pr)) continue;
    if (prs.length && !observed.has(round.pr)) continue;
    const tabs = new Set(roundTabs(crew, round.pr, round.round));
    if (round.tab) tabs.add(round.tab);
    let done = true;
    for (const tab of tabs) done = deps.closeTab(tab) && done;
    for (const entry of runsOf(crew, round.pr)) {
      const checkout = checkoutOf(context.dir, entry);
      if (!done || entry.round !== round.round || !existsSync(checkout))
        continue;
      const removed = deps.run([
        "git",
        "-C",
        dirname(dirname(context.dir)),
        "worktree",
        "remove",
        "--force",
        checkout,
      ]);
      if (removed.code !== 0 && existsSync(checkout)) done = false;
    }
    if (!done) {
      say(`#${round.pr} couldn't close round ${round.round} yet; retrying`);
      continue;
    }
    closeRound(crew, round.pr, round.round, now);
    say(`#${round.pr} closed round ${round.round}`);
  }

  settleRuns(crew, settings, now, deps, say);
  // Deliver only what this pass planned from fresh reads, and the owner
  // notices that belong to it: a scoped pass leaves other PRs' queued work
  // alone, and a paused action waits.
  const keys = new Set(planned.map((entry) => entry.key));
  const deliverable = (entry: StoredAction) =>
    keys.has(entry.key.split("|")[0]!);
  deliver(crew, settings, live, authors, deliverable, record, context, say);
}

/**
 * Marks a run finished, then stops whatever pid it has reported by then.
 * The worker reports its pid before it checks whether it was finished, so
 * every interleaving either stops it here or has it see itself finished.
 */
function stopRun(
  crew: Database,
  id: number,
  code: number,
  now: number,
  deps: Deps,
) {
  finishRun(crew, id, code, null, now);
  const pid = getRun(crew, id)?.pid;
  if (pid) deps.kill(pid);
}

/** Turns finished, crashed or overdue reviewer runs into action states. */
function settleRuns(
  crew: Database,
  settings: CrewSettings,
  now: number,
  deps: Deps,
  say: (text: string) => void,
) {
  for (const active of activeRuns(crew)) {
    const overdue =
      now - active.startedAt > settings.runTimeoutMinutes * 60_000;
    if (active.pid !== null && deps.alive(active.pid) && !overdue) continue;
    if (active.pid === null && now - active.startedAt < START_MS) continue;
    // A dead process needs no stop; an overdue one, or one that reports
    // its pid only now, does.
    if (active.pid !== null && !overdue)
      finishRun(crew, active.id, -1, null, now);
    else stopRun(crew, active.id, active.pid === null ? -2 : -14, now, deps);
  }
  for (const running of actionsIn(crew, ["running"])) {
    const last = latestRun(crew, running.key);
    if (!last || last.finishedAt === null) continue;
    if (last.exitCode === 0) {
      setAction(crew, running.key, "done", now);
      say(`#${running.pr} run ${running.target} finished (run ${last.id})`);
    } else if (running.attempts < RUN_ATTEMPTS) {
      setAction(crew, running.key, "pending", now, `exit ${last.exitCode}`);
      say(
        `#${running.pr} run ${running.target} exited ${last.exitCode}; retrying`,
      );
    } else {
      setAction(crew, running.key, "failed", now, `exit ${last.exitCode}`);
      say(
        `#${running.pr} run ${running.target} failed (exit ${last.exitCode})`,
      );
    }
  }
}

function deliver(
  crew: Database,
  settings: CrewSettings,
  live: Seat[],
  authors: Map<number, Item>,
  deliverable: (entry: StoredAction) => boolean,
  record: (entry: Action) => void,
  context: PassContext,
  say: (text: string) => void,
) {
  const { now, deps, dir } = context;
  const pending = () =>
    actionsIn(crew, ["pending"]).filter((entry) => deliverable(entry));

  // One prompt per seat per pass, carrying every action waiting for it.
  // A seat that can't take it gets the owner a notice instead.
  const bySeat = new Map<string, StoredAction[]>();
  for (const entry of pending())
    if (AUTHOR_KINDS.has(entry.kind))
      bySeat.set(entry.target, [...(bySeat.get(entry.target) ?? []), entry]);
  for (const [name, entries] of bySeat) {
    const why = promptable(
      live.find((seat) => seat.name === name),
      settings,
    );
    if (why) {
      for (const entry of entries) {
        if (entry.detail === why) continue;
        setAction(crew, entry.key, "pending", now, why);
        say(`#${entry.pr} waiting for ${name} (${why})`);
        if (why === "no live seat" || why === "never prompted")
          record(
            notice(
              entry,
              `waits-${digest(why)}`,
              `#${entry.pr} waits for ${name} (${why}): ${entry.text}`,
            ),
          );
      }
      continue;
    }
    const text = entries.map((entry) => entry.text).join("\n");
    const result = deps.run(["herdr", "agent", "prompt", name, text]);
    for (const entry of entries) {
      if (result.code === 0) {
        setAction(crew, entry.key, "sent", now, null, true);
        say(`#${entry.pr} prompted ${name}: ${entry.kind}`);
      } else {
        const error = (result.stderr || result.stdout).trim().slice(0, 200);
        setAction(crew, entry.key, "pending", now, error, true);
        say(`#${entry.pr} prompt to ${name} refused: ${error}`);
        if (entry.attempts + 1 >= PROMPT_ATTEMPTS)
          record(
            notice(entry, "unreachable", `Can't reach ${name}: ${entry.text}`),
          );
      }
    }
  }

  // Fresh reviewers, up to the run limit. The run row is committed before
  // the launch, so a crash still counts it against the limit.
  let slots = settings.maxRuns - activeRuns(crew).length;
  for (const entry of pending()) {
    if (!RUN_KINDS.has(entry.kind) || slots <= 0) continue;
    const log = join(
      dir,
      "runs",
      `${entry.pr}-${entry.target}-${shortSha(entry.head)}-${now}.log`,
    );
    const round = roundFor(crew, entry.pr, entry.head, now);
    const panes = roundPanes(crew, entry.pr, round.round);
    const id = addRun(
      crew,
      {
        actionKey: entry.key,
        reviewer: entry.target,
        pr: entry.pr,
        head: entry.head,
        log,
        round: round.round,
      },
      now,
    );
    setAction(crew, entry.key, "running", now, `run ${id}`, true);
    const item = authors.get(entry.pr);
    const author = item?.author;
    const argv = [
      ...context.worker,
      "review",
      "--pr",
      String(entry.pr),
      "--reviewer",
      entry.target,
      "--head",
      entry.head,
      "--run",
      String(id),
      ...(entry.since ? ["--since", entry.since] : []),
      ...(author ? ["--author", author] : []),
    ];
    Bun.write(log, "");
    const label = roundLabel(entry.pr, item?.branch, round.round);
    const started = deps.spawn(argv, log, {
      tab: round.tab,
      after: panes.at(-1) ?? null,
      direction: panes.length % 2 ? "right" : "down",
      label,
      title: entry.target,
    });
    if (started.pid !== null) setRunPid(crew, id, started.pid);
    if (started.pane) setRunPane(crew, id, started.pane, started.tab);
    if (started.tab && started.tab !== round.tab)
      setRoundTab(crew, entry.pr, round.round, started.tab);
    say(
      `#${entry.pr} started ${entry.target} ${entry.kind} (run ${id}${started.pane ? `, Herdr tab "${label}"` : ""}, log ${log})`,
    );
    slots--;
  }

  // Owner notices last, so those raised above go out in this pass. One
  // Herdr didn't show stays pending and is tried again next pass.
  for (const entry of pending()) {
    if (entry.target !== "owner") continue;
    // A notice about a seat holds only while its step still waits for the
    // same reason; once the seat takes the prompt or the cause changes, drop it.
    const [parentKey, suffix] = entry.key.split("|");
    if (suffix?.startsWith("waits") || suffix === "unreachable") {
      const parent = getAction(crew, parentKey!);
      const cause = parent?.detail ?? "";
      // A bare `waits` suffix comes from stores written before notices
      // carried their cause; it held only for a missing or never-prompted seat.
      const holds =
        parent?.state === "pending" &&
        (suffix === "unreachable" ||
          suffix === `waits-${digest(cause)}` ||
          (suffix === "waits" &&
            (cause === "no live seat" || cause === "never prompted")));
      if (!holds) {
        setAction(crew, entry.key, "superseded", now);
        say(`#${entry.pr} dropped notice: its cause has cleared`);
        continue;
      }
    }
    const result = deps.run([
      "herdr",
      "notification",
      "show",
      entry.kind === "ready"
        ? `Crew: READY #${entry.pr}`
        : `Crew: #${entry.pr} needs you`,
      "--body",
      entry.text,
      "--sound",
      entry.kind === "ready" ? "done" : "request",
    ]);
    if (result.code !== 0) {
      const error = (result.stderr || result.stdout).trim().slice(0, 200);
      setAction(crew, entry.key, "pending", now, error, true);
      if (entry.detail !== error)
        say(`#${entry.pr} notification failed: ${error}`);
      continue;
    }
    setAction(crew, entry.key, "sent", now, null, true);
    say(`#${entry.pr} told owner: ${entry.text}`);
  }
}

export function parseOptions(argv: string[]): Options {
  const options: Options = {
    command: "",
    prs: [],
    dryRun: false,
    interval: 300,
    lines: 40,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    const value = () => {
      const next = argv[++index];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    const count = (label: string) => {
      const parsed = Number(value().replace(/^#/u, ""));
      if (!Number.isSafeInteger(parsed) || parsed < 0)
        throw new Error(`${label} needs a number`);
      return parsed;
    };
    if (arg === "--pr") options.prs.push(count("--pr"));
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--interval") options.interval = count("--interval");
    else if (arg === "--lines") options.lines = count("--lines");
    else if (arg === "--reviewer") options.reviewer = value();
    else if (arg === "--head") options.head = value();
    else if (arg === "--since") options.since = value();
    else if (arg === "--author") options.author = value();
    else if (arg === "--run") options.run = count("--run");
    else if (arg === "--round")
      options.round = Number(value().replace(/^r/u, "")) || 0;
    else if (arg.startsWith("--") || options.command)
      throw new Error(`Unknown argument ${arg}\n\n${USAGE}`);
    else options.command = arg;
  }
  if (!options.command) throw new Error(USAGE);
  return options;
}

function status(crew: Database, out: (text: string) => void, now: number) {
  const open = actionsIn(crew, ["pending", "running"]);
  out(`${open.length} open action(s)`);
  for (const entry of open)
    out(
      `  ${entry.state}\t#${entry.pr} ${entry.kind} ${entry.target}${entry.detail ? ` (${entry.detail})` : ""}`,
    );
  out("recent actions");
  for (const entry of recentActions(crew, 10))
    out(
      `  ${entry.state}\t#${entry.pr} ${entry.kind} ${entry.target} ${Math.round((now - entry.updatedAt) / 60_000)} min ago`,
    );
  out("recent runs");
  for (const entry of recentRuns(crew, 10))
    out(
      `  run ${entry.id}\t#${entry.pr} ${entry.reviewer} @${shortSha(entry.head)} ${entry.finishedAt === null ? "running" : `exit ${entry.exitCode}`}${entry.usage ? ` usage ${entry.usage}` : ""}`,
    );
}

export async function main(argv: string[], deps: Deps = realDeps) {
  const options = parseOptions(argv);
  const dir = gateDir();
  if (options.command === "review") return review(options, dir, deps);
  const crew = openCrewStore(join(dir, "crew.sqlite"));
  try {
    if (options.command === "status") {
      status(crew, deps.out, Date.now());
      return 0;
    }
    if (options.command === "runs") {
      runs(crew, options, deps.out);
      return 0;
    }
    if (options.command === "open") {
      const lock = openLock(join(dir, "crew.lock"));
      try {
        return openChat(crew, options, dir, lock, deps);
      } finally {
        lock.close();
      }
    }
    if (options.command === "feed") {
      const path = join(dir, "feed.log");
      const lines = existsSync(path)
        ? readFileSync(path, "utf8").trimEnd().split("\n")
        : [];
      for (const text of lines.slice(-options.lines)) deps.out(text);
      return 0;
    }
    if (options.command !== "pass" && options.command !== "watch")
      throw new Error(`Unknown command ${options.command}\n\n${USAGE}`);
    const lock = openLock(join(dir, "crew.lock"));
    const gate = openStore(join(dir, "gate.sqlite"));
    const worker = ["bun", join(import.meta.dir, "crew.ts")];
    try {
      for (;;) {
        const now = Date.now();
        try {
          const planned = crewPass({
            judge: () =>
              runPass(
                gate,
                {
                  config: loadConfig(join(dir, "config.json")),
                  run: deps.run,
                  mirror: join(dir, "mirror.git"),
                  now,
                },
                options.prs,
              ),
            crew,
            lock,
            configPath: join(dir, "config.json"),
            dir,
            prs: options.prs,
            dryRun: options.dryRun,
            now,
            deps,
            worker,
          });
          if (!options.dryRun)
            deps.out(
              `${new Date(now).toISOString()} pass: ${planned.length} planned, ${actionsIn(crew, ["pending", "running"]).length} open`,
            );
        } catch (error) {
          // A failed read costs one pass; the next pass reads everything again.
          deps.out(
            `pass failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          if (options.command === "pass") return 1;
        }
        if (options.command === "pass") return 0;
        await Bun.sleep(options.interval * 1000);
      }
    } finally {
      gate.close();
      lock.close();
    }
  } finally {
    crew.close();
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
