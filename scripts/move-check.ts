/**
 * Checks that a split is a move: code removed in one place reappears, in the
 * same order, somewhere else, and nothing else changes. Every removed hunk must
 * be covered by runs of at least MIN_RUN consecutive lines that appear, in that
 * order, inside one added hunk (a hunk shorter than that must reappear whole).
 * Each added line may be used once. Lines are compared trimmed; blank lines,
 * import/export plumbing and an `export ` prefix gained by a moved declaration
 * are ignored, with parser state reset at every hunk and file boundary.
 *
 * What it prints is what a reviewer reads: the lines that did not move, and
 * where each moved run went. Reordering whole runs is still a move here, so
 * the run list is part of the review.
 *
 *   bun run check:move [base]   (default: merge-base with origin/main)
 */

export const MIN_RUN = 3;

const PLUMBING =
  /^(import\b|export \{|export \* from|export type \{|\} from ["']|["'][^"']+["'];?$|\};?$)/;

/** A diff line's comparable text, or undefined when it is plumbing. */
export function normalize(line: string): string | undefined {
  const text = line.trim();
  if (!text || PLUMBING.test(text)) return undefined;
  return text.replace(/^export (default )?/, "");
}

export type Hunk = { file: string; sign: "-" | "+"; lines: string[] };

/** Removed and added hunks of a unified diff, plumbing skipped. */
export function diffHunks(diff: string): Hunk[] {
  const hunks: Hunk[] = [];
  let file = "";
  let current: Hunk | undefined;
  let inBlock = false;
  const close = () => {
    if (current?.lines.length) hunks.push(current);
    current = undefined;
  };
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git ") || raw.startsWith("@@")) {
      close();
      inBlock = false;
      continue;
    }
    if (raw.startsWith("+++ ")) {
      file = raw.slice(4).replace(/^b\//, "");
      continue;
    }
    if (raw.startsWith("--- ")) {
      if (raw !== "--- /dev/null") file = raw.slice(4).replace(/^a\//, "");
      continue;
    }
    const sign = raw[0];
    if (sign !== "-" && sign !== "+") continue;
    if (current && current.sign !== sign) close();
    const text = raw.slice(1).trim();
    // Members of a multi-line import/export list, within this hunk only.
    if (inBlock) {
      if (/^\} from |^\};?$/.test(text)) inBlock = false;
      continue;
    }
    if (/^(import|export)( type)? \{[^}]*$/.test(text)) {
      inBlock = true;
      continue;
    }
    const normal = normalize(raw.slice(1));
    if (normal === undefined) continue;
    current ??= { file, sign, lines: [] };
    current.lines.push(normal);
  }
  close();
  return hunks;
}

export type MoveReport = {
  lost: Array<{ file: string; line: string }>;
  extra: Array<{ file: string; line: string }>;
  runs: Array<{ from: string; to: string; lines: number }>;
};

/** Match removed hunks to added hunks as in-order runs; report what did not move. */
export function matchMoves(hunks: Hunk[]): MoveReport {
  const added = hunks.filter((hunk) => hunk.sign === "+");
  const used = added.map((hunk) => hunk.lines.map(() => false));
  const report: MoveReport = { lost: [], extra: [], runs: [] };
  for (const removed of hunks.filter((hunk) => hunk.sign === "-")) {
    const lines = removed.lines;
    const minimum = MIN_RUN;
    let i = 0;
    while (i < lines.length) {
      // Longest unused in-order run starting at lines[i], within one added hunk.
      let best = { length: 0, hunk: -1, at: -1 };
      added.forEach((target, h) => {
        for (let at = 0; at < target.lines.length; at++) {
          let length = 0;
          while (
            i + length < lines.length &&
            at + length < target.lines.length &&
            !used[h]![at + length] &&
            target.lines[at + length] === lines[i + length]
          )
            length++;
          if (length > best.length) best = { length, hunk: h, at };
        }
      });
      if (best.length >= minimum) {
        for (let k = 0; k < best.length; k++)
          used[best.hunk]![best.at + k] = true;
        report.runs.push({
          from: removed.file,
          to: added[best.hunk]!.file,
          lines: best.length,
        });
        i += best.length;
      } else {
        report.lost.push({ file: removed.file, line: lines[i]! });
        i++;
      }
    }
  }
  added.forEach((hunk, h) =>
    hunk.lines.forEach((line, k) => {
      if (!used[h]![k]) report.extra.push({ file: hunk.file, line });
    }),
  );
  return report;
}

function git(args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0)
    throw new Error(
      `git ${args[0]} failed: ${result.stderr.toString().trim() || `exit ${result.exitCode}`}`,
    );
  return result.stdout.toString();
}

if (import.meta.main) {
  try {
    const base =
      process.argv[2] ?? git(["merge-base", "HEAD", "origin/main"]).trim();
    git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
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
    const { lost, extra, runs } = matchMoves(diffHunks(diff));
    const show = (
      title: string,
      list: Array<{ file: string; line: string }>,
    ) => {
      if (!list.length) return;
      console.error(`${title} (${list.length}):`);
      for (const { file, line } of list.slice(0, 40))
        console.error(`  ${file}: ${line}`);
      if (list.length > 40) console.error(`  … and ${list.length - 40} more`);
    };
    const moved = runs.reduce((sum, run) => sum + run.lines, 0);
    console.info(
      `[move] ${moved} lines in ${runs.length} runs since ${base.slice(0, 8)}:`,
    );
    for (const run of runs.slice(0, 60))
      console.info(`  ${run.lines} lines ${run.from} -> ${run.to}`);
    show("Removed and not moved", lost);
    show("Added without a moved original", extra);
    if (lost.length || extra.length) process.exit(1);
    console.info(
      "[move] every changed line moved in order; review the runs above",
    );
  } catch (error) {
    console.error(
      `[move] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
