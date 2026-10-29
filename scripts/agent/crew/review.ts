import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { shortSha } from "../../../shared/pullRequests";
import { loadConfig } from "../gate";
import type { Deps } from "./deps";
import { shellLine } from "./deps";
import { loadSettings } from "./plan";
import {
  addChat,
  addRun,
  finishRun,
  getRun,
  holdLock,
  openCrewStore,
  recentRuns,
  roundClosed,
  runsOf,
  setRunPid,
  setRunSession,
  type StoredRun,
} from "./store";
import {
  chatArgv,
  findCodexSession,
  harnessOf,
  readUsage,
  reviewerArgv,
  reviewerPrompt,
} from "./worker";

/**
 * The reviewer-run side of agent:crew: the worker that runs one fresh
 * reviewer in its round's pane, the run listing, and reopening a run as a chat.
 */

export type Options = {
  command: string;
  prs: number[];
  dryRun: boolean;
  interval: number;
  busyInterval: number;
  lines: number;
  reviewer?: string;
  head?: string;
  since?: string;
  author?: string;
  run?: number;
  round?: number;
  /** Words after the command, as in `seat start <seat>`. */
  args: string[];
  /** `status`: the window, in hours, for reviewer token totals. */
  hours: number;
};

/** A run's own detached checkout below the primary checkout's worktrees. */
export function checkoutOf(
  dir: string,
  run: Pick<StoredRun, "id" | "pr" | "reviewer" | "head">,
) {
  return join(
    dirname(dirname(dir)),
    ".agents",
    "worktrees",
    `review-${run.pr}-${run.reviewer}-${shortSha(run.head)}-${run.id}`,
  );
}

/** How to reopen a run as a chat, for its pane's footer and `runs`. */
const reopen = (id: number) => `bun run agent:crew -- open --run ${id}`;

/**
 * Runs one fresh reviewer in its own detached checkout, then removes it.
 * Its pane keeps what it showed, with a footer saying how it ended.
 */
export async function review(options: Options, dir: string, deps: Deps) {
  const { reviewer, head } = options;
  const pr = options.prs[0];
  if (!pr || !reviewer || !head || !/^[0-9a-f]{40}$/u.test(head))
    throw new Error("review needs --pr, --reviewer and a full 40-hex --head");
  const configPath = join(dir, "config.json");
  const config = loadConfig(configPath);
  const settings = loadSettings(configPath);
  const model = settings.roster[reviewer];
  if (!model) throw new Error(`${reviewer} has no roster model`);
  const crew = openCrewStore(join(dir, "crew.sqlite"));
  const runId =
    options.run ??
    addRun(
      crew,
      {
        actionKey: `manual:${pr}:${head}:${reviewer}`,
        reviewer,
        pr,
        head,
        log: "stdout",
      },
      Date.now(),
    );
  const logPath = getRun(crew, runId)?.log;
  const logged = logPath && logPath !== "stdout" ? logPath : null;
  const show = (text: string) => {
    deps.out(text);
    if (logged) appendFileSync(logged, `${text}\n`);
  };
  const primary = dirname(dirname(dir));
  const checkout = checkoutOf(dir, { id: runId, pr, reviewer, head });
  const git = (...args: string[]) => deps.run(["git", "-C", primary, ...args]);
  const cleanup = () => {
    if (existsSync(checkout)) git("worktree", "remove", "--force", checkout);
  };
  // Report the pid first: a pass that supersedes the run from then on stops
  // this process, and one that came before has already marked it finished.
  setRunPid(crew, runId, process.pid);
  if ((getRun(crew, runId)?.finishedAt ?? null) !== null) {
    show("── stopped before it started: a newer head superseded this run");
    crew.close();
    return 143;
  }
  const harness = harnessOf(model) ?? "codex";
  setRunSession(crew, runId, harness, model.model, null);
  process.on("SIGTERM", () => {
    show(`── stopped: a newer head made this review stale`);
    show(`   reopen as a chat: ${reopen(runId)}`);
    cleanup();
    process.exit(143);
  });
  let code = 1;
  let usage: string | null = null;
  try {
    const fetched = git("fetch", "--quiet", "origin", `pull/${pr}/head`);
    if (fetched.code !== 0) throw new Error(`fetch failed: ${fetched.stderr}`);
    const added = git("worktree", "add", "--detach", checkout, head);
    if (added.code !== 0) throw new Error(`worktree failed: ${added.stderr}`);
    const view = deps.run([
      "gh",
      "pr",
      "view",
      String(pr),
      "--repo",
      config.repo,
      "--json",
      "title,url,headRefName",
    ]);
    const meta =
      view.code === 0
        ? (JSON.parse(view.stdout) as {
            title: string;
            url: string;
            headRefName: string;
          })
        : {
            title: "",
            url: `https://github.com/${config.repo}/pull/${pr}`,
            headRefName: "",
          };
    const prompt = reviewerPrompt({
      repo: config.repo,
      pr,
      head,
      reviewer,
      ...(options.since ? { since: options.since } : {}),
      title: meta.title,
      url: meta.url,
      branch: meta.headRefName,
      author: options.author ?? null,
    });
    show(
      `${reviewer} ${options.since ? "confirms" : "reviews"} #${pr} at ${shortSha(head)} (${model.model}); type here to steer it`,
    );
    // The harness takes this pane's terminal: the owner watches it work,
    // can type to it, and keeps it as a chat after it posts. The watcher
    // marks the review done once its RESULT is on GitHub.
    const session = harness === "claude" ? randomUUID() : null;
    if (session) setRunSession(crew, runId, harness, model.model, session);
    const started = Date.now();
    // Ctrl-C in the pane is for the harness; this process waits for it.
    process.on("SIGINT", () => {});
    const child = Bun.spawn(reviewerArgv(model, prompt, session), {
      cwd: checkout,
      stdio: ["inherit", "inherit", "inherit"],
    });
    // Codex names its session itself; find it once its rollout exists.
    let named = harness !== "codex";
    const finding = setInterval(() => {
      if (named) return;
      const found = findCodexSession(checkout, started - 5_000);
      if (!found) return;
      setRunSession(crew, runId, harness, model.model, found);
      named = true;
    }, 3_000);
    code = await child.exited;
    clearInterval(finding);
    const run = getRun(crew, runId);
    usage = readUsage({
      harness,
      session: run?.session ?? null,
      cwd: checkout,
    });
    show(
      `── session ended (exit ${code}) · ${run?.result ?? "no RESULT posted"}`,
    );
    if (run?.session) show(`   reopen as a chat: ${reopen(runId)}`);
  } catch (error) {
    show(error instanceof Error ? error.message : String(error));
    show(`── failed to start`);
    code = 1;
  } finally {
    cleanup();
    finishRun(crew, runId, code, usage, Date.now());
    crew.close();
  }
  return code;
}

