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

/** Which harness runs a model: Claude models on Claude Code, GPT models on Codex. */
export function harnessFor(model: string): "claude" | "codex" | null {
  if (model.startsWith("claude-")) return "claude";
  if (model.startsWith("gpt-")) return "codex";
  return null;
}

/** The harness command line for a seat's model; the planner refuses other models first. */
export function harnessArgv(
  model: { model: string; effort?: string },
  prompt: string,
  lastMessage: string,
): string[] {
  if (harnessFor(model.model) === "claude")
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
      "stream-json",
      "--verbose",
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

const clip = (text: string, length: number) => {
  const line = text.replace(/\s+/gu, " ").trim();
  return line.length > length ? `${line.slice(0, length - 1)}…` : line;
};

/**
 * One readable line for a harness event, or null for events not worth
 * showing: Codex `exec --json` items and Claude `stream-json` messages.
 */
export function describe(line: string): string | null {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  const item = event.item as Record<string, unknown> | undefined;
  if (item && event.type === "item.completed") {
    if (item.type === "command_execution")
      return `$ ${clip(String(item.command ?? ""), 160)}${typeof item.exit_code === "number" && item.exit_code !== 0 ? `  (exit ${item.exit_code})` : ""}`;
    if (item.type === "agent_message")
      return `» ${clip(String(item.text ?? ""), 400)}`;
    if (item.type === "file_change") return "· edited files";
    return null;
  }
  if (event.type === "assistant") {
    const content = (event.message as { content?: unknown[] } | undefined)
      ?.content;
    const lines: string[] = [];
    for (const part of Array.isArray(content) ? content : []) {
      const entry = part as Record<string, unknown>;
      const input = (entry.input ?? {}) as Record<string, unknown>;
      if (entry.type === "text" && String(entry.text ?? "").trim())
        lines.push(`» ${clip(String(entry.text), 400)}`);
      else if (entry.type === "tool_use")
        lines.push(
          entry.name === "Bash"
            ? `$ ${clip(String(input.command ?? ""), 160)}`
            : `· ${String(entry.name)} ${clip(String(input.file_path ?? input.pattern ?? input.path ?? ""), 120)}`.trimEnd(),
        );
    }
    return lines.length ? lines.join("\n") : null;
  }
  if (event.type === "error")
    return `! ${clip(String(event.message ?? "error"), 300)}`;
  return null;
}

/**
 * Token usage from a run's stdout: Claude's stream ends with a `result`
 * carrying `usage`; Codex's last `turn.completed` carries it.
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

/**
 * The harness session a run's stream names: Claude's `system` init event
 * carries `session_id`, Codex's `thread.started` carries `thread_id`.
 */
export function sessionOf(line: string): string | null {
  try {
    const event = JSON.parse(line) as Record<string, unknown>;
    const id =
      event.type === "thread.started"
        ? event.thread_id
        : event.type === "system"
          ? event.session_id
          : null;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

/** The last canonical RESULT line in a reviewer's output. */
export function resultLine(text: string): string | null {
  const found = text.match(/RESULT #\d+: \d+\/\d+ resolved, \d+ new/gu);
  return found ? found[found.length - 1]! : null;
}

/**
 * An interactive command that reopens a finished run's session as a chat,
 * with the run's own model. The owner drives it, so it takes the
 * harness's normal permissions.
 */
export function chatArgv(
  harness: string,
  session: string,
  model: string | undefined,
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
