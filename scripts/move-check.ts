/**
 * Checks that a split is a move: code removed in one place reappears, in the
 * same order, somewhere else, and nothing else changes. Runs of at least MIN_RUN
 * consecutive lines establish a mapping between two files. Shorter fragments
 * may join an established mapping only at a unique, order-preserving location.
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
  /^(import\s+(?:type\s+)?[\w*{]|export \{|export \* from|export type \{|\} from ["']|["'][^"']+["'];?$|\};?$)/;

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
        (node.type === "ImportDeclaration" && node.specifiers.length > 0) ||
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
  anchored?: true;
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
  const removed = hunks.filter((hunk) => hunk.sign === "-");
  const added = hunks.filter((hunk) => hunk.sign === "+");
  const used = added.map((hunk) => hunk.lines.map(() => false));
  const moved = removed.map((hunk) => hunk.lines.map(() => false));
  const report: MoveReport = { lost: [], extra: [], runs: [] };
  type Candidate = {
    run: Run;
    removed: Line[];
    source: number;
    start: number;
    hunk: number;
    at: number;
  };
  const candidates: Candidate[] = [];
  const mappings = new Map<string, Candidate[]>();
  const pair = (from: string, to: string) => `${from}\0${to}`;
  const candidate = (
    source: number,
    start: number,
    hunk: number,
    at: number,
    length: number,
  ): Candidate => ({
    run: {
      from: removed[source]!.file,
      fromLine: removed[source]!.lines[start]!.at,
      to: added[hunk]!.file,
      toLine: added[hunk]!.lines[at]!.at,
      lines: length,
      first: removed[source]!.lines[start]!.text,
    },
    removed: removed[source]!.lines.slice(start, start + length),
    source,
    start,
    hunk,
    at,
  });
  const sourceEnd = (c: Candidate) => c.removed.at(-1)!.at;
  const targetEnd = (c: Candidate) =>
    added[c.hunk]!.lines[c.at + c.run.lines - 1]!.at;
  const fits = (c: Candidate, anchors: Candidate[]) =>
    anchors.every((anchor) =>
      sourceEnd(c) < anchor.run.fromLine
        ? targetEnd(c) < anchor.run.toLine
        : sourceEnd(anchor) < c.run.fromLine &&
          targetEnd(anchor) < c.run.toLine,
    );
  const accept = (c: Candidate) => {
    for (let k = 0; k < c.run.lines; k++) {
      used[c.hunk]![c.at + k] = true;
      moved[c.source]![c.start + k] = true;
    }
    const key = pair(c.run.from, c.run.to);
    const anchors = mappings.get(key) ?? [];
    anchors.push(c);
    mappings.set(key, anchors);
    report.runs.push(c.run);
  };
  for (let source = 0; source < removed.length; source++) {
    const lines = removed[source]!.lines;
    let i = 0;
    while (i < lines.length) {
      // Longest unused in-order run starting at lines[i], within one added
      // hunk of another file.
      let best = { length: 0, hunk: -1, at: -1 };
      added.forEach((target, h) => {
        if (target.file === removed[source]!.file) return;
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
        candidates.push(candidate(source, i, best.hunk, best.at, best.length));
        i += best.length;
      } else {
        i++;
      }
    }
  }
  // Between the same two files, runs keep their source order.
  candidates.sort(
    (a, b) =>
      a.run.from.localeCompare(b.run.from) || a.run.fromLine - b.run.fromLine,
  );
  for (const candidate of candidates) {
    const anchors =
      mappings.get(pair(candidate.run.from, candidate.run.to)) ?? [];
    if (!fits(candidate, anchors)) {
      for (let k = 0; k < candidate.run.lines; k++)
        used[candidate.hunk]![candidate.at + k] = false;
      continue;
    }
    accept(candidate);
  }

  // Small pieces are evidence only within a mapping established above. Search
  // every remaining eligible destination, including other hunks and files;
  // ambiguous matches stay in the inventory. Accepted pieces also constrain
  // later pieces, so shorts cannot cross each other between the full runs.
  for (let source = 0; source < removed.length; source++) {
    const origin = removed[source]!;
    for (let i = 0; i < origin.lines.length; i++) {
      if (moved[source]![i]) continue;
      let best: Candidate | undefined;
      let ambiguous = false;
      for (let h = 0; h < added.length; h++) {
        const target = added[h]!;
        const anchors = mappings.get(pair(origin.file, target.file));
        if (!anchors || origin.file === target.file) continue;
        for (let at = 0; at < target.lines.length; at++) {
          let length = 0;
          while (
            length < MIN_RUN - 1 &&
            i + length < origin.lines.length &&
            at + length < target.lines.length &&
            !moved[source]![i + length] &&
            !used[h]![at + length] &&
            origin.lines[i + length]!.text === target.lines[at + length]!.text
          )
            length++;
          if (!length) continue;
          const c = candidate(source, i, h, at, length);
          if (!fits(c, anchors)) continue;
          if (!best || length > best.run.lines) {
            best = c;
            ambiguous = false;
          } else if (length === best.run.lines) ambiguous = true;
        }
      }
      if (best && !ambiguous) {
        best.run.anchored = true;
        accept(best);
        i += best.run.lines - 1;
      }
    }
  }
  removed.forEach((hunk, h) =>
    hunk.lines.forEach((line, k) => {
      if (!moved[h]![k]) report.lost.push({ file: hunk.file, line: line.text });
    }),
  );
  report.runs.sort(
    (a, b) => a.from.localeCompare(b.from) || a.fromLine - b.fromLine,
  );
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
      "--diff-algorithm=histogram",
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
    const ranges = new Map<
      string,
      { statements: Set<number>; lines: string[] }
    >();
    const ignored = new Map<string, string[]>();
    const plumbing: Plumbing = (file, sign, line) => {
      if (file === "/dev/null") return false;
      const key = `${sign}${file}`;
      if (!ranges.has(key)) {
        const result = Bun.spawnSync(
          ["git", "show", `${sign === "-" ? from : "HEAD"}:${file}`],
          { stdout: "pipe", stderr: "pipe" },
        );
        const text = result.exitCode === 0 ? result.stdout.toString() : "";
        ranges.set(key, {
          statements: statementLines(text, file),
          lines: text.split("\n"),
        });
      }
      const version = ranges.get(key)!;
      if (!version.statements.has(line)) return false;
      const lines = ignored.get(file) ?? [];
      lines.push(`${sign}${line}: ${version.lines[line - 1]!.trim()}`);
      ignored.set(file, lines);
      return true;
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
        `  ${run.from}:${run.fromLine} -> ${run.to}:${run.toLine} (${run.lines} lines${run.anchored ? ", anchored fragment" : ""}) ${run.first.slice(0, 80)}`,
      );
    for (const [file, lines] of ignored) {
      console.info(
        `Ignored import/export plumbing in ${file} (${lines.length}):`,
      );
      for (const line of lines.slice(0, 40)) console.info(`  ${line}`);
      if (lines.length > 40) console.info(`  … and ${lines.length - 40} more`);
    }
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
