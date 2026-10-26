/**
 * A reviewer run: one fresh harness session per review or confirmation,
 * briefed with references to the work item rather than a transcript, which
 * posts its RESULT on GitHub and exits.
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
- Finish by printing only the RESULT line and the review URL.`;
}

/** The harness command line for a seat's model; null for a model it can't run. */
export function harnessArgv(
  model: { model: string; effort?: string },
  prompt: string,
  lastMessage: string,
): string[] {
  if (model.model.startsWith("claude-"))
    return [
      "claude",
      "-p",
      prompt,
      "--model",
      model.model,
      ...(model.effort ? ["--effort", model.effort] : []),
      "--permission-mode",
      "bypassPermissions",
      "--output-format",
      "json",
    ];
  return [
    "codex",
    "exec",
    "-m",
    model.model,
    ...(model.effort ? ["-c", `model_reasoning_effort="${model.effort}"`] : []),
    "--dangerously-bypass-approvals-and-sandbox",
    "--json",
    "-o",
    lastMessage,
    prompt,
  ];
}

/**
 * Token usage from a run's stdout: Claude prints one JSON result with
 * `usage`; Codex prints JSON lines, the last `turn.completed` carrying it.
 */
export function parseUsage(stdout: string): Record<string, unknown> | null {
  let usage: Record<string, unknown> | null = null;
  for (const line of stdout.split("\n")) {
    const text = line.trim();
    if (!text.startsWith("{")) continue;
    try {
      const value = JSON.parse(text) as Record<string, unknown>;
      const found = value.usage;
      if (found && typeof found === "object") {
        usage = { ...(found as Record<string, unknown>) };
        if (typeof value.total_cost_usd === "number")
          usage.total_cost_usd = value.total_cost_usd;
      }
    } catch {
      // A partial or non-JSON line carries no usage.
    }
  }
  return usage;
}
