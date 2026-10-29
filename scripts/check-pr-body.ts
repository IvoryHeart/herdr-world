import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assessKnowledgeMapImpact,
  changedPathsBetween,
} from "./check-knowledge-map";
import { assessPullRequest, readFragments } from "./changelog-fragments";

/** Use CI's policy functions and the committed PR diff, before publication. */
export function checkPrBody(
  file: string,
  cwd = process.cwd(),
  baseRef = "origin/main",
): string[] {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const base = git("rev-parse", "--verify", `${baseRef}^{commit}`);
  const head = git("rev-parse", "--verify", "HEAD");
  const paths = changedPathsBetween(cwd, base, head);
  const body = readFileSync(file, "utf8");
  readFragments(cwd);
  const knowledge = assessKnowledgeMapImpact(paths, body);
  const changelog = assessPullRequest(
    paths,
    new Set(paths.filter((path) => existsSync(join(cwd, path)))),
    body,
  );
  return [
    ...(!knowledge.ok
      ? [
          "Update docs/knowledge-map.md, or include `Knowledge map impact: unchanged — <specific reason>` (at least 20 characters).",
        ]
      : []),
    ...(!changelog.ok
      ? [
          "Add a valid changes/<slug>.md fragment, or include `Changelog: none — <specific reason>`.",
        ]
      : []),
  ];
}

if (import.meta.main) {
  try {
    const file = process.argv[2];
    if (!file)
      throw new Error("Usage: bun run check:pr-body <file> [base-ref]");
    const problems = checkPrBody(file, process.cwd(), process.argv[3]);
    for (const problem of problems) console.error(problem);
    process.exitCode = problems.length ? 1 : 0;
    if (!problems.length) console.info("PR description policy passed.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
