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
      if (!(path in base.limits))
        problems.push(
          `${EXCEPTIONS}: ${path} is a new exception; the list only shrinks`,
        );
      else if (max > base.limits[path]!)
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

function countLines(text: string) {
  return text.length === 0
    ? 0
    : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  process.chdir(root);
  const lines: Record<string, number> = {};
  for (const path of git(["ls-files"])!.split("\n"))
    if (path && ratcheted(path)) {
      try {
        lines[path] = countLines(readFileSync(path, "utf8"));
      } catch {
        // Deleted in the working tree.
      }
    }
  const current = JSON.parse(readFileSync(EXCEPTIONS, "utf8")) as Exceptions;
  // CI checks out one commit: compare with main's tip when there is no merge base.
  const baseRef =
    process.argv[2] ??
    git(["merge-base", "HEAD", "origin/main"])?.trim() ??
    (git(["fetch", "--quiet", "--no-tags", "--depth=1", "origin", "main"]) !==
    undefined
      ? "FETCH_HEAD"
      : undefined);
  if (!baseRef)
    console.warn(
      "[size] no base revision; the shrink-only rule was not checked",
    );
  const baseText = baseRef
    ? git(["show", `${baseRef}:${EXCEPTIONS}`])
    : undefined;
  // Base sizes, only for the files over their limit.
  const baseLines: Record<string, number> = {};
  if (baseRef)
    for (const [path, count] of Object.entries(lines))
      if (count > (current.limits[path] ?? LIMIT)) {
        const text = git(["show", `${baseRef}:${path}`]);
        if (text !== undefined) baseLines[path] = countLines(text);
      }
  const problems = checkSizes(
    lines,
    current,
    baseText ? (JSON.parse(baseText) as Exceptions) : undefined,
    baseLines,
  );
  for (const note of slack(lines, current)) console.info(`[size] ${note}`);
  if (problems.length) {
    for (const problem of problems) console.error(`[size] ${problem}`);
    process.exit(1);
  }
  console.info(
    `[size] ${Object.keys(lines).length} files within the ${LIMIT}-line ratchet`,
  );
}
