import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assessKnowledgeMapImpact,
  assessSpecEdits,
  changedPathsBetween,
} from "./check-knowledge-map";
import { assessPullRequest, readFragments } from "./changelog-fragments";
import { readCoverageScope } from "./coverage-scope";
import { readCapabilities } from "./where";
import { coverageDirectory } from "./coverage";
import { ordinaryDocumentation } from "./validation-scope";

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

/**
 * Help ships with the feature (#1025): a changelog fragment that adds
 * something (`### Added`) comes with a changed `*.help.ts` declaration
 * (web/src/help/helpEntry.ts), or the description says why it needs none.
 */
export function assessHelpImpact(
  paths: readonly string[],
  fragment: (path: string) => string | undefined,
  body: string,
): string[] {
  const adding = paths.filter(
    (path) =>
      /^changes\/[a-z0-9-]+\.md$/.test(path) &&
      /^### Added[ \t]*$/m.test(fragment(path) ?? ""),
  );
  if (!adding.length || paths.some((path) => path.endsWith(".help.ts")))
    return [];
  const answers = descriptionLines(body).flatMap((line) => {
    const match = /^[ \t]*(?:-[ \t]+)?Help:[ \t]*(.*)$/i.exec(line);
    return match ? [match[1].trim()] : [];
  });
  const reason =
    answers.length === 1
      ? /^none[ \t]*[-–—:][ \t]*(.+)$/i.exec(answers[0])?.[1]
      : undefined;
  return reason && /[\p{L}\p{N}]/u.test(reason) && !/<[^>]+>/.test(reason)
    ? []
    : [
        `${adding.join(", ")} adds something: declare its help in a *.help.ts file beside it (web/src/help/helpEntry.ts), or include \`Help: none — <specific reason>\`.`,
      ];
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
): string[] {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const base = git("rev-parse", "--verify", `${baseRef}^{commit}`);
  const head = git("rev-parse", "--verify", `${headRef}^{commit}`);
  const paths = changedPathsBetween(cwd, base, head);
  readFragments(cwd);
  const sourcePaths = changedPathsBetween(cwd, base, head, {
    includeDeleted: false,
  });
  const knowledge = assessKnowledgeMapImpact(
    sourcePaths,
    readCapabilities(cwd),
  );
  const changelog = assessPullRequest(
    paths,
    new Set(paths.filter((path) => existsSync(join(cwd, path)))),
    body,
  );
  return [
    ...assessSpecEdits(paths),
    ...assessContractImpacts(
      paths,
      body,
      existsSync(join(cwd, coverageDirectory))
        ? readCoverageScope(cwd).owns
        : undefined,
    ),
    ...(!knowledge.ok
      ? [
          `Source files without a capability notes.md Code path: ${knowledge.uncovered.join(", ")}`,
        ]
      : []),
    ...assessHelpImpact(
      paths,
      (path) =>
        existsSync(join(cwd, path))
          ? readFileSync(join(cwd, path), "utf8")
          : undefined,
      body,
    ),
    ...(!changelog.ok
      ? [
          "Add a valid changes/<slug>.md fragment, or include `Changelog: none — <specific reason>`.",
        ]
      : []),
  ];
}

/** CI checks the immutable PR head, even when its checkout is a merge commit. */
export function checkPrBodyEvent(file: string, cwd = process.cwd()): string[] {
  const event = JSON.parse(readFileSync(file, "utf8")) as {
    pull_request?: {
      base?: { sha?: string };
      head?: { sha?: string };
      body?: string | null;
    };
  };
  const pull = event.pull_request;
  if (
    !/^[0-9a-f]{40}$/.test(pull?.base?.sha ?? "") ||
    !/^[0-9a-f]{40}$/.test(pull?.head?.sha ?? "")
  )
    throw new Error("Missing or invalid pull-request base or head");
  return checkPrBodyText(
    pull?.body ?? "",
    cwd,
    pull?.base?.sha,
    pull?.head?.sha,
  );
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
