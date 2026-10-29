import type { Database } from "bun:sqlite";
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { shortSha } from "../../../shared/pullRequests";
import { loadConfig } from "../gate";
import type { Run } from "../gate/observe";
import type { Deps } from "./deps";
import { launchRun } from "./launch";
import { type CrewSettings, loadSettings } from "./plan";
import { type Options, prMeta, runSession } from "./review";
import {
  actionsIn,
  activeRuns,
  finishRun,
  getRun,
  lastPromptedPr,
  openCrewStore,
  runsOf,
  setRunPid,
  type StoredAction,
} from "./store";
import { harnessOf } from "./worker";

/**
 * A fresh fixer: when a PR's fix, ci or conflict step is due and its author
 * seat is busy with other work, the watcher starts a fresh session on the
 * author's roster model in the PR's own worktree. It fixes, pushes, replies
 * on the PR signed `[fixer #N]` and is done; the next round runs as usual.
 */

/** The steps a fixer takes on; screenshots stay with the author. */
export const FIXER_KINDS = new Set(["fix", "ci", "conflict"]);

/** Herdr statuses of a seat that is working on something. */
const BUSY = new Set(["working", "blocked"]);

export type FixerTask = {
  repo: string;
  pr: number;
  head: string;
  author: string;
  title: string;
  url: string;
  branch: string;
  /** The watcher's step messages, as the author would have had them. */
  steps: string[];
};

export function fixerPrompt(task: FixerTask) {
  const { repo, pr, head, author, branch } = task;
  return `You are a fresh fixer for Herdr World pull request #${pr}, started because its author seat ${author} is busy with other work. You do this one step for ${author} and are done.

The crew watcher's step${task.steps.length > 1 ? "s" : ""} for ${author}:
${task.steps.map((step) => `- ${step}`).join("\n")}

Work item:
- PR: ${task.url} "${task.title}", branch ${branch}, author seat ${author}.
- This directory is the PR's own worktree, the author's checkout, on ${branch} at ${head}. Commit only your own changes and leave everything else as you found it.
- Read the PR, the reviews and earlier fix replies with gh: \`gh pr view ${pr} --repo ${repo} --comments\` and \`gh api repos/${repo}/pulls/${pr}/reviews\`.

Rules:
- Follow AGENTS.md and the candidate-delivery skill (.agents/skills/candidate-delivery/SKILL.md): fix every P1–P3 finding in one pass, with tests and docs as the change needs.
- Push to ${branch} only. The pre-push hook runs the gate; wait for it and never bypass it. If the push is refused because the branch moved, stop and say so here; don't force-push.
- Never use git stash: its stack is shared with every worktree.
- After pushing, post one comment on the PR that starts with \`[fixer #${pr}]\`, then one line per finding or step naming its fixing commit.
- To reach the owner, use \`herdr-world ask "QUESTION" --owner-only --wait\` from your own pane; no other channel.
- Never merge, approve, use --admin, add labels, prompt or message another agent, or post local paths, hosts, usernames or session links.
- Finish by printing only the comment's URL. Then stay in this session: the owner may ask you about your fix here; answer, but take no further action unless asked.`;
}

/**
 * The PR's own worktree, where a fixer can work: the one with its branch
 * checked out, with no uncommitted changes and at the PR's head. Anything
 * else may be the author's work in progress, so the step waits for them.
 */
export function fixerWorktree(
  run: Run,
  primary: string,
  branch: string | undefined,
  head: string,
): { path: string } | { why: string } {
  if (!branch) return { why: "the PR's branch is unknown" };
  const list = run(["git", "-C", primary, "worktree", "list", "--porcelain"]);
  if (list.code !== 0) return { why: "git can't list the worktrees" };
  let path: string | null = null;
  let found: string | null = null;
  for (const line of list.stdout.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice(9);
    else if (line === `branch refs/heads/${branch}`) found = path;
  }
  if (!found) return { why: `no worktree has ${branch} checked out` };
  const status = run(["git", "-C", found, "status", "--porcelain"]);
  if (status.code !== 0 || status.stdout.trim())
    return { why: "its worktree has uncommitted changes" };
  const at = run(["git", "-C", found, "rev-parse", "HEAD"]);
  if (at.code !== 0 || at.stdout.trim() !== head)
    return { why: "its worktree isn't at the PR's head" };
  return { path: found };
}

