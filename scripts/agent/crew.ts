import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { shortSha } from "../../shared/pullRequests";
import { gateDir, loadConfig, runPass } from "./gate";
import type { GateInput, Verdict } from "./gate/predicate";
import { openStore } from "./gate/store";
import { type Deps, realDeps } from "./crew/deps";
import {
  type Action,
  authorOf,
  busyPrs,
  digest,
  type CrewSettings,
  currentChecks,
  inScope,
  isOnHold,
  marks,
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
import { markDue, markHeads } from "./crew/marks";
import {
  crewCodeVersion,
  noticeStaleWatcher,
  type Seat,
  seats,
  startSeat,
} from "./crew/seats";

export { type Seat, seats } from "./crew/seats";
import { showStatus } from "./crew/status";
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
  roundFor,
  roundPanes,
  roundTabs,
  runningSince,
  runsOf,
  setAction,
  setMeta,
  setRoundTab,
  setRunPane,
  setRunPid,
  setRunResult,
  type StoredAction,
} from "./crew/store";

/**
 * agent:crew, the crew watcher. Each pass reads GitHub through agent:gate,
 * plans what each in-scope pull request needs next, and acts once per
 * action: it prompts the one seat that must act when that seat is idle,
 * runs fresh reviewers, and tells the owner about READY and judgment calls.
 * Everything it does is also written to the crew feed. On GitHub it only
 * sets its own `merge-ready` and `needs-owner` labels and posts one signed
 * `[crew]` comment per cause it needs the owner for; it never merges,
 * pushes or approves.
 */

const USAGE = `Usage: bun run agent:crew -- <command> [options]

  pass [--pr N]... [--dry-run]   One pass: read, plan, act; --dry-run only prints the plan
  watch [--interval SECONDS] [--busy-interval SECONDS]
                                 A pass over every PR every interval (default 300) and,
                                 between them, over busy PRs every busy interval (default 60)
  status [--hours N]             Held PRs, open actions, recent reviewer runs, reviewer tokens
                                 per PR, pod and track over the last N hours (default 24),
                                 seats missing from the roster and a watcher on old code
  seat start SEAT                Start a roster seat in a new Herdr tab on exactly its roster
                                 harness, model, effort and persona
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

/** A round tab's name for a PR: its number and its branch's short name. */
export function roundLabel(
  pr: number,
  branch: string | undefined,
  round: number,
) {
  const name = branch?.split("/").slice(1).join("/") || branch;
  return `#${pr}${name ? ` ${name}` : ""} · r${round}`;
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

/**
 * An in-scope PR's author seat and branch, and each reviewer's latest
 * RESULT line with the commit it was posted on.
 */
