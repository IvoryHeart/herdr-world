import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assessKnowledgeMapImpact,
  assessSpecEdits,
  changedPathsBetween,
} from "./check-knowledge-map";
import { readCoverageScope } from "./coverage-scope";
import { readCapabilityNotes } from "./openspec-notes";
import { coverageDirectory } from "./coverage";
import { ordinaryDocumentation } from "./validation-scope";
import { formatPrivacyFinding, scanPrivacyText } from "./check-privacy";
import {
  isDependabotPullRequest,
  type PullRequestEvent,
} from "./dependabot-event";

function descriptionLines(body: string): string[] {
  let fence: string | undefined;
  return body
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .split(/\r?\n/)
    .filter((line) => {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker) {
        if (!fence) fence = marker;
        else if (marker[0] === fence[0] && marker.length >= fence.length)
          fence = undefined;
        return false;
      }
      return !fence;
    });
}

/** Match stated file/directory names, not prose about whether a contract moved. */
function namesChangedPath(
  answer: string,
  paths: readonly string[],
  spec: boolean,
): boolean {
  const names = new Set(answer.match(/[\w./-]+/g));
  return paths.some(
    (path) =>
      [...names].some(
        (name) =>
          name === path ||
          (name.includes("/") &&
            path.startsWith(`${name.replace(/\/$/, "")}/`)),
      ) ||
      (spec &&
        [
          // Capability ids include every directory below specs/, including deltas.
          /^openspec\/(?:specs|changes\/[^/]+\/specs)\/(.+)\/spec\.md$/.exec(
            path,
          )?.[1],
          /^openspec\/changes\/([^/]+)\//.exec(path)?.[1],
        ].some((name) => name !== undefined && names.has(name))),
  );
}

/** Cheap diff consistency only; review still decides whether a none is true. */
export function assessContractImpacts(
  paths: readonly string[],
  body: string,
  owns: (path: string) => boolean = () => false,
): string[] {
  if (!paths.length || ordinaryDocumentation(paths, owns)) return [];
  const specPaths = paths.filter((path) =>
    /^openspec\/(specs|changes)\//.test(path),
  );
  const verificationPaths = paths.filter(
    (path) => /^(quint|verification)\//.test(path) || owns(path),
  );
  const lines = descriptionLines(body);
  const problems: string[] = [];
  for (const [label, required, candidates] of [
    ["Spec impact", specPaths, specPaths],
    // Named checks need not follow a filename convention or live in the inventory.
    ["Verification impact", verificationPaths, paths],
  ] as const) {
    const pattern = new RegExp(
      `^[ \\t]*(?:-[ \\t]+)?${label}:[ \\t]*(.*)$`,
      "i",
    );
    const answers = lines.flatMap((line) => {
      const match = pattern.exec(line);
      return match ? [match[1].trim()] : [];
    });
    if (answers.length !== 1 || !answers[0] || /<[^>]+>/.test(answers[0])) {
      problems.push(
        `Include one plain \`${label}: <updated path or name>\` or \`${label}: none — <reason>\` line.`,
      );
      continue;
    }
    const answer = answers[0];
    if (/^none\b/i.test(answer)) {
      const reason = /^none[ \t]*[-–—:][ \t]*(.+)$/i.exec(answer)?.[1];
      if (!reason || !/[\p{L}\p{N}]/u.test(reason))
        problems.push(
          `${label}: none requires a specific reason on the same line.`,
        );
      else if (required.length)
        problems.push(
          `${label}: none contradicts changed paths: ${required.slice(0, 5).join(", ")}. Name the update.`,
        );
    } else if (!namesChangedPath(answer, candidates, label === "Spec impact")) {
      problems.push(
        `${label}: must name a changed ${label === "Spec impact" ? "spec or OpenSpec change" : "model, adapter, coverage owner or check"}; claimed updates to untouched files fail.`,
      );
    }
  }
  return problems;
}

/** Use CI's policy functions and the committed PR diff, before publication. */
export function checkPrBody(
  file: string,
  cwd = process.cwd(),
  baseRef = "origin/main",
): string[] {
  return checkPrBodyText(readFileSync(file, "utf8"), cwd, baseRef);
}

export function checkPrBodyText(
  body: string,
  cwd = process.cwd(),
  baseRef = "origin/main",
  headRef = "HEAD",
  dependabot = false,
): string[] {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const base = git("rev-parse", "--verify", `${baseRef}^{commit}`);
  const head = git("rev-parse", "--verify", `${headRef}^{commit}`);
  const comparisonBase = git("merge-base", base, head);
  const paths = changedPathsBetween(cwd, base, head);
  const sourcePaths = changedPathsBetween(cwd, base, head, {
    includeDeleted: false,
  });
  const knowledge = assessKnowledgeMapImpact(
    sourcePaths,
    readCapabilityNotes(cwd),
  );
  return [
    ...scanPrivacyText(body, "PR body", dependabot).map(formatPrivacyFinding),
    ...assessSpecEdits(paths, (path) => {
      try {
        return [
          git("show", `${comparisonBase}:${path}`),
          git("show", `${head}:${path}`),
        ];
      } catch {
        return undefined;
      }
    }),
    ...(dependabot
      ? []
      : assessContractImpacts(
          paths,
          body,
          existsSync(join(cwd, coverageDirectory))
            ? readCoverageScope(cwd).owns
            : undefined,
        )),
    ...(!knowledge.ok
      ? [
          `Source files without a capability notes.md Code path: ${knowledge.uncovered.join(", ")}`,
        ]
      : []),
  ];
}

/** CI checks the immutable PR head, even when its checkout is a merge commit. */
export function checkPrBodyEvent(file: string, cwd = process.cwd()): string[] {
  const event = JSON.parse(readFileSync(file, "utf8")) as PullRequestEvent;
  const pull = event.pull_request;
  const dependabot = isDependabotPullRequest(event);
  if (
    !/^[0-9a-f]{40}$/.test(pull?.base?.sha ?? "") ||
    !/^[0-9a-f]{40}$/.test(pull?.head?.sha ?? "")
  )
    throw new Error("Missing or invalid pull-request base or head");
  return [
    ...scanPrivacyText(pull?.title ?? "", "PR title", dependabot).map(
      formatPrivacyFinding,
    ),
    ...checkPrBodyText(
      pull?.body ?? "",
      cwd,
      pull?.base?.sha,
      pull?.head?.sha,
      dependabot,
    ),
  ];
}

if (import.meta.main) {
  try {
    const file = process.argv[2];
    if (!file)
      throw new Error(
        "Usage: bun run check:pr-body <file> [base-ref] | --event <event.json>",
      );
    const problems =
      file === "--event"
        ? checkPrBodyEvent(process.argv[3])
        : checkPrBody(file, process.cwd(), process.argv[3]);
    for (const problem of problems) console.error(problem);
    process.exitCode = problems.length ? 1 : 0;
    if (!problems.length) console.info("PR description policy passed.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
