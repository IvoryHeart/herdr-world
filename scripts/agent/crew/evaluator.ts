import type { CrewPost } from "./review-facts";
import type { Evaluation } from "./round-policy-store";

const processes = [
  "splitter",
  "fresh-fixer",
  "visionary",
  "restart",
  "owner",
] as const;

/** A signed, checkpoint-specific verdict, with an exhaustive finding disposition. */
export function evaluationVerdict(post: CrewPost, evaluation: Evaluation) {
  if (
    !post.body.startsWith("[evaluator]\n") ||
    !post.body.includes(`\nEvaluation: ${evaluation.checkpoint}\n`) ||
    !post.body.includes(`\nEvaluated commit: ${evaluation.head}\n`)
  )
    return null;
  const line = new RegExp(
    `^EVALUATION #${evaluation.pr}: (go|no-go) — (.+)$`,
    "u",
  ).exec(post.body.trim().split("\n").at(-1)!);
  if (!line) return null;
  if (line[1] === "go") {
    const requiredLine = /^Required: (.+)$/mu.exec(post.body)?.[1];
    if (!requiredLine) return null;
    const required =
      requiredLine === "none"
        ? []
        : requiredLine.split(",").map((id) => id.trim());
    const followups = [
      ...post.body.matchAll(
        /^Follow-up: (\S+) -> (https:\/\/github\.com\/[^\s]+\/issues\/\d+)$/gmu,
      ),
    ];
    const ids = [...required, ...followups.map((entry) => entry[1]!)];
    if (
      new Set(ids).size !== ids.length ||
      ids.length !== evaluation.findings.length ||
      evaluation.findings.some((finding) => !ids.includes(finding.id))
    )
      return null;
    return {
      verdict: "go" as const,
      required,
      followups: followups.map((entry) => `${entry[1]} -> ${entry[2]}`),
      next: line[2]!,
      source: post.url || post.id,
      verdictAt: post.at,
    };
  }
  const process = /^Process: (.+)$/mu.exec(post.body)?.[1];
  if (!processes.includes(process as (typeof processes)[number])) return null;
  const seat = /^Seat: ([a-z0-9-]+)$/mu.exec(post.body)?.[1];
  if (process !== "owner" && !seat) return null;
  return {
    verdict: "no-go" as const,
    process: process as (typeof processes)[number],
    seat,
    next: line[2]!,
    source: post.url || post.id,
    verdictAt: post.at,
  };
}

export function processReport(posts: CrewPost[], evaluation: Evaluation) {
  return posts.find(
    (post) =>
      post.body.startsWith(`[${evaluation.seat}]\n`) &&
      post.body.includes(`\nEvaluation: ${evaluation.checkpoint}\n`) &&
      new RegExp(`^PROCESS #${evaluation.pr}: done — .+$`, "u").test(
        post.body.trim().split("\n").at(-1)!,
      ),
  );
}

export function evaluatorPrompt(
  repo: string,
  evaluation: Evaluation,
  roster: string[],
) {
  const { pr, checkpoint, head } = evaluation;
  return `You are evaluator, a fresh independent Claude Opus 5.5 seat weighing Herdr World PR #${pr} after ${checkpoint} non-converging review rounds.

Read AGENTS.md. Read the linked issue in full, the entire PR at ${head}, EVERY round's findings and author/fixer replies (including inline review comments), and the commits between rounds. Use gh pr view ${pr} --repo ${repo} --json body,closingIssuesReferences,commits and paginated gh api pulls/${pr}/reviews, issues/${pr}/comments and pulls/${pr}/comments under repos/${repo}. Read each linked issue. Flag behaviour the issue did not ask for. Review the PR as a whole and explain why the next step will converge.

Findings to disposition (IDs are stable; inspect their source and full context):
${evaluation.findings.map((finding) => `${finding.id}: ${finding.text} (${finding.url})`).join("\n") || "none"}

Post ONE comment on the PR, signed [evaluator]. It must start with these lines:
[evaluator]
Evaluation: ${checkpoint}
Evaluated commit: ${head}

For go, list precisely the findings mandatory for the next round on one line: Required: <comma-separated IDs>, or Required: none. Every other listed finding must have a follow-up issue you create in ${repo}; add one line per issue: Follow-up: <ID> -> https://github.com/${repo}/issues/<number>. Explain each decision. The next round checks ONLY the Required findings, including their fixes. End with:
EVALUATION #${pr}: go — <next step>

For no-go, name a concrete process and its reasons. Include Process: splitter|fresh-fixer|visionary|restart|owner (choose ONE). Unless owner, include Seat: <roster seat> from ${roster.join(", ")}; fresh-fixer must use another persona from the author. The watcher starts a FRESH session for that seat and holds reviews until it reports back. Splitter splits the PR; visionary reconsiders its design; restart closes/restarts from main; owner requests an owner decision. End with:
EVALUATION #${pr}: no-go — <process change and next step>

Use gh pr comment ${pr} --repo ${repo} --body-file <file>. Never approve, merge, change shared configuration, prompt another agent or restart the watcher. Owner questions use herdr-world ask "QUESTION" --owner-only --wait at reception. Keep output bounded. Finish with the verdict line and comment URL, then stay for owner questions.`;
}

export function processPrompt(repo: string, evaluation: Evaluation) {
  return `You are ${evaluation.seat}, a FRESH ${evaluation.process} process for Herdr World PR #${evaluation.pr}. Further review rounds are held until you report back.

Read AGENTS.md, the linked issue, the whole PR, every review/reply, and evaluator verdict ${evaluation.source}. Process decision: ${evaluation.next}
Carry out that process, explaining its outcome. For fresh-fixer, fix the evaluator's identified findings in this PR's clean worktree and push normally. For splitter or restart, prepare and publish replacement PRs on branches in separate worktrees below .agents/worktrees; close the old PR only after replacements are reviewable and linked. For visionary, post the revised design on the linked issue and the PR. Follow candidate-delivery for code changes; preserve hooks, independent review and owner merge authority. Never force-push, merge, edit live crew config or restart the watcher.

For fresh-fixer, after pushing post per-finding replies in a separate comment signed [fixer #${evaluation.pr}], one line per finding ID or exact file:line naming the fixing commit. Use that accepted fixer signature for the replies even though your process report is signed [${evaluation.seat}].

When the requested process is complete, post one PR comment with gh pr comment ${evaluation.pr} --repo ${repo} --body-file <file>. Start with:
[${evaluation.seat}]
Evaluation: ${evaluation.checkpoint}

Describe the actual outcome and links. End with:
PROCESS #${evaluation.pr}: done — <outcome and next step>

Do not report done while work remains. Ask the owner only through herdr-world ask "QUESTION" --owner-only --wait at reception. Then stay for owner questions.`;
}