type Item = {
  author: string | null;
  branch: string | undefined;
  posted: Map<string, { commit: string; line: string }>;
};

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
    // How long each running check of an in-scope PR has been running, as
    // far as this watcher has seen. An older attempt a rerun replaced
    // doesn't count. A dry run reads the times without recording any.
    const running = (input: GateInput) =>
      currentChecks(input).filter(
        (check) => check.state === "pending" && check.url,
      );
    const runningChecks = verdicts.flatMap((verdict) => {
      const input = byNumber.get(verdict.number);
      return input && inScope(input, settings) ? running(input) : [];
    });
    const since = runningSince(
      crew,
      runningChecks.map((check) => check.url!),
      now,
      { record: !dryRun, forget: !dryRun && context.prs.length === 0 },
    );
    const planned: Action[] = [];
    const authors = new Map<number, Item>();
    for (const verdict of verdicts) {
      const input = byNumber.get(verdict.number);
      if (!input || !inScope(input, settings)) continue;
      // A post with no RESULT line, such as a header-only note, isn't one.
      const posted: Item["posted"] = new Map();
      for (const claim of input.item?.pr?.reviewers ?? [])
        if (claim.reviewer && claim.commit && claim.line.trim())
          posted.set(claim.reviewer, {
            commit: claim.commit,
            line: `RESULT #${verdict.number}: ${claim.line.trim()}`,
          });
      authors.set(verdict.number, {
        author: authorOf(verdict.number, input.item?.branch, settings, names),
        branch: input.item?.branch,
        posted,
      });
      const stalls = running(input).map((check) => ({
        name: check.name,
        url: check.url!,
        minutes: Math.floor((now - (since.get(check.url!) ?? now)) / 60_000),
      }));
      planned.push(...plan(verdict, input, settings, names, stalls));
    }
    if (dryRun) {
      deps.out(`plan: ${planned.length} action(s) for ${authors.size} PR(s)`);
      for (const entry of planned) deps.out(`  ${entry.kind}\t${entry.text}`);
      const owed = new Map<number, string[]>();
      for (const entry of planned)
        if (entry.kind === "judgment")
          owed.set(entry.pr, [...(owed.get(entry.pr) ?? []), entry.text]);
      for (const verdict of verdicts) {
        const input = byNumber.get(verdict.number);
        if (!input) continue;
        const due = marks(
          verdict,
          input,
          settings,
          owed.get(verdict.number) ?? [],
        );
        for (const mark of due)
          if (markDue(crew, verdict.number, verdict.head!, mark))
            deps.out(
              `  mark\t#${verdict.number} ${mark.context} ${mark.state}: ${mark.description}`,
            );
      }
      return planned;
    }
    act(crew, context, settings, planned, verdicts, inputs, live, authors, say);
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
  inputs: GateInput[],
  live: Seat[],
  authors: Map<number, Item>,
  say: (text: string) => void,
) {
  const { prs, now, deps } = context;
  // Each PR's causes for the owner that hold this pass: a planned judgment,
  // or a notice raised again because its cause still holds. Local paths
  // stay local in everything GitHub shows.
  const causes = new Map<number, string[]>();
  const root = dirname(dirname(context.dir));
  const publicText = (text: string) => text.replaceAll(`${root}/`, "");
  const owe = (entry: Action) =>
    causes.set(entry.pr, [
      ...(causes.get(entry.pr) ?? []),
      publicText(entry.text).replace(
        /^(?:NEEDS-OWNER )?#\d+ (?:at \w+: )?/u,
        "",
      ),
    ]);
  const record = (entry: Action) => {
    if (entry.target === "owner" && entry.kind === "judgment") {
      owe(entry);
      // Its signed GitHub comment, posted once.
      addAction(
        crew,
        {
          ...entry,
          key: `${entry.key}|github`,
          target: "github",
          text: `[crew] ${publicText(entry.text)}`,
        },
        now,
      );
    }
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
  // A review is done once its RESULT is on GitHub for the head it was
  // given, whatever its session has done since: it may have posted just
  // before a newer push, or ended before this pass saw the post. A session
  // still open stays in its pane as a chat until the PR closes.
  for (const entry of actionsIn(crew, [
    "pending",
    "running",
    "failed",
    "done",
  ])) {
    const claim = RUN_KINDS.has(entry.kind)
      ? authors.get(entry.pr)?.posted.get(entry.target)
      : undefined;
    if (claim?.commit !== entry.head) continue;
    const run = latestRun(crew, entry.key);
    if (run && run.result === null) setRunResult(crew, run.id, claim.line);
    if (run && run.finishedAt === null)
      finishRun(
        crew,
        run.id,
        0,
        deps.usage(run, checkoutOf(context.dir, run)),
        now,
      );
    if (entry.state === "done") continue;
    setAction(crew, entry.key, "done", now);
    say(
      `#${entry.pr} ${entry.target} posted ${claim.line}; its session stays open as a chat`,
    );
  }

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

  // A PR parked with a hold or out of the watcher's scope gets no steps, so
  // the ones still waiting are retired; planning them again revives them.
  const parked = new Map<number, string>();
  for (const input of inputs) {
    if (input.state !== "OPEN") continue;
    const verdict = verdicts.find((entry) => entry.number === input.number);
    const held =
      isOnHold(input) ||
      verdict?.conditions.some(
        (entry) => entry.id === "hold" && entry.state === "unmet",
      );
    if (!inScope(input, settings)) parked.set(input.number, "out of scope");
    else if (held) parked.set(input.number, "on hold");
  }
  for (const waiting of actionsIn(crew, ["pending"])) {
    const why = parked.get(waiting.pr);
    if (!why) continue;
    setAction(crew, waiting.key, "superseded", now, why);
    say(`#${waiting.pr} retired ${waiting.kind} ${waiting.target}: ${why}`);
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

  settleRuns(crew, settings, now, deps, record, say);
  // Deliver only what this pass planned from fresh reads, and the owner
  // notices that belong to it: a scoped pass leaves other PRs' queued work
  // alone, and a paused action waits.
  const keys = new Set(planned.map((entry) => entry.key));
  const deliverable = (entry: StoredAction) =>
    keys.has(entry.key.split("|")[0]!);
  deliver(crew, settings, live, authors, deliverable, record, context, say);

  // A notice about a seat that still holds keeps the owner's mark on.
  for (const entry of actionsIn(crew, ["pending", "sent"]))
    if (
      entry.target === "owner" &&
      noticeHolds(crew, entry) === true &&
      !causes.get(entry.pr)?.length
    )
      owe(entry);
  markHeads(crew, context, settings, verdicts, inputs, causes, say);
}

/**
 * Whether a notice about a seat still holds: only while its step waits for
 * the same reason. Null for a notice that isn't about a seat.
 */
function noticeHolds(crew: Database, entry: StoredAction) {
  const [parentKey, suffix] = entry.key.split("|");
  if (!suffix?.startsWith("waits") && suffix !== "unreachable") return null;
  const parent = getAction(crew, parentKey!);
  const cause = parent?.detail ?? "";
  // A bare `waits` suffix comes from stores written before notices
  // carried their cause; it held only for a missing or never-prompted seat.
  return (
    parent?.state === "pending" &&
    (suffix === "unreachable" ||
      suffix === `waits-${digest(cause)}` ||
      (suffix === "waits" &&
        (cause === "no live seat" || cause === "never prompted")))
  );
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
  record: (entry: Action) => void,
  say: (text: string) => void,
) {
  for (const active of activeRuns(crew)) {
    if (active.pid !== null && deps.alive(active.pid)) {
      // A reviewer still working past the limit is the owner's to look at:
      // it may be waiting on them, or they may be talking to it.
      const action = getAction(crew, active.actionKey);
      const minutes = Math.round((now - active.startedAt) / 60_000);
      if (minutes > settings.runTimeoutMinutes && action?.state === "running")
        record(
          notice(
            action,
            "overdue",
            `NEEDS-OWNER #${action.pr} at ${shortSha(action.head)}: ${action.target} has worked ${settings.runTimeoutMinutes}+ minutes without posting; look at its pane in the round's tab.`,
          ),
        );
      continue;
    }
    if (active.pid === null && now - active.startedAt < START_MS) continue;
    // A dead process needs no stop; one that reports its pid only now does.
    if (active.pid !== null) finishRun(crew, active.id, -1, null, now);
    else stopRun(crew, active.id, -2, now, deps);
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

  // Each owner notice's signed comment, once, so GitHub shows what the PR
  // waits for. One whose notice was dropped before it went out is dropped
  // too; one GitHub refused is tried again next pass.
  const repo = loadConfig(context.configPath).repo;
  for (const entry of pending()) {
    if (entry.target !== "github") continue;
    const owner = getAction(crew, entry.key.slice(0, -"|github".length));
    if (
      owner?.state === "superseded" ||
      (owner && noticeHolds(crew, owner) === false)
    ) {
      setAction(crew, entry.key, "superseded", now);
      continue;
    }
    const result = deps.run([
      "gh",
      "api",
      "-X",
      "POST",
      `repos/${repo}/issues/${entry.pr}/comments`,
      "-f",
      `body=${entry.text}`,
    ]);
    if (result.code === 0) {
      setAction(crew, entry.key, "sent", now, null, true);
      say(`#${entry.pr} commented: ${entry.text}`);
    } else {
      const error = (result.stderr || result.stdout).trim().slice(0, 200);
      setAction(crew, entry.key, "pending", now, error, true);
      if (entry.detail !== error) say(`#${entry.pr} comment failed: ${error}`);
    }
  }

  // Owner notices last, so those raised above go out in this pass. One
  // Herdr didn't show stays pending and is tried again next pass.
  for (const entry of pending()) {
    if (entry.target !== "owner") continue;
    // A notice about a seat holds only while its step still waits for the
    // same reason; once the seat takes the prompt or the cause changes, drop it.
    if (noticeHolds(crew, entry) === false) {
      setAction(crew, entry.key, "superseded", now);
      say(`#${entry.pr} dropped notice: its cause has cleared`);
      continue;
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
    busyInterval: 60,
    lines: 40,
    args: [],
    hours: 24,
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
    else if (arg === "--busy-interval") {
      // Zero would read the busy PRs back to back, and GitHub's rate limit
      // with them, for as long as one stays busy.
      options.busyInterval = count("--busy-interval");
      if (options.busyInterval < 1)
        throw new Error("--busy-interval needs at least 1 second");
    } else if (arg === "--lines") options.lines = count("--lines");
    else if (arg === "--reviewer") options.reviewer = value();
    else if (arg === "--head") options.head = value();
    else if (arg === "--since") options.since = value();
    else if (arg === "--author") options.author = value();
    else if (arg === "--run") options.run = count("--run");
    else if (arg === "--round")
      options.round = Number(value().replace(/^r/u, "")) || 0;
    else if (arg === "--hours") options.hours = count("--hours");
    else if (
      arg.startsWith("--") ||
      (options.command && options.command !== "seat")
    )
      throw new Error(`Unknown argument ${arg}\n\n${USAGE}`);
    else if (options.command) options.args.push(arg);
    else options.command = arg;
  }
  if (!options.command) throw new Error(USAGE);
  return options;
}

/**
 * When the watcher's next pass starts and which PRs it reads, `null` being
 * every PR. A pass over every PR starts `interval` seconds after the last
 * one started, however long it took. While PRs are busy, passes over just
 * those start `busyInterval` seconds apart in between: a few seconds each,
 * so a green check, a posted review or a merge is acted on within a minute.
 */
export function nextPass(
  lastFull: number,
  lastStart: number,
  busy: number[],
  options: { interval: number; busyInterval: number },
): { at: number; prs: number[] | null } {
  const full = lastFull + options.interval * 1000;
  const soon = lastStart + options.busyInterval * 1000;
  return busy.length && soon < full
    ? { at: soon, prs: busy }
    : { at: full, prs: null };
}

/**
 * The watcher's schedule between passes: the PRs the next pass reads (null
 * for every PR), when the last pass over every PR started, and the PRs
 * that were busy when last read.
 */
export type Cadence = {
  scope: number[] | null;
  lastFull: number;
  busy: number[];
};

/**
 * The schedule after a pass that started at `start` and found `busy`, or
 * null when it failed: a failed pass keeps the busy PRs it had.
 */
export function afterPass(
  cadence: Cadence,
  start: number,
  busy: number[] | null,
  options: { interval: number; busyInterval: number },
): { cadence: Cadence; at: number } {
  const lastFull = cadence.scope === null ? start : cadence.lastFull;
  const kept = busy ?? cadence.busy;
  const next = nextPass(lastFull, start, kept, options);
  return { cadence: { scope: next.prs, lastFull, busy: kept }, at: next.at };
}

const numbers = (prs: number[]) => prs.map((pr) => `#${pr}`).join(" ");

export async function main(argv: string[], deps: Deps = realDeps) {
  const options = parseOptions(argv);
  const dir = gateDir();
  if (options.command === "review") return review(options, dir, deps);
  const crew = openCrewStore(join(dir, "crew.sqlite"));
  try {
    if (options.command === "status") {
      showStatus(crew, dir, deps.out, Date.now(), {
        live: seats(deps.run),
        hours: options.hours,
        alive: deps.alive,
      });
      return 0;
    }
    if (options.command === "seat") return startSeat(options, dir, deps);
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
    const configPath = join(dir, "config.json");
    let cadence: Cadence = { scope: null, lastFull: 0, busy: [] };
    // The crew code this process runs; a merge changes the checkout's, and
    // only a restart loads it.
    const loaded = crewCodeVersion();
    if (options.command === "watch" && !options.dryRun) {
      setMeta(crew, "watcher.code", loaded);
      setMeta(crew, "watcher.pid", String(process.pid));
    }
    try {
      for (;;) {
        const now = Date.now();
        if (options.command === "watch" && !options.dryRun)
          noticeStaleWatcher(crew, loaded, dir, deps);
        const { scope } = cadence;
        const prs = scope ?? options.prs;
        // Null until the pass has read its PRs; a failed pass keeps the last.
        let busy: number[] | null = null;
        const judged: { value?: ReturnType<typeof runPass> } = {};
        try {
          const planned = crewPass({
            judge: () =>
              (judged.value = runPass(
                gate,
                {
                  config: loadConfig(configPath),
                  run: deps.run,
                  mirror: join(dir, "mirror.git"),
                  now,
                },
                prs,
              )),
            crew,
            lock,
            configPath,
            dir,
            prs,
            dryRun: options.dryRun,
            now,
            deps,
            worker,
          });
          const open = actionsIn(crew, ["pending", "running"]);
          if (judged.value)
            busy = busyPrs(
              judged.value.verdicts,
              judged.value.inputs,
              loadSettings(configPath),
              open.map((entry) => entry.pr),
            );
          if (!options.dryRun)
            deps.out(
              `${new Date(now).toISOString()} pass${scope ? ` ${numbers(scope)}` : ""}: ${planned.length} planned, ${open.length} open${busy?.length ? `; busy ${numbers(busy)}` : ""}`,
            );
        } catch (error) {
          // A failed read costs one pass. Its PRs keep their last busy
          // state, and the next pass over every PR still comes an interval
          // after the last one started, as `afterPass` decides.
          deps.out(
            `pass failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          if (options.command === "pass") return 1;
        }
        if (options.command === "pass") return 0;
        const next = afterPass(cadence, now, busy, options);
        cadence = next.cadence;
        await Bun.sleep(Math.max(0, next.at - Date.now()));
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
