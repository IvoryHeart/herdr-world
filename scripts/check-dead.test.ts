import { afterEach, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  duplicateSummary,
  findings,
  parseBaseline,
  prune,
  subtract,
  type Findings,
} from "./check-dead";

const empty = (): Findings => ({
  files: [],
  exports: [],
  types: [],
  dependencies: [],
  devDependencies: [],
});
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test("ratchet compares identities, tolerates line movement, and only shrinks allowances", () => {
  const baseline = {
    ...empty(),
    exports: ["src/a.ts#old", "src/b.ts#removed"],
  };
  const current = findings({
    issues: [
      {
        file: "src/a.ts",
        exports: [
          { name: "old", line: 900 },
          { name: "new", line: 4 },
        ],
      },
    ],
  });
  expect(subtract(current, baseline)).toEqual({
    ...empty(),
    exports: ["src/a.ts#new"],
  });
  expect(prune(baseline, current)).toEqual({
    ...empty(),
    exports: ["src/a.ts#old"],
  });
  expect(subtract({ ...empty(), exports: ["src/a.ts#old"] }, baseline)).toEqual(
    empty(),
  );
  expect(
    subtract(
      {
        ...empty(),
        files: ["src/orphan.ts"],
        types: ["src/a.ts#Dead"],
        dependencies: ["package.json#unused"],
      },
      baseline,
    ),
  ).toEqual({
    ...empty(),
    files: ["src/orphan.ts"],
    types: ["src/a.ts#Dead"],
    dependencies: ["package.json#unused"],
  });
});

test("malformed baselines cannot silently disable a kind", () => {
  expect(() => parseBaseline('{"version":1,"findings":{}}')).toThrow();
  expect(() =>
    parseBaseline(
      JSON.stringify({
        version: 1,
        findings: { ...empty(), files: ["a", "a"] },
      }),
    ),
  ).toThrow();
  expect(() =>
    parseBaseline(JSON.stringify({ version: 2, findings: empty() })),
  ).toThrow();
});

test("duplicate report ranks blocks and retains repository-relative paths", () => {
  const first = { name: "/fixture/server/a.ts", start: 10, end: 30 };
  const second = { name: "/fixture/web/b.ts", start: 4, end: 24 };
  const summary = duplicateSummary(
    [
      { firstFile: first, secondFile: second, lines: 20, tokens: 100 },
      { firstFile: second, secondFile: first, lines: 40, tokens: 200 },
    ],
    "/fixture",
  );
  expect(summary).toContain("2 duplicated blocks (report only)");
  expect(summary).toContain("web/b.ts:4–24");
  expect(summary.indexOf("| 40 |")).toBeLessThan(summary.indexOf("| 20 |"));
  expect(summary).not.toContain("/fixture/");
});

test("CLI fails new findings, prunes resolutions, publishes both reports, and keeps jscpd failure advisory", () => {
  const root = mkdtempSync(join(tmpdir(), "dead-code-cli-"));
  roots.push(root);
  const write = (path: string, text: string) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  write(
    "scripts/dead-code-baseline.json",
    JSON.stringify({
      version: 1,
      findings: { ...empty(), exports: ["src/live.ts#old"] },
    }),
  );
  write("src/live.ts", "export const old = 1;\nexport const added = 2;\n");
  write(
    "node_modules/knip/bin/knip.js",
    'console.log(await Bun.file("report.json").text());',
  );
  write("node_modules/jscpd/run-jscpd.js", "process.exit(7);");
  const report = (names: string[]) =>
    write(
      "report.json",
      JSON.stringify({
        issues: [
          {
            file: "src/live.ts",
            exports: names.map((name) => ({ name, line: 1, pos: 13 })),
          },
        ],
      }),
    );
  const summary = join(root, "summary.md");
  const run = (ci = false, prune = false) =>
    Bun.spawnSync(
      [
        process.execPath,
        new URL("./check-dead.ts", import.meta.url).pathname,
        ...(prune ? ["--prune"] : []),
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          CI: ci ? "true" : "false",
          HERDR_WORLD_RATCHET_TARGET: "",
          GITHUB_STEP_SUMMARY: summary,
        },
      },
    );
  report(["old", "added"]);
  const failure = run();
  expect(failure.exitCode).toBe(1);
  expect(failure.stdout.toString()).toContain("testing/");
  expect(failure.stdout.toString()).toContain("@internal");
  expect(readFileSync(summary, "utf8")).toContain("src/live.ts#added");
  expect(readFileSync(summary, "utf8")).toContain("jscpd (report only)");
  report([]);
  expect(run(true).exitCode).toBe(0);
  expect(
    parseBaseline(
      readFileSync(join(root, "scripts/dead-code-baseline.json"), "utf8"),
    ).exports,
  ).toEqual(["src/live.ts#old"]);
  expect(run().exitCode).toBe(0);
  expect(
    parseBaseline(
      readFileSync(join(root, "scripts/dead-code-baseline.json"), "utf8"),
    ).exports,
  ).toEqual(["src/live.ts#old"]);
  expect(run(false, true).exitCode).toBe(0);
  expect(
    parseBaseline(
      readFileSync(join(root, "scripts/dead-code-baseline.json"), "utf8"),
    ),
  ).toEqual(empty());
  // A stale JSON file from an earlier successful duplicate report must not be reused.
  write(
    ".agents/dead-code/jscpd-report.json",
    JSON.stringify({ duplicates: [] }),
  );
  expect(run().stdout.toString()).toContain("Report unavailable");
});

