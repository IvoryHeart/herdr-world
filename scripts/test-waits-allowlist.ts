const ALLOWLIST = "scripts/test-waits-allowlist.json";

type Entry = { pauses: number; reason: string };
export type Allowlist = Record<string, Entry>;

/** @internal */
export function parseAllowlist(text: string): Allowlist {
  const value = JSON.parse(text) as { version?: number; files?: Allowlist };
  if (value.version !== 1 || !value.files || typeof value.files !== "object")
    throw new Error(`${ALLOWLIST}: expected version 1 and files`);
  for (const [path, entry] of Object.entries(value.files))
    if (
      !Number.isSafeInteger(entry?.pauses) ||
      entry.pauses < 1 ||
      typeof entry.reason !== "string" ||
      !entry.reason.trim() ||
      entry.reason.includes("\n")
    )
      throw new Error(
        `${ALLOWLIST}: ${path} needs a positive pause count and a one-line reason`,
      );
  return value.files;
}

/** @internal Problems with the current counts against the allowlist and its base. */
export function compare(
  current: Map<string, number[]>,
  allowed: Allowlist,
  base?: Allowlist,
): string[] {
  const problems: string[] = [];
  for (const [path, lines] of current) {
    const limit = allowed[path]?.pauses ?? 0;
    if (lines.length > limit)
      problems.push(
        `${path}: ${lines.length} fixed sleep(s) (lines ${lines.join(", ")}), allowlist ${limit}. Wait for the event, promise, message or DOM change instead, or count the cycles that prove nothing happened.`,
      );
    else if (lines.length < limit)
      problems.push(
        `${path}: ${lines.length} fixed sleep(s), allowlist ${limit}: lower it (bun scripts/check-test-waits.ts --update).`,
      );
  }
  for (const path of Object.keys(allowed))
    if (!current.has(path))
      problems.push(
        `${path}: no longer a test file; remove its allowlist entry.`,
      );
  if (base)
    for (const [path, entry] of Object.entries(allowed))
      if (entry.pauses > (base[path]?.pauses ?? 0))
        problems.push(
          `${path}: the allowlist may only shrink (base ${base[path]?.pauses ?? 0}, now ${entry.pauses}).`,
        );
  return problems;
}

/** @internal The allowlist lowered to the current counts; never raised. */
export function lowered(
  current: Map<string, number[]>,
  allowed: Allowlist,
): Allowlist {
  const out: Allowlist = {};
  for (const [path, entry] of Object.entries(allowed).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const count = current.get(path)?.length ?? 0;
    if (count > 0)
      out[path] = { ...entry, pauses: Math.min(entry.pauses, count) };
  }
  return out;
}

/** @internal */
export function formatAllowlist(files: Allowlist) {
  return `${JSON.stringify(
    {
      version: 1,
      description:
        "Fixed sleeps a test file may still hold (#1419). Counts only go down: fix a file, then run bun scripts/check-test-waits.ts --update.",
      files,
    },
    null,
    2,
  )}\n`;
}
