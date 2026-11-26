import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve } from "node:path";
import { parse } from "@babel/parser";

export const BASELINE = "scripts/dead-code-baseline.json";
export const KINDS = [
  "files",
  "exports",
  "types",
  "dependencies",
  "devDependencies",
] as const;
type Kind = (typeof KINDS)[number];
export type Findings = Record<Kind, string[]>;
type Symbol = { name: string; line?: number; pos?: number };
type KnipReport = {
  issues: ({ file: string } & Partial<Record<Kind, Symbol[]>>)[];
};
type CloneFile = { name: string; start: number; end: number };
export type Clone = {
  firstFile: CloneFile;
  secondFile: CloneFile;
  lines: number;
  tokens: number;
};

export function findings(report: KnipReport): Findings {
  return Object.fromEntries(
    KINDS.map((kind) => [
      kind,
      [
        ...new Set(
          report.issues.flatMap((row) =>
            (row[kind] ?? []).map((item) =>
              kind === "files" ? row.file : `${row.file}#${item.name}`,
            ),
          ),
        ),
      ].sort(),
    ]),
  ) as Findings;
}

export function parseBaseline(text: string): Findings {
  const value = JSON.parse(text);
  if (
    value.version !== 1 ||
    !value.findings ||
    Object.keys(value.findings).length !== KINDS.length
  )
    throw new Error(`${BASELINE}: expected version 1 and all finding kinds`);
  for (const kind of KINDS) {
    const rows = value.findings[kind];
    if (
      !Array.isArray(rows) ||
      rows.some((row) => typeof row !== "string" || !row) ||
      new Set(rows).size !== rows.length
    )
      throw new Error(`${BASELINE}: invalid or duplicate ${kind}`);
  }
  return value.findings;
}

export function subtract(current: Findings, baseline: Findings): Findings {
  return Object.fromEntries(
    KINDS.map((kind) => {
      const allowed = new Set(baseline[kind]);
      return [kind, current[kind].filter((item) => !allowed.has(item))];
    }),
  ) as Findings;
}

export function prune(baseline: Findings, current: Findings): Findings {
  return Object.fromEntries(
    KINDS.map((kind) => {
      const present = new Set(current[kind]);
      return [kind, baseline[kind].filter((item) => present.has(item)).sort()];
    }),
  ) as Findings;
}

function count(rows: Findings) {
  return KINDS.reduce((sum, kind) => sum + rows[kind].length, 0);
}

function serialize(rows: Findings) {
  return JSON.stringify({ version: 1, findings: rows }, null, 2) + "\n";
}

/** Print a pruned baseline as the repository's formatter would, so format:check still passes. */
function formatBaseline(root: string, text: string) {
  const biome = resolve(root, "node_modules/@biomejs/biome/bin/biome");
  if (!existsSync(biome)) return text;
  const result = Bun.spawnSync(
    [process.execPath, biome, "format", `--stdin-file-path=${BASELINE}`],
    { cwd: root, stdin: Buffer.from(text), stdout: "pipe", stderr: "pipe" },
  );
  return result.exitCode === 0 ? result.stdout.toString() : text;
}

/** Compare the committed allowance too, so adding a finding to the baseline cannot bless it. */
function baselineAtBase(root: string): Findings | undefined {
  const target = process.env.HERDR_WORLD_RATCHET_TARGET;
  const merge = Bun.spawnSync(["git", "merge-base", "HEAD", "origin/main"], {
    cwd: root,
  });
  const ref =
    target ||
    (merge.exitCode === 0 ? merge.stdout.toString().trim() : undefined);
  if (!ref) return;
  const git = (args: string[]) =>
    Bun.spawnSync(["git", ...args], { cwd: root });
  // A nonexistent ref is an error; a base predating this check is the initial adoption.
  if (git(["rev-parse", "--verify", `${ref}^{commit}`]).exitCode !== 0)
    throw new Error(`Cannot resolve dead-code baseline base ${ref}`);
  const entry = `${ref}:${BASELINE}`;
  if (git(["cat-file", "-e", entry]).exitCode !== 0) return;
  const result = git(["show", entry]);
  if (result.exitCode !== 0)
    throw new Error("Cannot read dead-code baseline at base");
  return parseBaseline(result.stdout.toString());
}

