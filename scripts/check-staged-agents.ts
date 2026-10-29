import { execFileSync } from "node:child_process";

/**
 * `.agents/` holds each checkout's live agent state: the dispatcher's brief
 * and queue, gate stores, worktrees. Only the shared skills are tracked, so
 * a commit that adds or changes anything else there, even by `git add -f`,
 * is refused. Removing such a file is allowed.
 */
export function refusedAgentPaths(paths: string[]) {
  return paths.filter(
    (path) =>
      path.startsWith(".agents/") && !path.startsWith(".agents/skills/"),
  );
}

if (import.meta.main) {
  const staged = execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMRT", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  const refused = refusedAgentPaths(staged);
  if (refused.length) {
    console.error(
      `check:commit: .agents/ is live agent state; only .agents/skills/ is tracked. Unstage:\n${refused.map((path) => `  ${path}`).join("\n")}\nPropose changes to the dispatcher runbook or brief template in docs/ instead.`,
    );
    process.exit(1);
  }
}