/** Input and output tokens from a run's recorded usage. */
function tokens(usage: string | null) {
  if (!usage) return "";
  const value = JSON.parse(usage) as Record<string, number | undefined>;
  const input =
    (value.input_tokens ?? 0) +
    (value.cache_read_input_tokens ?? 0) +
    (value.cache_creation_input_tokens ?? 0);
  const k = (count: number) => `${Math.round(count / 1000)}k`;
  return ` in ${k(input)} out ${k(value.output_tokens ?? 0)}`;
}

export function runs(
  crew: Database,
  options: Pick<Options, "prs" | "lines">,
  out: (text: string) => void,
) {
  const list = options.prs[0]
    ? runsOf(crew, options.prs[0]).slice(0, options.lines)
    : recentRuns(crew, options.lines);
  for (const entry of list)
    out(
      `run ${entry.id}\t#${entry.pr} r${entry.round ?? "?"} ${entry.reviewer} @${shortSha(entry.head)} ${entry.finishedAt === null ? "running" : `exit ${entry.exitCode}`}${entry.result ? ` · ${entry.result}` : ""}${tokens(entry.usage)}${entry.session ? ` · ${reopen(entry.id)}` : ""}`,
    );
  if (!list.length) out("no reviewer runs");
}

/**
 * Reopens a run's harness session as an interactive chat in its own
 * checkout, recreated at the same path when the run has removed it, so the
 * harness finds the session and the reviewer can look at the code again.
 * The chat tab closes with the run's round; once that round has closed,
 * the chat removes its checkout itself when it exits.
 */
export function openChat(
  crew: Database,
  options: Pick<Options, "prs" | "reviewer" | "round" | "run">,
  dir: string,
  lock: Database,
  deps: Deps,
) {
  const found = options.run
    ? getRun(crew, options.run)
    : options.prs[0] && options.reviewer
      ? (runsOf(crew, options.prs[0], options.reviewer).find(
          (entry) => !options.round || entry.round === options.round,
        ) ?? null)
      : null;
  if (!found)
    throw new Error(
      "open needs --run ID, or --pr N --reviewer NAME [--round K]",
    );
  if (!found.session || !found.harness)
    throw new Error(`run ${found.id} recorded no session to reopen`);
  // A reviewer whose session is still open is talked to in its own pane;
  // a second copy would lose its checkout when the first one exits.
  if (found.pid !== null && deps.alive(found.pid))
    throw new Error(
      `run ${found.id}'s session is still open in its pane, ${found.reviewer} in the PR's round ${found.round ?? "?"} tab; talk to it there`,
    );
  const primary = dirname(dirname(dir));
  const checkout = checkoutOf(dir, found);
  const remove = [
    "git",
    "-C",
    primary,
    "worktree",
    "remove",
    "--force",
    checkout,
  ];
  // Under the pass lock: a pass can't close the round between this check
  // and the chat being recorded, so either the round's cleanup closes the
  // chat, or the chat cleans up after a closed round.
  return holdLock(lock, () => {
    const closed = roundClosed(crew, found.pr, found.round);
    // After its round, a checkout that still exists belongs to a chat
    // that will remove it on exit; a second chat there would lose it.
    if (closed && existsSync(checkout))
      throw new Error(
        `a chat for run ${found.id} may still be open in ${checkout}; exit it first, or remove the checkout with: ${shellLine(remove)}`,
      );
    if (!existsSync(checkout)) {
      // The head is usually still in the object store; fetch it if not.
      deps.run([
        "git",
        "-C",
        primary,
        "fetch",
        "--quiet",
        "origin",
        `pull/${found.pr}/head`,
      ]);
      const added = deps.run([
        "git",
        "-C",
        primary,
        "worktree",
        "add",
        "--detach",
        checkout,
        found.head,
      ]);
      if (added.code !== 0)
        throw new Error(
          `couldn't recreate ${checkout}: ${added.stderr.trim()}`,
        );
    }
    // The run's own model: the roster may have moved the seat since.
    let line = shellLine(chatArgv(found.harness!, found.session!, found.model));
    if (closed) line += `; ${shellLine(remove)}`;
    const label = `#${found.pr} ${found.reviewer} r${found.round ?? "?"} · chat`;
    const tab = deps.openTab(line, checkout, label);
    if (tab) {
      addChat(crew, tab, found.id);
      deps.out(
        `opened "${label}"${closed ? "; exit the chat to remove its checkout" : ""}`,
      );
    } else
      deps.out(
        `Herdr couldn't open a tab; run:\n  cd ${shellLine([checkout])} && ${line}`,
      );
    return 0;
  });
}
