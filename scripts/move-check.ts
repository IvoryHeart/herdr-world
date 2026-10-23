/**
 * Checks that a split is a move: code removed in one place reappears, in the
 * same order, somewhere else, and nothing else changes. Every removed hunk must
 * be covered by runs of at least MIN_RUN consecutive lines that appear, in that
 * order, inside one added hunk (a hunk shorter than that must reappear whole).
 * Each added line may be used once. Lines are compared trimmed; blank lines,
 * import/export plumbing and an `export ` prefix gained by a moved declaration
 * are ignored, with parser state reset at every hunk and file boundary.
 *
 * Code that stays in its own file is not moved (a split moves code between
 * files), and runs between the same two files must keep their order. This is
 * a move inventory, not a proof: the reviewer reads the leftovers, every run's
 * source and destination, and the import/export lines it ignores.
 *
 *   bun run check:move [base]   (default: merge-base with origin/main)
 */

import { parse } from "@babel/parser";

export const MIN_RUN = 3;

const PLUMBING =
  /^(import(?:\s+(?:type\s+)?[\w*{"']|["'])|export \{|export \* from|export type \{|\} from ["']|["'][^"']+["'];?$|\};?$)/;

/** A diff line's comparable text, or undefined when it is plumbing. */
export function normalize(line: string): string | undefined {
  const text = line.trim();
  if (!text || PLUMBING.test(text)) return undefined;
  return text.replace(/^export (default )?/, "");
}

/**
 * 1-based line numbers of a file's import and export-list statements,
 * including every member line of a multi-line `import { … } from`. A -U0 diff
 * can change one member without showing the statement around it, so plumbing
 * is decided from the file itself.
 */
export function statementLines(text: string, file = "source.ts"): Set<number> {
  const found = new Set<number>();
  if (!/\.[cm]?[jt]sx?$/.test(file)) return found;
  try {
    const { program } = parse(text, {
      sourceType: "unambiguous",
      allowUndeclaredExports: true,
      plugins: /\.[cm]?tsx?$/.test(file)
        ? /\.tsx$/.test(file)
          ? ["typescript", "jsx"]
          : ["typescript"]
        : ["jsx"],
    });
    const code = new Set<number>();
    for (const node of [...program.body, ...program.directives]) {
      if (!node.loc) continue;
      const plumbing =
        node.type === "ImportDeclaration" ||
        node.type === "TSImportEqualsDeclaration" ||
        node.type === "ExportAllDeclaration" ||
        (node.type === "ExportNamedDeclaration" && !node.declaration);
      const lines = plumbing ? found : code;
      for (let line = node.loc.start.line; line <= node.loc.end.line; line++)
        lines.add(line);
    }
    // A diff is line-based: never hide executable code sharing an import line.
    for (const line of code) found.delete(line);
  } catch {
    // Unsupported or invalid syntax must not turn code into ignored plumbing.
    found.clear();
  }
  return found;
}

/** Whether a removed or added line of `file` is import/export plumbing. */
export type Plumbing = (file: string, sign: "-" | "+", line: number) => boolean;

export type Line = { text: string; at: number };
export type Hunk = { file: string; sign: "-" | "+"; lines: Line[] };

/** Removed and added hunks of a unified diff, plumbing skipped, with line numbers. */
export function diffHunks(diff: string, plumbing?: Plumbing): Hunk[] {
  const hunks: Hunk[] = [];
  let file = "";
  let oldFile = "";
  let newFile = "";
  let current: Hunk | undefined;
  let inBlock = false;
  let oldLine = 0;
  let newLine = 0;
  const close = () => {
    if (current?.lines.length) hunks.push(current);
    current = undefined;
  };
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git ") || raw.startsWith("@@")) {
      close();
      inBlock = false;
      const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(raw);
      if (header) [oldLine, newLine] = [Number(header[1]), Number(header[2])];
      continue;
    }
    if (raw.startsWith("+++ ")) {
      newFile = raw.slice(4).replace(/^b\//, "");
      file = newFile === "/dev/null" ? oldFile : newFile;
      continue;
    }
    if (raw.startsWith("--- ")) {
      oldFile = raw.slice(4).replace(/^a\//, "");
      if (raw !== "--- /dev/null") file = oldFile;
      continue;
    }
    const sign = raw[0];
    if (sign !== "-" && sign !== "+") continue;
    const at = sign === "-" ? oldLine++ : newLine++;
    if (current && current.sign !== sign) close();
    if (plumbing?.(sign === "-" ? oldFile : newFile, sign, at)) continue;
    const text = raw.slice(1).trim();
    // Members of a multi-line import/export list, within this hunk only.
    if (!plumbing && inBlock) {
      if (/^\} from |^\};?$/.test(text)) inBlock = false;
      continue;
    }
    if (!plumbing && /^(import|export)( type)? \{[^}]*$/.test(text)) {
      inBlock = true;
      continue;
    }
    // Full-file syntax is authoritative; do not reapply the lossy diff heuristic.
    const normal = plumbing
      ? text
        ? text.replace(/^export (default )?/, "")
        : undefined
      : normalize(raw.slice(1));
    if (normal === undefined) continue;
    current ??= { file, sign, lines: [] };
    current.lines.push({ text: normal, at });
  }
  close();
  return hunks;
}