test("CLI rejects padding the committed baseline", () => {
  const root = mkdtempSync(join(tmpdir(), "dead-code-base-"));
  roots.push(root);
  const write = (path: string, text: string) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: root });
    expect(result.exitCode).toBe(0);
    return result.stdout.toString().trim();
  };
  write(
    "scripts/dead-code-baseline.json",
    JSON.stringify({ version: 1, findings: empty() }),
  );
  git("init", "--quiet");
  git("add", ".");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  );
  const base = git("rev-parse", "HEAD");
  write(
    "scripts/dead-code-baseline.json",
    JSON.stringify({
      version: 1,
      findings: { ...empty(), exports: ["src/a.ts#padded"] },
    }),
  );
  write("src/a.ts", "export const padded = 1;");
  write(
    "node_modules/knip/bin/knip.js",
    'console.log(JSON.stringify({ issues: [{ file: "src/a.ts", exports: [{ name: "padded", pos: 13 }] }] }));',
  );
  write(
    "node_modules/jscpd/run-jscpd.js",
    'await Bun.write(".agents/dead-code/jscpd-report.json", JSON.stringify({ duplicates: [] }));',
  );
  const result = Bun.spawnSync(
    [process.execPath, new URL("./check-dead.ts", import.meta.url).pathname],
    {
      cwd: root,
      env: {
        ...process.env,
        HERDR_WORLD_RATCHET_TARGET: base,
        GITHUB_STEP_SUMMARY: "",
      },
    },
  );
  expect(result.exitCode).toBe(1);
  expect(result.stdout.toString()).toContain(
    "Baseline additions are forbidden",
  );
  expect(result.stdout.toString()).toContain("jscpd: 0 duplicated blocks");
});

test("a pruned baseline is written as the repository formatter prints it", () => {
  const root = mkdtempSync(join(tmpdir(), "dead-code-format-"));
  roots.push(root);
  const write = (path: string, text: string) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  write(
    "biome.json",
    readFileSync(new URL("../biome.json", import.meta.url), "utf8"),
  );
  write(".gitignore", "node_modules/\n.agents/\n");
  mkdirSync(join(root, "node_modules"), { recursive: true });
  symlinkSync(
    new URL("../node_modules/@biomejs", import.meta.url).pathname,
    join(root, "node_modules/@biomejs"),
  );
  // One short array survives the prune: JSON.stringify spreads it over lines,
  // while the formatter keeps it on one.
  write(
    "scripts/dead-code-baseline.json",
    JSON.stringify(
      {
        version: 1,
        findings: { ...empty(), exports: ["src/a.ts#kept", "src/a.ts#gone"] },
      },
      null,
      2,
    ),
  );
  write(
    "node_modules/knip/bin/knip.js",
    'console.log(JSON.stringify({ issues: [{ file: "src/a.ts", exports: [{ name: "kept", line: 1, pos: 13 }] }] }));',
  );
  write(
    "node_modules/jscpd/run-jscpd.js",
    'await Bun.write(".agents/dead-code/jscpd-report.json", JSON.stringify({ duplicates: [] }));',
  );
  write("src/a.ts", "export const kept = 1;\n");
  const result = Bun.spawnSync(
    [
      process.execPath,
      new URL("./check-dead.ts", import.meta.url).pathname,
      "--prune",
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        CI: "false",
        HERDR_WORLD_RATCHET_TARGET: "",
        GITHUB_STEP_SUMMARY: "",
      },
    },
  );
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("1 resolved baseline entries");
  const baseline = readFileSync(
    join(root, "scripts/dead-code-baseline.json"),
    "utf8",
  );
  expect(parseBaseline(baseline).exports).toEqual(["src/a.ts#kept"]);
  // The same check format:check runs over the repository.
  const check = Bun.spawnSync(
    [
      process.execPath,
      join(root, "node_modules/@biomejs/biome/bin/biome"),
      "format",
      "scripts/dead-code-baseline.json",
    ],
    { cwd: root },
  );
  expect(check.stderr.toString() + check.stdout.toString()).not.toContain("×");
  expect(check.exitCode).toBe(0);
});

