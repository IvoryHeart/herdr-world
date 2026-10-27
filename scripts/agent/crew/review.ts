import type { Database } from "bun:sqlite";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
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
  openCrewStore,
  recentRuns,
  roundClosed,
  runsOf,
  setRunPid,
  setRunResult,
  setRunSession,
  type StoredRun,
} from "./store";
import {
  chatArgv,
  describe,
  finalMessage,
  harnessArgv,
  harnessFor,
  parseUsage,
  resultLine,
  reviewerPrompt,
  sessionOf,
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
  lines: number;
  reviewer?: string;
  head?: string;
  since?: string;
  author?: string;
  run?: number;
  round?: number;
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
  const harness = harnessFor(model.model) ?? "codex";
  setRunSession(crew, runId, harness, model.model, null);
  process.on("SIGTERM", () => {
    show(`── stopped: a newer head or the owner ended this run`);
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
    const lastMessage = join(checkout, ".crew-last-message.txt");
    show(
      `${reviewer} ${options.since ? "confirms" : "reviews"} #${pr} at ${shortSha(head)} (${model.model})`,
    );
    const child = Bun.spawn(harnessArgv(model, prompt, lastMessage), {
      cwd: checkout,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "inherit",
    });
    // Show each event as it happens. The whole stream is kept beside the
    // log, and the session it names lets the owner reopen it as a chat.
    let stdout = "";
    let partial = "";
    let session: string | null = null;
    const decoder = new TextDecoder();
    for await (const chunk of child.stdout) {
      const text = decoder.decode(chunk, { stream: true });
      stdout += text;
      if (logged) appendFileSync(`${logged}.jsonl`, text);
      const lines = (partial + text).split("\n");
      partial = lines.pop() ?? "";
      for (const line of lines) {
        if (!session && (session = sessionOf(line)))
          setRunSession(crew, runId, harness, model.model, session);
        const shown = describe(line);
        if (shown) show(shown);
      }
    }
    code = await child.exited;
    const parsed = parseUsage(stdout);
    usage = parsed ? JSON.stringify(parsed) : null;
    // Codex writes its final message to a file; Claude ends its stream with it.
    const written = existsSync(lastMessage)
      ? readFileSync(lastMessage, "utf8").trim()
      : "";
    if (written) show(written);
    const result = resultLine(written || finalMessage(stdout), pr);
    if (result) setRunResult(crew, runId, result);
    show(`── finished: ${result ?? "no RESULT"} · exit ${code}`);
    show(`   usage ${usage ?? "unknown"}`);
    if (session) show(`   reopen as a chat: ${reopen(runId)}`);
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
  const primary = dirname(dirname(dir));
  const checkout = checkoutOf(dir, found);
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
      throw new Error(`couldn't recreate ${checkout}: ${added.stderr.trim()}`);
  }
  // The run's own model: the roster may have moved the seat since.
  let line = shellLine(chatArgv(found.harness, found.session, found.model));
  const closed = roundClosed(crew, found.pr, found.round);
  if (closed)
    line += `; ${shellLine(["git", "-C", primary, "worktree", "remove", "--force", checkout])}`;
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
}
