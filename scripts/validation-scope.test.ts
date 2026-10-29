import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  isToolingOnlyChange,
  isToolingPath,
  repositorySelection,
  selectValidation,
} from "./validation-scope";
import type { Graph } from "./affected";
import {
  worldBrowserSuites,
  worldTimedSuites,
  webBrowserSuites,
} from "./world-browser-suites";
import { selectedCITests } from "./ci-tests";

test("only the explicit agent tooling paths qualify", () => {
  const allowed = [
    "scripts/agent/crew.ts",
    "scripts/agent/crew.test.ts",
    "scripts/agent/gate/rules.test.ts",
    "docs/agent-development.md",
    "docs/crew-runbook.md",
    "docs/dispatch-runbook.md",
    "changes/482.md",
  ];
  expect(isToolingOnlyChange(allowed)).toBe(true);
  for (const path of [
    "server/src/index.ts",
    "web/src/world/TownView.tsx",
    "shared/pullRequest.ts",
    "scripts/check-delivery.ts",
    "scripts/agent.ts",
    "scripts/validation-scope.ts",
    "scripts/ci-workflow.test.ts",
    ".github/workflows/ci.yml",
    ".githooks/pre-push",
    "package.json",
    "bun.lock",
    "verification/coverage.json",
    "quint/runtime.qnt",
    "tools/quint/execution.json",
    "AGENTS.md",
    "CONTRIBUTING.md",
    ".agents/dispatch/config.json",
    ".agents/skills/candidate-delivery/SKILL.md",
    "docs/other.md",
    "changes/README.md",
    "changes/nested/x.md",
    "scripts/agent/../../server/index.ts",
  ]) {
    expect(isToolingPath(path)).toBe(false);
    expect(isToolingOnlyChange([...allowed, path])).toBe(false);
  }
  expect(isToolingOnlyChange([])).toBe(false);
});

const chat = "web/src/components/chat/Example.tsx";
const scene = "web/src/world/example.ts";
const native = "server/src/example.ts";
const unit = "web/src/example.test.ts";
const graph: Graph = {
  files: new Set([
    chat,
    scene,
    native,
    unit,
    webBrowserSuites[0]!,
    worldBrowserSuites[0]!,
    "scripts/agent/example.test.ts",
    "scripts/agent/new.ts",
    "README.md",
    "package.json",
    "unknown.bin",
  ]),
  gone: new Set(),
  deps: new Map([
    [unit, new Set([chat, scene, native])],
    [worldBrowserSuites[0]!, new Set([chat, scene])],
    [webBrowserSuites[0]!, new Set([chat])],
  ]),
};

test("browser Chat selects nearby consumers without verification, latency or platforms", () => {
  const selection = selectValidation(graph, [chat]);
  expect(selection).toMatchObject({
    full: false,
    tooling: false,
    verification: false,
    packaging: false,
    latency: [],
    unit: [unit],
    world: [worldBrowserSuites[0]],
    web: [webBrowserSuites[0]],
    worldShards: [1],
  });
});

test("owners and World runtime paths independently require their maintained suites", () => {
  expect(
    selectValidation(graph, [scene], (path) => path === scene),
  ).toMatchObject({
    verification: true,
    latency: worldTimedSuites,
    packaging: false,
  });
  expect(selectValidation(graph, [native])).toMatchObject({
    verification: false,
    packaging: true,
    latency: [],
  });
  expect(selectValidation(graph, [native], () => true).verification).toBe(true);
});

test("unknown paths, configuration and empty main selections run the full matrix", () => {
  for (const paths of [
    ["unknown.bin"],
    ["package.json"],
    ["AGENTS.md"],
    ["CONTRIBUTING.md"],
    [".agents/skills/example/SKILL.md"],
    ["absent.ts"],
    [],
  ]) {
    expect(selectValidation(graph, paths)).toMatchObject({
      full: true,
      verification: true,
      packaging: true,
      latency: worldTimedSuites,
    });
  }
  expect(
    selectValidation(graph, ["package.json", chat], () => false, [chat]).full,
  ).toBe(true);
});

test("ordinary docs skip suites and the tooling exception still runs its fallback inventory", () => {
  expect(selectValidation(graph, ["README.md"])).toMatchObject({
    full: false,
    verification: false,
    packaging: false,
    unit: [],
    world: [],
    web: [],
    latency: [],
  });
  expect(
    selectValidation(graph, ["scripts/agent/new.ts"], () => true),
  ).toMatchObject({
    tooling: true,
    verification: false,
    packaging: false,
    unit: ["scripts/agent/example.test.ts"],
    world: [],
    latency: [],
  });
});

