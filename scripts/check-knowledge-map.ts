import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { readCapabilities, type Capability } from "./where";

export function changedPathsBetween(
  cwd: string,
  base: string,
  head: string,
): string[] {
  for (const revision of [base, head]) {
    if (!/^[0-9a-f]{40}$/.test(revision)) {
      throw new Error(
        "Source-coverage check requires exact base and head commits",
      );
    }
  }
  const output = execFileSync(
    "git",
    [
      "-c",
      "core.fsmonitor=false",
      "diff",
      "--name-only",
      "-z",
      "--no-renames",
      `${base}...${head}`,
      "--",
    ],
    { cwd, encoding: "utf8" },
  );
  return output.split("\0").filter(Boolean);
}

/** Exact files, directory prefixes (trailing /) or repository-relative globs. */
export function assessKnowledgeMapImpact(
  changedPaths: readonly string[],
  capabilities: readonly Pick<Capability, "codePaths">[],
): { ok: boolean; uncovered: string[] } {
  const patterns = capabilities.flatMap((c) => c.codePaths);
  const uncovered = changedPaths.filter(
    (path) =>
      (/\.(?:[cm]?[jt]sx?|css|html|sh|py|rb|ps1|qnt)$/.test(path) ||
        path.startsWith(".githooks/") ||
        path.startsWith(".github/workflows/")) &&
      !patterns.some((pattern) =>
        pattern.endsWith("/")
          ? path.startsWith(pattern)
          : new Bun.Glob(pattern).match(path),
      ),
  );
  return { ok: uncovered.length === 0, uncovered };
}

/** Feature contracts are deltas; only archive-only PRs synchronize current specs. */
export function assessSpecEdits(paths: readonly string[]): string[] {
  const direct = paths.filter((p) => /^openspec\/specs\/.+\/spec\.md$/.test(p));
  const archiveOnly =
    paths.some((p) => p.startsWith("openspec/changes/archive/")) &&
    paths.every(
      (p) =>
        p.startsWith("openspec/changes/") ||
        /^openspec\/specs\/.+\/(spec|notes)\.md$/.test(p),
    );
  return direct.length && !archiveOnly
    ? [
        `Put contract edits in openspec/changes/<slug>/specs/; current specs synchronize in the archive PR: ${direct.join(", ")}`,
      ]
    : [];
}

type PullRequestEvent = {
  pull_request?: {
    base?: { sha?: string };
    head?: { sha?: string };
    body?: string | null;
  };
};

if (import.meta.main) {
  try {
    const eventPath = process.argv[2] ?? process.env.GITHUB_EVENT_PATH;
    if (!eventPath) throw new Error("Pass the GitHub pull-request event file");
    const event = JSON.parse(
      readFileSync(eventPath, "utf8"),
    ) as PullRequestEvent;
    const base = event.pull_request?.base?.sha;
    const head = event.pull_request?.head?.sha;
    if (!base || !head) throw new Error("Missing pull-request base or head");
    const changedPaths = changedPathsBetween(
      fileURLToPath(new URL("..", import.meta.url)),
      base,
      head,
    );
    const result = assessKnowledgeMapImpact(changedPaths, readCapabilities());
    if (!result.ok) {
      console.error(
        `Source files without a capability notes.md Code path:\n${result.uncovered.join("\n")}`,
      );
      process.exitCode = 1;
    } else console.log("Changed sources are covered by capability notes.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