/**
 * Starts a fixer for each of a busy author's PRs that one may take: the
 * seat is busy, it was last prompted about another PR, no fixer has worked
 * on this head yet, a run slot is free and the PR's worktree is clean at
 * its head. Returns the steps handed to a fixer, and why the others wait.
 */
export function startFixers(
  crew: Database,
  context: { dir: string; now: number; deps: Deps; worker: string[] },
  settings: CrewSettings,
  seat: { name: string; status: string },
  entries: StoredAction[],
  branches: Map<number, string | undefined>,
  say: (text: string) => void,
) {
  const handed = new Set<string>();
  const waits = new Map<number, string>();
  if (!BUSY.has(seat.status)) return { handed, waits };
  const model = settings.roster[seat.name];
  const byPr = new Map<number, StoredAction[]>();
  for (const entry of entries)
    if (FIXER_KINDS.has(entry.kind))
      byPr.set(entry.pr, [...(byPr.get(entry.pr) ?? []), entry]);
  const on = lastPromptedPr(crew, seat.name);
  for (const [pr, steps] of byPr) {
    const head = steps[0]!.head;
    const why = !model
      ? `${seat.name} has no roster model`
      : !harnessOf(model)
        ? `no harness runs ${model.model}`
        : on === pr
          ? `${seat.name} is on this PR`
          : runsOf(crew, pr).some((run) => run.cwd && run.head === head)
            ? "a fixer already worked on this head"
            : settings.maxRuns - activeRuns(crew).length <= 0
              ? "no free run slot"
              : null;
    const place = why
      ? { why }
      : fixerWorktree(
          context.deps.run,
          dirname(dirname(context.dir)),
          branches.get(pr),
          head,
        );
    if ("why" in place) {
      waits.set(pr, place.why);
      continue;
    }
    const run = launchRun(
      crew,
      context,
      {
        keys: steps.map((step) => step.key),
        pr,
        head,
        name: seat.name,
        cwd: place.path,
        branch: branches.get(pr),
      },
      (id) => [
        ...context.worker,
        "fix",
        "--pr",
        String(pr),
        "--author",
        seat.name,
        "--head",
        head,
        "--run",
        String(id),
      ],
    );
    for (const step of steps) handed.add(step.key);
    say(
      `#${pr} started a fixer for ${seat.name} (${seat.status}): ${steps.map((step) => step.kind).join(", ")} (${run.where})`,
    );
  }
  return { handed, waits };
}

/**
 * Runs one fresh fixer in its PR's worktree. Its pane keeps what it showed,
 * and its session stays open as a chat once it has pushed and replied.
 */
export async function fix(options: Options, dir: string, deps: Deps) {
  const { author, head, run: runId } = options;
  const pr = options.prs[0];
  if (!pr || !author || !head || !runId)
    throw new Error("fix needs --pr, --author, --head and --run");
  const configPath = join(dir, "config.json");
  const repo = loadConfig(configPath).repo;
  const model = loadSettings(configPath).roster[author];
  if (!model) throw new Error(`${author} has no roster model`);
  const crew = openCrewStore(join(dir, "crew.sqlite"));
  const found = getRun(crew, runId);
  const show = (text: string) => {
    deps.out(text);
    if (found?.log) appendFileSync(found.log, `${text}\n`);
  };
  setRunPid(crew, runId, process.pid);
  if (!found?.cwd || getRun(crew, runId)?.finishedAt !== null) {
    show("── stopped before it started: a newer head superseded this fix");
    crew.close();
    return 143;
  }
  process.on("SIGTERM", () => {
    show("── stopped: the PR merged or closed");
    process.exit(143);
  });
  let code = 1;
  let usage: string | null = null;
  try {
    const meta = prMeta(pr, repo, deps);
    const steps = actionsIn(crew, ["running"])
      .filter((entry) => entry.detail === `run ${runId}`)
      .map((entry) => entry.text);
    const prompt = fixerPrompt({
      repo,
      pr,
      head,
      author,
      title: meta.title,
      url: meta.url,
      branch: meta.headRefName,
      steps,
    });
    show(
      `fixer for ${author} on #${pr} at ${shortSha(head)} (${model.model}), in the PR's worktree; type here to steer it`,
    );
    ({ code, usage } = await runSession(
      crew,
      runId,
      model,
      prompt,
      found.cwd,
      show,
    ));
  } catch (error) {
    show(error instanceof Error ? error.message : String(error));
    show("── failed to start");
    code = 1;
  } finally {
    finishRun(crew, runId, code, usage, Date.now());
    crew.close();
  }
  return code;
}