test("rename deletions retain World and native obligations", () => {
  const gone = ["server/src/old.ts", "web/src/world/old.ts"];
  const renamed: Graph = {
    ...graph,
    gone: new Set(gone),
    files: new Set([...graph.files, ...gone]),
  };
  expect(selectValidation(renamed, [...gone, chat])).toMatchObject({
    packaging: true,
    latency: worldTimedSuites,
  });
});

test("the CI runner executes only its selected lane and rejects invalid selectors", () => {
  const selection = selectValidation(graph, [chat]);
  expect(selectedCITests(selection, "unit")).toEqual([unit]);
  expect(selectedCITests(selection, "world", "1")).toEqual([
    worldBrowserSuites[0]!,
  ]);
  expect(selectedCITests(selection, "world", "2")).toEqual([]);
  expect(selectedCITests(selection, "latency")).toEqual([]);
  for (const lane of ["invalid", "full", "__proto__"])
    expect(() => selectedCITests(selection, lane)).toThrow();
  expect(() => selectedCITests(selection, "world", "0")).toThrow();
  expect(() =>
    selectedCITests({ ...selection, unit: ["../secret.test.ts"] }, "unit"),
  ).toThrow();
});

test("CI unit and web partitions are disjoint, exhaustive and keep each latency suite alone", () => {
  const selection = selectValidation(graph, ["package.json"]);
  for (const lane of ["unit", "web"] as const) {
    const first = selectedCITests(selection, lane, "1/2");
    const second = selectedCITests(selection, lane, "2/2");
    expect([...first, ...second].sort()).toEqual([...selection[lane]].sort());
    expect(first.some((path) => second.includes(path))).toBe(false);
    expect(() => selectedCITests(selection, lane, "3/2")).toThrow();
  }
  expect(
    [1, 2, 3, 4, 5, 6].flatMap((index) =>
      selectedCITests(selection, "latency", String(index)),
    ),
  ).toEqual(worldTimedSuites);
});

test("an incremental full-gate path escalates every suite even when absent from the final PR diff", () => {
  const timed = new Set(worldTimedSuites);
  for (const paths of [[chat], ["README.md"], ["scripts/agent/new.ts"]]) {
    const selection = selectValidation(graph, paths, () => false, [
      "package.json",
    ]);
    expect(selection.full).toBe(true);
    expect(selection.tooling).toBe(false);
    expect(selection.documentation).toBe(false);
    expect(selection.world).toEqual(
      worldBrowserSuites.filter((path) => !timed.has(path)),
    );
    expect(selection.latency).toEqual(worldTimedSuites);
    expect(selection.verification).toBe(true);
    expect(selection.packaging).toBe(true);
  }
});

test("build-version changes select native jobs because the module is compiled into the service", () => {
  const version = "scripts/build-version.ts";
  const versionTest = "scripts/build-version.test.ts";
  const versionGraph: Graph = {
    ...graph,
    files: new Set([...graph.files, version, versionTest]),
    deps: new Map([...graph.deps, [versionTest, new Set([version])]]),
  };
  const selection = selectValidation(versionGraph, [version], () => true);
  expect(selection.full).toBe(false);
  expect(selection.unit).toEqual([versionTest]);
  expect(selection.packaging).toBe(true);
});

test("an incremental-only deletion keeps the repository's affected unit scope", () => {
  const root = mkdtempSync(join(tmpdir(), "validation-scope-"));
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: root });
    expect(result.exitCode).toBe(0);
    return result.stdout.toString().trim();
  };
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const commit = (message: string) => {
    git("add", ".");
    git("commit", "-qm", message);
    return git("rev-parse", "HEAD");
  };
  try {
    git("init", "-q");
    git("config", "user.name", "Scope Test");
    git("config", "user.email", "scope@example.invalid");
    write("verification/coverage.json", '{"areas": []}\n');
    write(chat, "export const value = 1;\n");
    write(unit, 'import "./components/chat/Example";\n');
    write("web/src/unrelated.test.ts", "export {};\n");
    write(worldBrowserSuites[0]!, "export {};\n");
    const base = commit("base");
    const transient = "web/src/transient.ts";
    write(transient, "export const temporary = 1;\n");
    write(chat, "export const value = 2;\n");
    const priorPush = commit("introduce temporary source");
    rmSync(join(root, transient));
    write(chat, "export const value = 3;\n");
    commit("remove temporary source and update view");

    const expected = {
      full: false,
      tooling: false,
      unit: [unit],
      world: [],
      worldShards: [],
      web: [],
      latency: [],
      verification: false,
      packaging: false,
    };
    expect(repositorySelection(root, base)).toMatchObject(expected);
    expect(repositorySelection(root, base, "HEAD", priorPush)).toMatchObject(
      expected,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