test("real production Knip follows RPC strings, feature namespaces, dynamic imports and executable entries; tests do not keep exports alive", () => {
  const root = mkdtempSync(join(tmpdir(), "dead-code-"));
  roots.push(root);
  const write = (path: string, text: string) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  write(
    "knip.jsonc",
    readFileSync(new URL("../knip.jsonc", import.meta.url), "utf8"),
  );
  write(
    "package.json",
    JSON.stringify({ private: true, workspaces: ["server", "web"] }),
  );
  write(
    "server/package.json",
    JSON.stringify({
      name: "fixture-server",
      dependencies: { "unused-package": "1.0.0" },
      devDependencies: { "test-tool": "1.0.0", "unused-dev-tool": "1.0.0" },
    }),
  );
  write("web/package.json", JSON.stringify({ name: "fixture-web" }));
  write("scripts/tool.ts", 'console.log("tool");');
  write("tools/task.mjs", 'console.log("task");');
  write(
    "server/src/index.ts",
    'import { dispatch } from "./rpc/world"; import { used } from "./live"; import * as index from "./features/index.gen"; console.log(dispatch("world.appearance.patch"), used(), Object.values(index)); import("./lazy").then(m => m.lazy());',
  );
  write(
    "server/src/rpc/world.ts",
    'import { handleAppearanceRpc } from "./appearance"; export const dispatch = (method: string) => method === "world.appearance.patch" ? handleAppearanceRpc() : null;',
  );
  write(
    "server/src/rpc/appearance.ts",
    'export const handleAppearanceRpc = () => "appearance";',
  );
  write(
    "server/src/features/index.gen.ts",
    'export * as discovered from "./example/register";',
  );
  write(
    "server/src/features/example/register.ts",
    'export const feature = { id: "example" };',
  );
  write(
    "server/src/live.ts",
    "export const used = () => 1; export const dead = () => 2; export const testOnly = () => 3; export type DeadType = string;\n/** @internal */\nexport const intentionalTestSeam = () => 4;",
  );
  write(
    "server/src/live.test.ts",
    'import { testOnly, intentionalTestSeam } from "./live"; console.log(testOnly(), intentionalTestSeam());',
  );
  // These are development entries, not production findings or baseline additions.
  // Exercise each workspace, including broad production script/CLI/worker globs.
  const support = [
    "scripts/probe/testing/helper.ts",
    "tools/probe.fixture.mjs",
    "shared/testing/helper.ts",
    "server/src/probe/testing/fixture.ts",
    "server/src/probe.fixture.ts",
    "server/src/probe.cases.ts",
    "server/src/probe.browserMock.ts",
    "server/src/cli/testing/helper.ts",
    "server/src/probe/testing/support-worker.ts",
    "web/src/probe/testing/helper.tsx",
    "web/src/probe.fixture.tsx",
    "web/src/probe.cases.ts",
    "web/src/probe.browserMock.ts",
  ];
  for (const path of support) {
    write(path, "export const fixture = () => 1;");
    write(
      path.replace(/\.(ts|tsx|mjs)$/, ".test.$1"),
      `import { fixture } from "./${path.split("/").at(-1)}"; console.log(fixture());`,
    );
  }
  // Test-support imports must still keep development dependencies alive.
  write(
    "server/src/probe/testing/fixture.ts",
    'import "test-tool"; export const fixture = () => 1;',
  );
  write("server/src/lazy.ts", 'export const lazy = () => "lazy";');
  write("server/src/orphan.ts", 'console.log("orphan");');
  write(
    "server/src/cli/command.ts",
    'console.log("cli"); export const unusedCliExport = 1;',
  );
  write(
    "server/src/cli/command.test.ts",
    'import { unusedCliExport } from "./command"; console.log(unusedCliExport);',
  );
  write("server/src/storage/world-worker.ts", 'console.log("worker");');
  write(
    "web/index.html",
    '<script type="module" src="/src/main.tsx"></script>',
  );
  write("web/src/main.tsx", 'console.log("web");');
  const result = Bun.spawnSync(
    [
      process.execPath,
      resolve("node_modules/knip/bin/knip.js"),
      "--directory",
      root,
      "--config",
      "knip.jsonc",
      "--production",
      "--include",
      "files,exports,types,dependencies",
      "--reporter",
      "json",
      "--no-exit-code",
      "--no-config-hints",
    ],
    { cwd: root },
  );
  expect(result.exitCode).toBe(0);
  const current = findings(JSON.parse(result.stdout.toString()));
  expect(current.files).toEqual(["server/src/orphan.ts"]);
  expect(current.exports).toEqual([
    "server/src/cli/command.ts#unusedCliExport",
    "server/src/live.ts#dead",
    "server/src/live.ts#testOnly",
  ]);
  expect(current.types).toEqual(["server/src/live.ts#DeadType"]);
  expect(current.dependencies).toEqual(["server/package.json#unused-package"]);
  const development = Bun.spawnSync(
    [
      process.execPath,
      resolve("node_modules/knip/bin/knip.js"),
      "--directory",
      root,
      "--config",
      "knip.jsonc",
      "--include",
      "dependencies,devDependencies",
      "--reporter",
      "json",
      "--no-exit-code",
      "--no-config-hints",
    ],
    { cwd: root },
  );
  expect(development.exitCode).toBe(0);
  expect(
    findings(JSON.parse(development.stdout.toString())).devDependencies,
  ).toEqual(["server/package.json#unused-dev-tool"]);
}, 30_000);
