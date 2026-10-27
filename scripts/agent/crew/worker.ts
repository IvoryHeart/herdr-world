import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * A reviewer run: one fresh, interactive harness session per review or
 * confirmation in a Herdr pane, briefed with references to the work item
 * rather than a transcript. It posts its RESULT on GitHub and stays open,
 * so the owner can watch it work, steer it, and ask about it afterwards.
 */

export type ReviewTask = {
  repo: string;
  pr: number;
  head: string;
  reviewer: string;
  /** A confirmation: the reviewer's last claimed commit. */
  since?: string;
  title: string;
  url: string;
  branch: string;
  author: string | null;
};

export function reviewerPrompt(task: ReviewTask) {
  const { repo, pr, head, reviewer, since } = task;
  const job = since
    ? `Confirm your earlier findings. Your last RESULT was at ${since}. Review the delta ${since}..${head}: check each of your findings is fixed and the fixes are correct, and report anything new in the delta.`
    : `Review the pull request at head ${head}. For a batch PR, go commit by commit.`;
  return `You are ${reviewer}, an independent reviewer of Herdr World pull request #${pr}, started fresh for this one review.

${job}

Work item:
- PR: ${task.url} "${task.title}", branch ${task.branch}, author seat ${task.author ?? "unknown"}.
- This directory is a detached checkout at ${head}. Run \`bun install --frozen-lockfile\` before any test.
- Read the PR body, your own earlier reviews and the author's fix replies with gh: \`gh pr view ${pr} --repo ${repo} --comments\` and \`gh api repos/${repo}/pulls/${pr}/reviews\`.

Rules:
- Follow AGENTS.md. Look for correctness bugs, missing tests, documentation gaps, privacy leaks (real hosts, users, paths, sessions, tokens) and contract or verification impact. Grade findings P1, P2 or P3. The owner has every finding fixed, so report only real ones.
- The machine is shared: typecheck and focused unit tests only; a browser suite only through \`bun run test <path>\` when the change needs one. Keep command output bounded.
- Independence: do not read the other reviewers' reviews or comments on this head before you post yours.
- Post exactly one formal review with \`gh pr review ${pr} --repo ${repo} --comment --body-file <file>\`. The body starts with exactly these three lines, no text before them:
  Reviewer: ${reviewer}
  Reviewed commit: ${head}
  RESULT #${pr}: x/y resolved, z new
  For a first review use 0/0 resolved and z = the number of findings. Use digits. Findings follow, one per line: P-level, file:line, the problem and the fix you expect.
- Never push, merge, approve, use --admin, prompt or message another agent, or post session links.
- Finish by printing only the RESULT line and the review URL. Then stay in this session: the owner may read your work here and ask you about it until the PR closes; answer, but take no further action unless asked.`;
}

/** Which harness runs a model: Claude models on Claude Code, GPT models on Codex. */
export function harnessFor(model: string): "claude" | "codex" | null {
  if (model.startsWith("claude-")) return "claude";
  if (model.startsWith("gpt-")) return "codex";
  return null;
}

/**
 * The interactive harness command for a seat's model, with the brief as its
 * first message; the planner refuses other models first. Claude takes the
 * session id it is given; Codex names its own, found from its session files.
 */
export function reviewerArgv(
  model: { model: string; effort?: string },
  prompt: string,
  session: string | null,
): string[] {
  if (harnessFor(model.model) === "claude")
    return [
      "claude",
      "--model",
      model.model,
      ...(model.effort ? ["--effort", model.effort] : []),
      "--permission-mode",
      "bypassPermissions",
      ...(session ? ["--session-id", session] : []),
      prompt,
    ];
  return [
    "codex",
    "-m",
    model.model,
    ...(model.effort ? ["-c", `model_reasoning_effort="${model.effort}"`] : []),
    "--dangerously-bypass-approvals-and-sandbox",
    prompt,
  ];
}

const claudeHome = () =>
  process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
const codexSessions = () =>
  join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions");

/** Claude keeps a session's transcript under its working directory's name. */
export function claudeTranscript(
  cwd: string,
  session: string,
  home = claudeHome(),
) {
  return join(
    home,
    "projects",
    cwd.replace(/[^A-Za-z0-9]/gu, "-"),
    `${session}.jsonl`,
  );
}

