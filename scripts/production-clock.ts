import { parse } from "@babel/parser";
import { children, isIdentifier, type Node, TEST_FILE } from "./source-ast";

/**
 * Production code reads time and schedules work only through an injected
 * clock or scheduler (AGENTS.md): the server's `StoragePorts`/`WorldServiceDeps`
 * clock and scheduler (`server/src/service/clock.ts`), the browser's shared
 * `web/src/clock.ts`. A direct `Date.now()`, `performance.now()`,
 * `setTimeout()` or `setInterval()` elsewhere in `server/src` or `web/src`
 * production code is counted against `scripts/production-clock-allowlist.json`,
 * which only shrinks.
 */
export const PRODUCTION_CLOCK_ALLOWLIST =
  "scripts/production-clock-allowlist.json";
/** @internal */
export const CLOCK_MODULES = new Set([
  "server/src/service/clock.ts",
  "web/src/clock.ts",
]);
const GLOBALS = /^(?:window|globalThis|self)$/;

/** @internal Whether a path is production code under the clock rule. */
export function productionClockFile(path: string) {
  return (
    /^(?:server|web)\/src\/.*\.[cm]?[jt]sx?$/.test(path) &&
    !path.endsWith(".d.ts") &&
    !TEST_FILE.test(path) &&
    !CLOCK_MODULES.has(path)
  );
}

/** @internal Lines of direct clock reads and timer calls in one production file. */
export function directClockUses(path: string, text: string): number[] {
  if (!/Date\.now|performance\.now|setTimeout|setInterval/.test(text))
    return [];
  const ast = parse(text, {
    sourceType: "module",
    errorRecovery: true,
    plugins: /x$/.test(path) ? ["typescript", "jsx"] : ["typescript"],
  }) as unknown as Node;
  const lines: number[] = [];
  const visit = (node: Node) => {
    if (node.type === "CallExpression") {
      const callee = node.callee as Node;
      const timer = /^set(?:Timeout|Interval)$/;
      if (
        isIdentifier(callee, timer) ||
        (callee.type === "MemberExpression" &&
          ((isIdentifier(callee.object, GLOBALS) &&
            isIdentifier(callee.property, timer)) ||
            ((isIdentifier(callee.object, "Date") ||
              isIdentifier(callee.object, "performance")) &&
              isIdentifier(callee.property, "now"))))
      )
        lines.push(node.loc?.start.line ?? 0);
    }
    for (const child of children(node)) visit(child);
  };
  visit(ast);
  return lines;
}

/** @internal Direct uses per production file, for files that have any. */
export function scanProductionClock(
  files: Map<string, string>,
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const [path, text] of files) {
    if (!productionClockFile(path)) continue;
    const lines = directClockUses(path, text);
    if (lines.length) out.set(path, lines);
  }
  return out;
}

type ClockAllowlist = Record<string, number>;

/** @internal */
export function parseClockAllowlist(text: string): ClockAllowlist {
  const value = JSON.parse(text) as { version?: number; files?: unknown };
  if (value.version !== 1 || !value.files || typeof value.files !== "object")
    throw new Error(
      `${PRODUCTION_CLOCK_ALLOWLIST}: expected version 1 and files`,
    );
  for (const [path, uses] of Object.entries(value.files))
    if (!Number.isSafeInteger(uses) || (uses as number) < 1)
      throw new Error(
        `${PRODUCTION_CLOCK_ALLOWLIST}: ${path} needs a positive use count`,
      );
  return value.files as ClockAllowlist;
}

/** @internal Problems with direct clock uses against the allowlist and its base. */
export function compareProductionClock(
  current: Map<string, number[]>,
  allowed: ClockAllowlist,
  base?: ClockAllowlist,
): string[] {
  const problems: string[] = [];
  for (const [path, lines] of current) {
    const limit = allowed[path] ?? 0;
    if (lines.length > limit)
      problems.push(
        `${path}: ${lines.length} direct clock or timer use(s) (lines ${lines.join(", ")}), allowlist ${limit}. Read time and schedule work through the injected clock: the service clock/scheduler on the server, web/src/clock.ts in the browser.`,
      );
    else if (lines.length < limit)
      problems.push(
        `${path}: ${lines.length} direct clock or timer use(s), allowlist ${limit}: lower it (bun scripts/check-test-waits.ts --update).`,
      );
  }
  for (const path of Object.keys(allowed))
    if (!current.has(path))
      problems.push(
        `${path}: no direct clock or timer uses left; remove its allowlist entry (bun scripts/check-test-waits.ts --update).`,
      );
  if (base)
    for (const [path, uses] of Object.entries(allowed))
      if (uses > (base[path] ?? 0))
        problems.push(
          `${path}: the production clock allowlist may only shrink (base ${base[path] ?? 0}, now ${uses}).`,
        );
  return problems;
}

/** @internal The clock allowlist lowered to the current counts; never raised. */
export function loweredClock(
  current: Map<string, number[]>,
  allowed: ClockAllowlist,
): ClockAllowlist {
  const out: ClockAllowlist = {};
  for (const [path, uses] of Object.entries(allowed).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const count = current.get(path)?.length ?? 0;
    if (count > 0) out[path] = Math.min(uses, count);
  }
  return out;
}

/** @internal */
export function formatClockAllowlist(files: ClockAllowlist) {
  return `${JSON.stringify(
    {
      version: 1,
      description:
        "Direct Date.now/performance.now/setTimeout/setInterval calls production code may still hold outside the clock modules. Counts only go down: convert a file to the injected clock, then run bun scripts/check-test-waits.ts --update.",
      files,
    },
    null,
    2,
  )}\n`;
}
