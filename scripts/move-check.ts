/**
 * Confirms that a split is a pure move: every line it removes reappears as an
 * added line, and nothing else is added. Lines are compared trimmed, as a
 * multiset across all files; blank lines, import/export plumbing (including
 * multi-line `import { … } from` blocks) and an `export ` prefix gained by a
 * moved declaration are ignored. A reviewer reads only what it prints.
 *
 *   bun run check:move [base]   (default: merge-base with origin/main)
 */

const PLUMBING =
  /^(import\b|export \{|export \* from|export type \{|\} from ["']|["'][^"']+["'];?$|\};?$)/;

/** A diff line's comparable text, or undefined when it is plumbing. */
export function normalize(line: string): string | undefined {
  const text = line.trim();
  if (!text || PLUMBING.test(text)) return undefined;
  return text.replace(/^export (default )?/, "");
}

export type DiffLines = { removed: string[]; added: string[] };

/** Removed and added lines of a unified diff (any context), import blocks skipped. */
export function diffLines(diff: string): DiffLines {
  const removed: string[] = [];
  const added: string[] = [];
  const inBlock = { "-": false, "+": false };
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++") || raw.startsWith("---")) continue;
    const sign = raw[0];
    if (sign !== "-" && sign !== "+") continue;
    const text = raw.slice(1).trim();
    // Members of a multi-line import/export list are plumbing too.
    if (inBlock[sign]) {
      if (/^\} from |^\};?$/.test(text)) inBlock[sign] = false;
      continue;
    }
    if (
      /^(import|export)( type)? \{$/.test(text) ||
      /^(import|export)( type)? \{[^}]*$/.test(text)
    ) {
      inBlock[sign] = true;
      continue;
    }
    const normal = normalize(raw.slice(1));
    if (normal === undefined) continue;
    (sign === "-" ? removed : added).push(normal);
  }
  return { removed, added };
}

/** Lines removed without reappearing, and lines added that were not removed. */
export function unmoved({ removed, added }: DiffLines) {
  const counts = new Map<string, number>();
  for (const line of removed) counts.set(line, (counts.get(line) ?? 0) + 1);
  const extra: string[] = [];
  for (const line of added) {
    const left = counts.get(line) ?? 0;
    if (left > 0) counts.set(line, left - 1);
    else extra.push(line);
  }
  const lost = [...counts].flatMap(([line, left]) =>
    Array<string>(left).fill(line),
  );
  return { lost, extra };
}

if (import.meta.main) {
  const git = (args: string[]) =>
    Bun.spawnSync(["git", ...args], {
      stdout: "pipe",
      stderr: "inherit",
    }).stdout.toString();
  const base =
    process.argv[2] ?? git(["merge-base", "HEAD", "origin/main"]).trim();
  const diff = git([
    "diff",
    "--no-color",
    "-U0",
    "--find-renames",
    `${base}...HEAD`,
    "--",
    ".",
    ":(exclude)*.md",
    ":(exclude)scripts/file-size-exceptions.json",
  ]);
  const lines = diffLines(diff);
  const { lost, extra } = unmoved(lines);
  const show = (title: string, list: string[]) => {
    if (!list.length) return;
    console.error(`${title} (${list.length}):`);
    for (const line of list.slice(0, 40)) console.error(`  ${line}`);
    if (list.length > 40) console.error(`  … and ${list.length - 40} more`);
  };
  show("Removed and not re-added", lost);
  show("Added without a removed original", extra);
  if (lost.length || extra.length) process.exit(1);
  console.info(
    `[move] pure move: ${lines.removed.length} lines moved since ${base.slice(0, 8)}`,
  );
}
