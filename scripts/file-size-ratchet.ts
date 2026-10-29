/**
 * Keep source files from regrowing. A tracked non-test source file may have
 * at most 1000 lines unless `scripts/file-size-exceptions.json` lists it; a
 * listed file may not grow past its recorded size. The list only shrinks:
 * against the base revision, no entry may be added or raised. Files under
 * `unratcheted` (owner decision, pending their splits) are exempt until
 * removed from that list, which also only shrinks.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const LIMIT = 1000;
export const EXCEPTIONS = "scripts/file-size-exceptions.json";
export type Exceptions = {
  limits: Record<string, number>;
  unratcheted: Record<string, string>;
};

/** Source files the ratchet covers: code and styles, not tests or generated output. */
export function ratcheted(path: string): boolean {
  return (
    /\.(ts|tsx|js|mjs|cjs|css)$/.test(path) &&
    !/\.test\.|\.browser\.tsx?$|\/testing\/|\.gen\.|(^|\/)(dist|node_modules|public)\//.test(
      path,
    )
  );
}

/** The policy file, rejected unless every ceiling is a positive integer. */
export function parseExceptions(text: string, label: string): Exceptions {
  const value = JSON.parse(text) as unknown;
  const object = (item: unknown): item is Record<string, unknown> =>
    typeof item === "object" && item !== null && !Array.isArray(item);
  if (
    !object(value) ||
    !object(value.limits) ||
    !object(value.unratcheted) ||
    Object.keys(value).some((key) => key !== "limits" && key !== "unratcheted")
  )
    throw new Error(
      `${label}: expected { "limits": {...}, "unratcheted": {...} }`,
    );
  for (const [path, max] of Object.entries(value.limits))
    if (!Number.isSafeInteger(max) || (max as number) <= LIMIT)
      throw new Error(
        `${label}: ${path} needs an integer ceiling above ${LIMIT}`,
      );
  for (const [path, reason] of Object.entries(value.unratcheted))
    if (typeof reason !== "string" || !reason.trim())
      throw new Error(`${label}: ${path} needs the reason it is unratcheted`);
  return value as Exceptions;
}

/**
 * `baseLines` holds the base revision's size of each file over its limit:
 * growth already on main (or the merge base) is not this change's to answer
 * for, so a file is allowed the larger of its limit and its base size.
 */
export function checkSizes(
  lines: Record<string, number>,
  current: Exceptions,
  base: Exceptions | undefined,
  baseLines: Record<string, number> = {},
): string[] {
  const problems: string[] = [];
  for (const [path, count] of Object.entries(lines)) {
    if (path in current.unratcheted) continue;
    const max = Math.max(current.limits[path] ?? LIMIT, baseLines[path] ?? 0);
    if (count > max)
      problems.push(
        path in current.limits
          ? `${path} has ${count} lines; it may not grow past ${max} (split it instead)`
          : `${path} has ${count} lines; new or small files stay at ${LIMIT} or fewer`,
      );
  }
  if (base) {
    for (const [path, max] of Object.entries(current.limits))
      if (!(path in base.limits)) {
        // Ending a deferred exemption: the split freezes the file at its
        // post-split size, the one transition into limits that is allowed.
        if (path in base.unratcheted && !(path in current.unratcheted)) {
          if (max !== lines[path])
            problems.push(
              `${EXCEPTIONS}: ${path} leaves unratcheted, so record its current size ${lines[path] ?? 0} as its limit (not ${max})`,
            );
        } else
          problems.push(
            `${EXCEPTIONS}: ${path} is a new exception; the list only shrinks`,
          );
      } else if (max > base.limits[path]!)
        problems.push(
          `${EXCEPTIONS}: ${path} raised from ${base.limits[path]} to ${max}; the list only shrinks`,
        );
    for (const path of Object.keys(current.unratcheted))
      if (!(path in base.unratcheted))
        problems.push(
          `${EXCEPTIONS}: ${path} newly unratcheted; that list only shrinks`,
        );
  }
  return problems;
}

/** Recorded sizes with room to spare: lower them so the ratchet keeps the gain. */
export function slack(
  lines: Record<string, number>,
  current: Exceptions,
): string[] {
  return Object.entries(current.limits)
    .filter(([path, max]) => (lines[path] ?? 0) < max)
    .map(([path, max]) =>
      (lines[path] ?? 0) <= LIMIT
        ? `${path} is ${lines[path] ?? 0} lines now; remove its exception`
        : `${path} is ${lines[path]} lines now; lower its exception from ${max}`,
    );
}

function git(args: string[]) {
  const result = Bun.spawnSync(["git", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return result.exitCode === 0 ? result.stdout.toString() : undefined;
}

/** Like git(), but a failure stops the check. */
function mustGit(args: string[]) {
  const out = git(args);
  if (out === undefined) throw new Error(`git ${args.join(" ")} failed`);
  return out;
}

function countLines(text: string) {
  return text.length === 0
    ? 0
    : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

if (import.meta.main) {
  try {
    const root = resolve(import.meta.dir, "..");
    process.chdir(root);
    const lines: Record<string, number> = {};
    for (const path of mustGit(["ls-files"]).split("\n"))
      if (path && ratcheted(path)) {
        try {
          lines[path] = countLines(readFileSync(path, "utf8"));
        } catch {
          // Deleted in the working tree.
        }
      }
    const current = parseExceptions(
      readFileSync(EXCEPTIONS, "utf8"),
      EXCEPTIONS,
    );
    // Match CI's proposed-merge baseline, including ceilings lowered since
    // this branch forked. The merge base can silently allow a restored ceiling.
    const baseRef =
      process.argv[2] ??
      git(["rev-parse", "--verify", "origin/main^{commit}"])?.trim() ??
      (mustGit([
        "fetch",
        "--quiet",
        "--no-tags",
        "--depth=1",
        "origin",
        "main",
      ]),
      "FETCH_HEAD");
    mustGit(["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`]);
    // Absent only before this ratchet existed on the base.
    const baseText = git(["show", `${baseRef}:${EXCEPTIONS}`]);
    const base = baseText
      ? parseExceptions(baseText, `${EXCEPTIONS} at ${baseRef.slice(0, 8)}`)
      : undefined;
    // Base sizes, only for the files over their limit.
    const baseLines: Record<string, number> = {};
    for (const [path, count] of Object.entries(lines))
      if (count > (current.limits[path] ?? LIMIT)) {
        const text = git(["show", `${baseRef}:${path}`]);
        if (text !== undefined) baseLines[path] = countLines(text);
      }
    const problems = checkSizes(lines, current, base, baseLines);
    for (const note of slack(lines, current)) console.info(`[size] ${note}`);
    if (problems.length) {
      for (const problem of problems) console.error(`[size] ${problem}`);
      process.exit(1);
    }
    console.info(
      `[size] ${Object.keys(lines).length} files within the ${LIMIT}-line ratchet`,
    );
  } catch (error) {
    console.error(
      `[size] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