/** Line counts rank whole unused files and enclosing export declarations, not name lengths. */
function largest(report: KnipReport, root: string) {
  const rows: {
    path: string;
    kind: Kind;
    name: string;
    line: number;
    lines: number;
  }[] = [];
  for (const row of report.issues) {
    const source = readFileSync(resolve(root, row.file), "utf8");
    const statements =
      row.exports?.length || row.types?.length
        ? parse(source, {
            sourceType: "module",
            plugins: row.file.endsWith(".tsx")
              ? ["typescript", "jsx"]
              : ["typescript"],
          }).program.body
        : [];
    for (const kind of KINDS)
      for (const item of row[kind] ?? []) {
        let line = item.line ?? 1;
        let lines = 0;
        if (kind === "files") lines = source.trimEnd().split("\n").length;
        else if (kind !== "dependencies" && kind !== "devDependencies") {
          const declaration = statements.find(
            (node) =>
              (node.start ?? 0) <= (item.pos ?? -1) &&
              (node.end ?? 0) >= (item.pos ?? -1),
          );
          if (declaration) {
            line = declaration.loc?.start.line ?? line;
            lines = (declaration.loc?.end.line ?? line) - line + 1;
          }
        }
        rows.push({ path: row.file, kind, name: item.name, line, lines });
      }
  }
  return rows
    .sort(
      (a, b) =>
        b.lines - a.lines ||
        `${a.path}#${a.name}`.localeCompare(`${b.path}#${b.name}`),
    )
    .slice(0, 20);
}

const cell = (value: string) =>
  value.replaceAll("|", "\\|").replaceAll("\n", " ");
export function duplicateSummary(clones: Clone[], root: string): string {
  const path = (file: CloneFile) =>
    `${cell(relative(root, resolve(root, file.name)))}:${file.start}–${file.end}`;
  const sorted = [...clones].sort(
    (a, b) =>
      b.lines - a.lines ||
      b.tokens - a.tokens ||
      path(a.firstFile).localeCompare(path(b.firstFile)),
  );
  return [
    `### jscpd: ${clones.length} duplicated blocks (report only)`,
    "",
    "Largest 20 blocks; minimum 10 lines / 100 tokens; test files and generated indexes excluded.",
    "",
    "| Lines | Tokens | First block | Second block |",
    "| ---: | ---: | --- | --- |",
    ...sorted
      .slice(0, 20)
      .map(
        (clone) =>
          `| ${clone.lines} | ${clone.tokens} | ${path(clone.firstFile)} | ${path(clone.secondFile)} |`,
      ),
  ].join("\n");
}

