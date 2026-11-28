import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { readCapabilityNotes } from "./openspec-notes";

export function changedPathsBetween(
  cwd: string,
  base: string,
  head: string,
  { includeDeleted = true }: { includeDeleted?: boolean } = {},
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
      ...(includeDeleted ? [] : ["--diff-filter=ACMRT"]),
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
  capabilities: readonly { codePaths: string[] }[],
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

/** Only move an overlong body's exact words into one new scenario; retain all else. */
function losslessShortening(before: string, after: string): boolean {
  const old = before.split(/^### Requirement: /m);
  const next = after.split(/^### Requirement: /m);
  if (old.length !== next.length || old[0] !== next[0]) return false;
  const words = (text: string) => text.trim().split(/\s+/).join(" ");
  return old.slice(1).every((block, index) => {
    const changed = next[index + 1]!;
    if (block === changed) return true;
    const start = block.indexOf("\n#### Scenario: ");
    const end = changed.indexOf("\n#### Scenario: ");
    if (start < 0 || end < 0) return false;
    const title = block.slice(0, block.indexOf("\n"));
    if (changed.slice(0, changed.indexOf("\n")) !== title) return false;
    const body = block.slice(title.length, start).trim();
    const shortened = changed.slice(title.length, end).trim();
    if (body.length <= 500 || !shortened || shortened.length > 500)
      return false;
    const scenarios = block.slice(start).trim();
    const replacement = changed.slice(end).trim();
    if (!replacement.endsWith(scenarios)) return false;
    const added = replacement.slice(0, -scenarios.length).trim();
    const detail =
      /^#### Scenario: [^\n]+\n\n- \*\*WHEN\*\* [^\n]+\n- \*\*THEN\*\*(?:[ \t]+|\n)([\s\S]+)$/.exec(
        added,
      )?.[1];
    return (
      detail !== undefined && words(`${shortened} ${detail}`) === words(body)
    );
  });
}

/** Feature contracts are deltas; archives and lossless length repairs are exceptions. */
export function assessSpecEdits(
  paths: readonly string[],
  readSpec?: (path: string) => readonly [string, string] | undefined,
): string[] {
  const direct = paths.filter((p) => /^openspec\/specs\/.+\/spec\.md$/.test(p));
  const archiveOnly =
    paths.some((p) => p.startsWith("openspec/changes/archive/")) &&
    paths.every(
      (p) =>
        p.startsWith("openspec/changes/") ||
        /^openspec\/specs\/.+\/(spec|notes)\.md$/.test(p),
    );
  const invalid = archiveOnly
    ? []
    : direct.filter((path) => {
        const versions = readSpec?.(path);
        return !versions || !losslessShortening(...versions);
      });
  return invalid.length
    ? [
        `Put contract edits in openspec/changes/<slug>/specs/; current specs synchronize in the archive PR: ${invalid.join(", ")}`,
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
      { includeDeleted: false },
    );
    const result = assessKnowledgeMapImpact(
      changedPaths,
      readCapabilityNotes(),
    );
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