/** The session a Codex rollout's first line names, if it ran in `cwd`. */
export function codexSessionOf(firstLine: string, cwd: string): string | null {
  try {
    const meta = JSON.parse(firstLine) as {
      type?: unknown;
      payload?: { id?: unknown; cwd?: unknown };
    };
    return meta.type === "session_meta" &&
      meta.payload?.cwd === cwd &&
      typeof meta.payload.id === "string"
      ? meta.payload.id
      : null;
  } catch {
    return null;
  }
}

/** Codex's rollout files from the last two days' folders, newest first. */
function recentRollouts(root = codexSessions()) {
  const days: string[] = [];
  const below = (dir: string) =>
    existsSync(dir)
      ? readdirSync(dir)
          .filter((name) => /^\d+$/u.test(name))
          .sort()
          .reverse()
      : [];
  for (const year of below(root))
    for (const month of below(join(root, year)))
      for (const day of below(join(root, year, month))) {
        if (days.length < 2) days.push(join(root, year, month, day));
      }
  return days.flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.startsWith("rollout-") && name.endsWith(".jsonl"))
      .map((name) => join(dir, name)),
  );
}

/** The Codex session that started in `cwd` since `since`, once it exists. */
export function findCodexSession(
  cwd: string,
  since: number,
  root = codexSessions(),
) {
  for (const path of recentRollouts(root)) {
    if (statSync(path).mtimeMs < since) continue;
    const first = readFileSync(path, "utf8").split("\n", 1)[0] ?? "";
    const session = codexSessionOf(first, cwd);
    if (session) return session;
  }
  return null;
}

/**
 * A Claude transcript's token usage: each assistant message once, though
 * the transcript repeats a message for each of its content blocks.
 */
export function claudeUsage(transcript: string): Record<string, number> | null {
  const byMessage = new Map<string, Record<string, number>>();
  for (const line of transcript.split("\n")) {
    if (!line.includes('"usage"')) continue;
    try {
      const entry = JSON.parse(line) as {
        message?: { id?: string; usage?: Record<string, unknown> };
      };
      const usage = entry.message?.usage;
      if (!usage || !entry.message?.id) continue;
      const numbers: Record<string, number> = {};
      for (const [key, value] of Object.entries(usage))
        if (typeof value === "number") numbers[key] = value;
      byMessage.set(entry.message.id, numbers);
    } catch {
      // A partial line carries no usage.
    }
  }
  if (!byMessage.size) return null;
  const total: Record<string, number> = {};
  for (const usage of byMessage.values())
    for (const [key, value] of Object.entries(usage))
      total[key] = (total[key] ?? 0) + value;
  return total;
}

/** A Codex rollout's token usage: its last running total. */
export function codexUsage(rollout: string): Record<string, number> | null {
  let total: Record<string, number> | null = null;
  for (const line of rollout.split("\n")) {
    if (!line.includes('"token_count"')) continue;
    try {
      const entry = JSON.parse(line) as {
        payload?: {
          type?: unknown;
          info?: { total_token_usage?: Record<string, number> };
        };
      };
      const usage = entry.payload?.info?.total_token_usage;
      if (entry.payload?.type === "token_count" && usage) total = { ...usage };
    } catch {
      // A partial line carries no usage.
    }
  }
  return total;
}

/** A run's token usage so far, from its harness's own session files. */
export function readUsage(run: {
  harness: string | null;
  session: string | null;
  cwd: string;
}): string | null {
  if (!run.session) return null;
  let usage: Record<string, number> | null = null;
  if (run.harness === "claude") {
    const path = claudeTranscript(run.cwd, run.session);
    if (existsSync(path)) usage = claudeUsage(readFileSync(path, "utf8"));
  } else {
    const path = recentRollouts().find((file) =>
      file.endsWith(`-${run.session}.jsonl`),
    );
    if (path) usage = codexUsage(readFileSync(path, "utf8"));
  }
  return usage ? JSON.stringify(usage) : null;
}

/**
 * An interactive command that reopens a finished run's session as a chat,
 * with the run's own model. The owner drives it, so it takes the
 * harness's normal permissions.
 */
export function chatArgv(
  harness: string,
  session: string,
  model: string | null,
): string[] {
  if (harness === "claude")
    return [
      "claude",
      "--resume",
      session,
      ...(model ? ["--model", model] : []),
    ];
  return ["codex", "resume", session, ...(model ? ["-m", model] : [])];
}