async function run(command: string[], root: string) {
  const start = performance.now();
  const child = Bun.spawn(command, {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code, seconds: (performance.now() - start) / 1000 };
}

export async function checkDead(root: string, args: string[]) {
  const start = performance.now();
  const output = resolve(root, ".agents/dead-code");
  mkdirSync(output, { recursive: true });
  // JSON reports stay local. CI prints paths/counts, never source fragments.
  const knip = await run(
    [
      process.execPath,
      resolve(root, "node_modules/knip/bin/knip.js"),
      "--production",
      "--config",
      "knip.jsonc",
      "--include",
      KINDS.join(","),
      "--reporter",
      "json",
      "--no-exit-code",
      "--no-config-hints",
    ],
    root,
  );
  writeFileSync(resolve(output, "knip.json"), knip.stdout);
  // Production mode intentionally omits devDependencies. Audit those separately
  // with test/config entries enabled, so test tooling is correctly kept alive.
  const development = await run(
    [
      process.execPath,
      resolve(root, "node_modules/knip/bin/knip.js"),
      "--config",
      "knip.jsonc",
      "--include",
      "dependencies,devDependencies",
      "--reporter",
      "json",
      "--no-exit-code",
      "--no-config-hints",
    ],
    root,
  );
  writeFileSync(resolve(output, "knip-development.json"), development.stdout);
  const duplicatePath = resolve(output, "jscpd-report.json");
  rmSync(duplicatePath, { force: true });
  // Never reuse a previous run's report if jscpd fails this time.
  const duplicate = await run(
    [
      process.execPath,
      resolve(root, "node_modules/jscpd/run-jscpd.js"),
      "--config",
      ".jscpd.json",
      "--output",
      output,
    ],
    root,
  );
  let duplicateText: string;
  try {
    if (duplicate.code !== 0)
      throw new Error(
        duplicate.stderr || duplicate.stdout || `exit ${duplicate.code}`,
      );
    const text = readFileSync(duplicatePath, "utf8");
    const report = JSON.parse(text);
    if (!Array.isArray(report.duplicates))
      throw new Error("invalid duplicate report");
    duplicateText = duplicateSummary(report.duplicates, root);
  } catch (error) {
    duplicateText = `### jscpd (report only)\n\nReport unavailable: ${cell(String(error)).slice(0, 1000)}`;
  }

  let code: number;
  let knipText: string;
  try {
    if (knip.code !== 0)
      throw new Error(knip.stderr || knip.stdout || `exit ${knip.code}`);
    if (development.code !== 0)
      throw new Error(
        development.stderr ||
          development.stdout ||
          `development audit exit ${development.code}`,
      );
    const report: KnipReport = JSON.parse(knip.stdout);
    const developmentReport: KnipReport = JSON.parse(development.stdout);
    // Only devDependency issues belong to the second run; code findings remain production-only.
    report.issues.push(
      ...developmentReport.issues.map((row) => ({
        file: row.file,
        devDependencies: row.devDependencies,
      })),
    );
    const current = findings(report);
    writeFileSync(resolve(output, "findings.json"), serialize(current));
    const file = resolve(root, BASELINE);
    if (args.includes("--init-baseline")) {
      if (existsSync(file) || baselineAtBase(root))
        throw new Error(
          "Baseline initialization is only allowed before adoption",
        );
      writeFileSync(file, serialize(current));
    }
    const baseline = parseBaseline(readFileSync(file, "utf8"));
    const added = subtract(current, baseline);
    const base = baselineAtBase(root);
    const padding = base ? subtract(baseline, base) : undefined;
    const resolved = count(baseline) - count(prune(baseline, current));
    code = count(added) || (padding && count(padding)) ? 1 : 0;
    // A successful local run automatically retires resolved allowances. CI stays read-only.
    if (!code && resolved && args.includes("--prune"))
      writeFileSync(
        file,
        formatBaseline(root, serialize(prune(baseline, current))),
      );
    knipText = [
      "### Knip (production code; development dependencies audited with tests enabled)",
      "",
      ...KINDS.map(
        (kind) =>
          `- ${kind}: ${current[kind].length} (${added[kind].length} new)`,
      ),
      "",
      `${resolved} resolved baseline entries${args.includes("--prune") ? " pruned on success" : "; use --prune to retire"}.`,
      ...(padding && count(padding)
        ? ["Baseline additions are forbidden relative to the base revision."]
        : []),
      ...(count(added)
        ? [
            "",
            "New unused code:",
            ...KINDS.flatMap((kind) =>
              added[kind].map((entry) => `- ${kind}: ${cell(entry)}`),
            ),
            "",
            "Test support belongs in testing/ or *.fixture.*, *.cases.*, *.browserMock.* (development-only Knip entries); move nonstandard test helpers there, including renamed baseline helpers. For an intentional test-seam export in production code, use /** @internal */. Otherwise remove the unused export or wire the code into its production entry; do not pad the baseline.",
          ]
        : []),
      "",
      "Largest 20 findings by file/declaration lines (test-support entries excluded; production exports used only by tests count unless tagged @internal; an unused export may still be used within its own file):",
      "",
      "| Lines | Kind | Path | Symbol |",
      "| ---: | --- | --- | --- |",
      ...largest(report, root).map(
        (row) =>
          `| ${row.lines} | ${row.kind} | ${cell(row.path)}:${row.line} | ${row.kind === "files" ? "—" : cell(row.name)} |`,
      ),
    ].join("\n");
  } catch (error) {
    code = 1;
    knipText = `### Knip failed\n\n${cell(String(error)).slice(0, 2000)}`;
  }
  const seconds = (performance.now() - start) / 1000;
  const summary = [
    "## Dead and copied code",
    "",
    knipText,
    "",
    duplicateText,
    "",
    `Timing: knip production ${knip.seconds.toFixed(2)}s; development dependencies ${development.seconds.toFixed(2)}s; jscpd ${duplicate.seconds.toFixed(2)}s; total ${seconds.toFixed(2)}s.`,
    "",
    `Ratchet: ${code ? "FAIL" : "PASS"}. Full reports: .agents/dead-code/.`,
    "",
  ].join("\n");
  console.info(summary);
  writeFileSync(resolve(output, "summary.md"), summary);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  return code;
}

if (import.meta.main)
  process.exitCode = await checkDead(process.cwd(), process.argv.slice(2));