export type Run = {
  from: string;
  fromLine: number;
  to: string;
  toLine: number;
  lines: number;
  first: string;
};
export type MoveReport = {
  lost: Array<{ file: string; line: string }>;
  extra: Array<{ file: string; line: string }>;
  runs: Run[];
};

/**
 * Match removed hunks to added hunks as in-order runs; report what did not
 * move. A run that stays in its own file, or lands out of order relative to
 * the other runs between the same two files, is a reorder, not a move.
 */
export function matchMoves(hunks: Hunk[]): MoveReport {
  const added = hunks.filter((hunk) => hunk.sign === "+");
  const used = added.map((hunk) => hunk.lines.map(() => false));
  const report: MoveReport = { lost: [], extra: [], runs: [] };
  const candidates: Array<{
    run: Run;
    removed: Line[];
    hunk: number;
    at: number;
  }> = [];
  for (const removed of hunks.filter((hunk) => hunk.sign === "-")) {
    const lines = removed.lines;
    let i = 0;
    while (i < lines.length) {
      // Longest unused in-order run starting at lines[i], within one added
      // hunk of another file.
      let best = { length: 0, hunk: -1, at: -1 };
      added.forEach((target, h) => {
        if (target.file === removed.file) return;
        for (let at = 0; at < target.lines.length; at++) {
          let length = 0;
          while (
            i + length < lines.length &&
            at + length < target.lines.length &&
            !used[h]![at + length] &&
            target.lines[at + length]!.text === lines[i + length]!.text
          )
            length++;
          if (length > best.length) best = { length, hunk: h, at };
        }
      });
      if (best.length >= MIN_RUN) {
        for (let k = 0; k < best.length; k++)
          used[best.hunk]![best.at + k] = true;
        const target = added[best.hunk]!;
        candidates.push({
          run: {
            from: removed.file,
            fromLine: lines[i]!.at,
            to: target.file,
            toLine: target.lines[best.at]!.at,
            lines: best.length,
            first: lines[i]!.text,
          },
          removed: lines.slice(i, i + best.length),
          hunk: best.hunk,
          at: best.at,
        });
        i += best.length;
      } else {
        report.lost.push({ file: removed.file, line: lines[i]!.text });
        i++;
      }
    }
  }
  // Between the same two files, runs keep their source order.
  const lastTo = new Map<string, number>();
  candidates.sort(
    (a, b) =>
      a.run.from.localeCompare(b.run.from) || a.run.fromLine - b.run.fromLine,
  );
  for (const candidate of candidates) {
    const pair = `${candidate.run.from}\0${candidate.run.to}`;
    if (candidate.run.toLine < (lastTo.get(pair) ?? 0)) {
      for (const line of candidate.removed)
        report.lost.push({ file: candidate.run.from, line: line.text });
      for (let k = 0; k < candidate.run.lines; k++)
        used[candidate.hunk]![candidate.at + k] = false;
      continue;
    }
    lastTo.set(pair, candidate.run.toLine);
    report.runs.push(candidate.run);
  }
  added.forEach((hunk, h) =>
    hunk.lines.forEach((line, k) => {
      if (!used[h]![k]) report.extra.push({ file: hunk.file, line: line.text });
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
    // Import/export statements per file version, read from the files; the
    // diff's removed side is the merge base of base and HEAD.
    const from = git(["merge-base", base, "HEAD"]).trim();
    const ranges = new Map<string, Set<number>>();
    const plumbing: Plumbing = (file, sign, line) => {
      if (file === "/dev/null") return false;
      const key = `${sign}${file}`;
      if (!ranges.has(key)) {
        const result = Bun.spawnSync(
          ["git", "show", `${sign === "-" ? from : "HEAD"}:${file}`],
          { stdout: "pipe", stderr: "pipe" },
        );
        ranges.set(
          key,
          result.exitCode === 0
            ? statementLines(result.stdout.toString(), file)
            : new Set(),
        );
      }
      return ranges.get(key)!.has(line);
    };
    const { lost, extra, runs } = matchMoves(diffHunks(diff, plumbing));
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
    for (const run of runs)
      console.info(
        `  ${run.from}:${run.fromLine} -> ${run.to}:${run.toLine} (${run.lines} lines) ${run.first.slice(0, 80)}`,
      );
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
