import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MAP_PATH = "docs/knowledge-map.md";
const WORLD_PREFIX = "web/src/world/";
const NO_IMPACT_REASON =
  /^\s*(?:-\s*)?Knowledge map impact:\s*unchanged\s*[-–—:]\s*(.+)$/im;

export function changedPathsBetween(
  cwd: string,
  base: string,
  head: string,
): string[] {
  for (const revision of [base, head]) {
    if (!/^[0-9a-f]{40}$/.test(revision)) {
      throw new Error(
        "Knowledge-map check requires exact base and head commits",
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
      base,
      head,
      "--",
    ],
    { cwd, encoding: "utf8" },
  );
  return output.split("\0").filter(Boolean);
}

export function assessKnowledgeMapImpact(
  changedPaths: readonly string[],
  body: string | null | undefined,
): { ok: boolean; worldPaths: string[]; reason: string | null } {
  const worldPaths = changedPaths.filter((path) =>
    path.startsWith(WORLD_PREFIX),
  );
  const match = (body ?? "").match(NO_IMPACT_REASON);
  const reason = match?.[1]?.trim() ?? null;
  const hasReason =
    reason !== null && reason.length >= 20 && !/^<.*>$/.test(reason);
  return {
    ok: worldPaths.length === 0 || changedPaths.includes(MAP_PATH) || hasReason,
    worldPaths,
    reason: hasReason ? reason : null,
  };
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
    const result = assessKnowledgeMapImpact(
      changedPaths,
      event.pull_request?.body,
    );
    if (!result.ok) {
      console.error(
        `${result.worldPaths.length} World file(s) changed without a knowledge-map update or a stated no-impact reason.`,
      );
      console.error(result.worldPaths.slice(0, 10).join("\n"));
      console.error(
        "Update docs/knowledge-map.md, or put `Knowledge map impact: unchanged — <specific reason>` in the PR description.",
      );
      process.exitCode = 1;
    } else {
      console.log("Knowledge-map impact accounted for.");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
