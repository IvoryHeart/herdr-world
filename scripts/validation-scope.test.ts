import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  isToolingOnlyChange,
  isToolingPath,
  repositorySelection,
  selectValidation,
} from "./validation-scope";
import { buildGraph, gitChanges, type Graph } from "./affected";
import { readCoverageScope } from "./coverage-scope";
import {
  worldBrowserSuites,
  worldBrowserShards,
  worldRuntimeSuites,
  webBrowserSuites,
} from "./world-browser-suites";
import { ciTestBatches, selectedCITests } from "./ci-tests";

test("only the explicit agent tooling paths qualify", () => {
  const allowed = [
    "scripts/agent/worktree.mjs",
    "scripts/agent/worktree.test.ts",
    "scripts/agent/example/rules.test.ts",
    "docs/agent-development.md",
  ];
  expect(isToolingOnlyChange(allowed)).toBe(true);
  for (const path of [
    "server/src/index.ts",
    "web/src/world/TownView.tsx",
    "shared/pullRequest.ts",
    "scripts/check-delivery.ts",
    "scripts/agent.ts",
    "docs/retired-runbook.md",
    "scripts/validation-scope.ts",
    "scripts/ci-workflow.test.ts",
    ".github/workflows/ci.yml",
    ".githooks/pre-push",
    "package.json",
    "bun.lock",
    "verification/coverage/Q01.json",
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

const openspecChecks = [
  "scripts/openspec-feature-map.test.ts",
  "scripts/check-knowledge-map.test.ts",
  "scripts/check-knowledge-map-links.test.ts",
  "scripts/pages-features.test.ts",
];
const catalogCheck = "server/src/storage/catalog.test.ts";

test.each([
  "openspec/changes/example/specs/world-surfaces/town/spec.md",
  "openspec/specs/world-surfaces/town/notes.md",
  "openspec/changes/archive/example/tasks.md",
  "openspec/config.yaml",
])(
  "OpenSpec-only diff %s selects structure checks in CI and pre-push",
  (path) => {
    const known = {
      ...graph,
      files: new Set([...graph.files, path, ...openspecChecks]),
    };
    // Local pushes may narrow units to changes since the preceding push.
    for (const testPaths of [[path], []]) {
      const selection = selectValidation(known, [path], () => false, testPaths);
      expect(selection).toMatchObject({ full: false, documentation: false });
      expect(selection.unit).toEqual([...openspecChecks].sort());
      expect(selectedCITests(selection, "unit")).toEqual(selection.unit);
    }
  },
);

test.each([
  "web/src/example.ts",
  "server/src/world/example.ts",
  "server/src/features/example.ts",
  "server/src/shipyard/example.ts",
  "openspec/specs/world-storage/notes.md",
])("catalog scan input %s selects its guard beyond imports", (path) => {
  const known = {
    ...graph,
    files: new Set([...graph.files, path, catalogCheck]),
    deps: new Map([...graph.deps, [unit, new Set([path])]]),
  };
  for (const testPaths of [[path], []]) {
    const selection = selectValidation(known, [path], () => false, testPaths);
    expect(selection.full).toBe(false);
    expect(selection.unit).toContain(catalogCheck);
  }
});

test("installation inputs require the native job containing systemd acceptance", () => {
  for (const path of [
    "scripts/install-herdr-world.sh",
    "scripts/herdr-core-install.sh",
    "scripts/herdr-core-install.ps1",
    "scripts/herdr-bootstrap.ts",
    "scripts/homebrew-herdr-bootstrap.sh",
    "scripts/homebrew-launcher.sh",
    "scripts/generate-homebrew-formula.ts",
    "scripts/package-release.sh",
    "scripts/install-linux/scenarios.py",
    "server/src/herdr-core/install.ts",
    "server/src/cli/update-finish.ts",
    "server/src/cli/update.ts",
    "server/src/cli/service-context.ts",
    "server/src/connections/profile-service.ts",
    "server/src/cli/connections.ts",
  ]) {
    const known = { ...graph, files: new Set([...graph.files, path]) };
    expect(selectValidation(known, [path]).packaging).toBe(
      !path.includes("connections"),
    );
    expect(selectValidation(known, [path], () => false, [chat]).packaging).toBe(
      !path.includes("connections"),
    );
  }
  expect(selectValidation(graph, ["README.md"]).packaging).toBe(false);
  expect(selectValidation(graph, []).packaging).toBe(false);
});

test("browser Chat selects nearby consumers without verification, runtime suites or platforms", () => {
  const selection = selectValidation(graph, [chat]);
  expect(selection).toMatchObject({
    full: false,
    tooling: false,
    verification: false,
    packaging: false,
    unit: [unit],
    world: [worldBrowserSuites[0]],
    web: [webBrowserSuites[0]],
    worldShards: worldBrowserShards.flatMap((files, index) =>
      files.includes(worldBrowserSuites[0]!) ? [index + 1] : [],
    ),
  });
});

test("shared browser-only inputs do not schedule native platforms; compiled imports still do", () => {
  const ui = "shared/browserColors.ts";
  const binary = "shared/runtimeProtocol.ts";
  const entry = "server/src/index.ts";
  const known: Graph = {
    ...graph,
    files: new Set([...graph.files, ui, binary, entry]),
    deps: new Map([
      ...graph.deps,
      [unit, new Set([ui, binary])],
      [entry, new Set([binary])],
    ]),
  };
  expect(selectValidation(known, [ui]).packaging).toBe(false);
  expect(selectValidation(known, [binary]).packaging).toBe(false);
  expect(selectValidation(known, []).packaging).toBe(false);
});

test("a production web edit always reaches the built-entry boot journey across the Vite boundary", () => {
  const source = "web/src/startupPreference.ts";
  const boot = "web/src/productionBoot.browser.test.ts";
  const known: Graph = {
    ...graph,
    files: new Set([...graph.files, source, boot]),
    deps: new Map([...graph.deps, [unit, new Set([source])]]),
  };
  const selection = selectValidation(known, [source]);
  expect(selection.full).toBe(false);
  expect(selection.web).toContain(boot);
  expect(selection.packaging).toBe(false);
});

test("owners and World runtime paths independently require their maintained suites", () => {
  expect(
    selectValidation(graph, [scene], (path) => path === scene),
  ).toMatchObject({
    verification: true,
    packaging: false,
    world: worldBrowserSuites.filter(
      (path) =>
        path === worldBrowserSuites[0] || worldRuntimeSuites.includes(path),
    ),
  });
  expect(selectValidation(graph, [native])).toMatchObject({
    verification: false,
    packaging: false,
    world: [],
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
      packaging: false,
      world: worldBrowserSuites,
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
  });
  expect(
    selectValidation(graph, ["scripts/agent/new.ts"], () => true),
  ).toMatchObject({
    tooling: true,
    verification: false,
    packaging: false,
    unit: [
      "scripts/agent/example.test.ts",
      "scripts/verification-coverage.test.ts",
    ],
    world: [],
  });
});

test("rename deletions retain World and native obligations", () => {
  const gone = ["server/src/old.ts", "web/src/world/old.ts"];
  const renamed: Graph = {
    ...graph,
    gone: new Set(gone),
    files: new Set([...graph.files, ...gone]),
  };
  const selection = selectValidation(renamed, [...gone, chat]);
  expect(selection.packaging).toBe(false);
  expect(selection.world).toEqual(expect.arrayContaining(worldRuntimeSuites));
});

test("the CI runner executes only its selected lane and rejects invalid selectors", () => {
  const selection = selectValidation(graph, [chat]);
  expect(selectedCITests(selection, "unit")).toEqual([unit]);
  for (const [index, files] of worldBrowserShards.entries())
    expect(selectedCITests(selection, "world", String(index + 1))).toEqual(
      files.includes(worldBrowserSuites[0]!) ? [worldBrowserSuites[0]!] : [],
    );
  for (const lane of ["invalid", "full", "latency", "__proto__"])
    expect(() => selectedCITests(selection, lane)).toThrow();
  expect(() => selectedCITests(selection, "world", "0")).toThrow();
  expect(() =>
    selectedCITests({ ...selection, unit: ["../secret.test.ts"] }, "unit"),
  ).toThrow();
});

test("CI unit and web partitions are disjoint and exhaustive", () => {
  const selection = selectValidation(graph, ["package.json"]);
  for (const lane of ["unit", "web"] as const) {
    const first = selectedCITests(selection, lane, "1/2");
    const second = selectedCITests(selection, lane, "2/2");
    expect([...first, ...second].sort()).toEqual([...selection[lane]].sort());
    expect(first.some((path) => second.includes(path))).toBe(false);
    expect(() => selectedCITests(selection, lane, "3/2")).toThrow();
  }
});

test("an incremental full-gate path escalates every suite even when absent from the final PR diff", () => {
  for (const paths of [[chat], ["README.md"], ["scripts/agent/new.ts"]]) {
    const selection = selectValidation(graph, paths, () => false, [
      "package.json",
    ]);
    expect(selection.full).toBe(true);
    expect(selection.tooling).toBe(false);
    expect(selection.documentation).toBe(false);
    expect(selection.world).toEqual(worldBrowserSuites);
    expect(selection.verification).toBe(true);
    expect(selection.packaging).toBe(false);
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
  expect(selection.unit).toEqual([
    versionTest,
    "scripts/verification-coverage.test.ts",
  ]);
  expect(selection.packaging).toBe(true);
});

const nativeJobTests = [["installer-upgrade.yml", ["upgrade"]]] as const;
const namedNativeTests = new Set<string>();
for (const [file, jobs] of nativeJobTests) {
  const workflow = Bun.YAML.parse(
    readFileSync(
      new URL(`../.github/workflows/${file}`, import.meta.url),
      "utf8",
    ),
  ) as { jobs: Record<string, { steps: { run?: string }[] }> };
  for (const job of jobs) {
    const paths = workflow.jobs[job]!.steps.flatMap((step) =>
      (step.run?.match(/[\w./-]+\.test\.[cm]?[jt]sx?/g) ?? []).map((path) =>
        path.replace(/^\.\//, ""),
      ),
    );
    test(`${file} ${job} names its native test consumers`, () => {
      expect(paths.length).toBeGreaterThan(0);
    });
    for (const path of paths) namedNativeTests.add(path);
  }
}
const unlistedNativeTests = [
  "server/src/storage/unlisted.test.ts",
  "scripts/build-version.test.ts",
];
const nativeTestGraph: Graph = {
  ...graph,
  files: new Set([...graph.files, ...namedNativeTests, ...unlistedNativeTests]),
};
test.each([...namedNativeTests])(
  "native job consumer %s selects native packaging",
  (path) => {
    const selection = selectValidation(nativeTestGraph, [path]);
    expect(selection.full).toBe(false);
    expect(selection.packaging).toBe(true);
    expect(selection.unit).toContain(path);
    // Applicability uses the complete PR even when incremental unit scope narrows.
    expect(
      selectValidation(nativeTestGraph, [path], () => false, [unit]).packaging,
    ).toBe(true);
  },
);
test.each(unlistedNativeTests)(
  "unlisted native test %s keeps its scoped selection",
  (path) => {
    expect(selectValidation(nativeTestGraph, [path])).toMatchObject({
      full: false,
      packaging: false,
      unit: [path],
    });
  },
);

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
    write("verification/coverage/_meta.json", '{"schemaVersion": 1}\n');
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

test("contributor docs and skill Markdown avoid full validation but retain named readers", () => {
  const docs = [
    "AGENTS.md",
    "CONTRIBUTING.md",
    ".agents/skills/example/SKILL.md",
  ];
  const reader = "scripts/policy.test.ts";
  const policyGraph: Graph = {
    ...graph,
    files: new Set([...graph.files, ...docs, reader]),
    deps: new Map([...graph.deps, [reader, new Set([docs[0]!])]]),
  };
  for (const path of docs) {
    const selection = selectValidation(policyGraph, [path]);
    expect(selection.full).toBe(false);
    expect(selection.verification).toBe(false);
    expect(selection.packaging).toBe(false);
    if (path === docs[0]) expect(selection.unit).toContain(reader);
  }
});

test("shard-table edits keep browser and inventory evidence without models or packaging", () => {
  const table = "scripts/world-browser-suites.ts";
  const check = "scripts/world-browser-suites.test.ts";
  const shardGraph: Graph = {
    ...graph,
    files: new Set([...graph.files, table, check]),
    deps: new Map([...graph.deps, [check, new Set([table])]]),
  };
  const selection = selectValidation(
    shardGraph,
    [table],
    () => true,
    [table],
    () => false,
  );
  expect(selection.full).toBe(false);
  expect(selection.unit).toContain(check);
  expect(selection.unit).toContain("scripts/verification-coverage.test.ts");
  expect(selection.world).toEqual(worldBrowserSuites);
  expect(selection.web).toEqual(webBrowserSuites);
  expect(selection.verification).toBe(false);
  expect(selection.packaging).toBe(false);
});

test("model-free owners keep their consumer tests and cheap coverage while modeled owners run models", () => {
  const path = "scripts/example.ts";
  const check = "scripts/example.test.ts";
  const ownerGraph: Graph = {
    ...graph,
    files: new Set([...graph.files, path, check]),
    deps: new Map([...graph.deps, [check, new Set([path])]]),
  };
  const selection = selectValidation(
    ownerGraph,
    [path],
    () => true,
    [path],
    () => false,
  );
  expect(selection.full).toBe(false);
  expect(selection.verification).toBe(false);
  expect(selection.unit).toEqual([
    check,
    "scripts/verification-coverage.test.ts",
  ]);
  expect(selectValidation(ownerGraph, [path], () => true).verification).toBe(
    true,
  );
});

test("the real shard-table graph does not mistake installer test imports for native distribution changes", () => {
  const files = gitChanges(process.cwd(), "HEAD");
  const realGraph = buildGraph(process.cwd(), files.tracked, files.deleted);
  const coverage = readCoverageScope(process.cwd());
  const paths = [
    "scripts/world-browser-suites.ts",
    "scripts/world-browser-suites.test.ts",
    "CONTRIBUTING.md",
  ];
  const selection = selectValidation(
    realGraph,
    paths,
    coverage.owns,
    paths,
    coverage.models,
  );
  expect(selection.full).toBe(false);
  expect(selection.world).toEqual(worldBrowserSuites);
  expect(selection.web).toEqual(webBrowserSuites);
  expect(selection.packaging).toBe(false);
  expect(selection.verification).toBe(false);
  const fixture = "web/src/world/town/TownCanvas.browser.tsx";
  const town = selectValidation(
    realGraph,
    [fixture],
    coverage.owns,
    [fixture],
    coverage.models,
  );
  for (const path of worldBrowserSuites.filter((path) =>
    path.includes("/town/TownCanvas"),
  ))
    expect(town.world).toContain(path);
  const mixed = [...paths, "scripts/release-plan.ts"];
  expect(
    selectValidation(realGraph, mixed, coverage.owns, mixed, coverage.models)
      .packaging,
  ).toBe(true);
});

test("World CI isolates full scenes while keeping lightweight files parallel, with every selected suite once", () => {
  const selection = selectValidation(graph, ["package.json"]);
  const all = { ...selection, world: worldBrowserSuites };
  const batches = ciTestBatches(all, "world");
  expect(batches.map((batch) => batch.parallel)).toEqual([1, 2]);
  expect(batches.flatMap((batch) => batch.files).sort()).toEqual(
    [...worldBrowserSuites].sort(),
  );
  const isolated = batches[0]!.files;
  for (const file of [
    "ConcurrentContexts",
    "ProductionContexts.town",
    "ProductionContexts.animated",
    "town/TownCanvas",
    "BoardView",
    "SharedViewCreation",
    "WorldTerminalHandoff",
  ])
    expect(isolated).toContain(`web/src/world/${file}.test.ts`);
  for (let shard = 1; shard <= 6; shard++) {
    const actual = ciTestBatches(all, "world", String(shard));
    expect(actual.flatMap((batch) => batch.files).sort()).toEqual(
      selectedCITests(all, "world", String(shard)).sort(),
    );
    expect(actual.every((batch) => batch.files.length > 0)).toBe(true);
  }
  expect(ciTestBatches({ ...selection, world: [] }, "world")).toEqual([]);
  expect(
    ciTestBatches(
      { ...selection, world: ["web/src/world/NewScene.test.ts"] },
      "world",
    ),
  ).toEqual([{ files: ["web/src/world/NewScene.test.ts"], parallel: 1 }]);
});

test.each([
  { runs: 1, failingPass: 0, failingBatch: "" },
  ...[1, 3].flatMap((runs) =>
    Array.from({ length: runs }, (_, index) => index + 1).flatMap(
      (failingPass) =>
        ["isolated", "parallel"].map((failingBatch) => ({
          runs,
          failingPass,
          failingBatch,
        })),
    ),
  ),
  { runs: 3, failingPass: 0, failingBatch: "" },
])(
  "CI executes isolated and parallel batches with distinct artifacts and stops on failure (%j)",
  ({ runs, failingPass, failingBatch }) => {
    const root = mkdtempSync(join(tmpdir(), "ci-browser-batches-"));
    try {
      mkdirSync(join(root, "scripts"));
      writeFileSync(
        join(root, "scripts/run-world-tests.ts"),
        `
import {appendFileSync} from "node:fs";
appendFileSync("executions.jsonl", JSON.stringify({args:process.argv.slice(2),label:process.env.HERDR_WORLD_TEST_LABEL})+"\\n");
if (process.argv.includes("--parallel=${failingBatch === "isolated" ? 1 : 2}") && ${failingPass > 0} && (${runs} === 1 || process.env.HERDR_WORLD_TEST_LABEL?.includes("-pass-${failingPass}-"))) process.exit(7);
`,
      );
      const selection = {
        ...selectValidation(graph, ["package.json"]),
        world: [
          "web/src/world/WorldTerminalHandoff.test.ts",
          "web/src/world/windows/WindowFrame.test.ts",
        ],
      };
      const child = Bun.spawnSync(
        [process.execPath, join(import.meta.dir, "ci-tests.ts"), "world"],
        {
          cwd: root,
          env: {
            ...process.env,
            HERDR_CI_SELECTION: JSON.stringify(selection),
            HERDR_WORLD_TEST_LABEL: "shard-5-of-6",
            HERDR_CI_WORLD_RUNS: String(runs),
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      expect(child.stderr.toString()).toBe("");
      expect(child.exitCode).toBe(failingPass ? 7 : 0);
      const executions = readFileSync(join(root, "executions.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const expected = [];
      for (let pass = 1; pass <= runs; pass++) {
        const prefix = `shard-5-of-6${runs > 1 ? `-pass-${pass}` : ""}`;
        expected.push({
          args: [
            selection.world[0],
            "--parallel=1",
            "--max-concurrency=1",
            "--retry-flaky=browser",
            `--flake-report=.agents/delivery/flakes-world-all-${pass}-1-${process.env.GITHUB_RUN_ATTEMPT || "local"}.json`,
          ],
          label: `${prefix}-isolated`,
        });
        if (pass === failingPass && failingBatch === "isolated") break;
        expected.push({
          args: [
            selection.world[1],
            "--parallel=2",
            "--max-concurrency=1",
            "--retry-flaky=browser",
            `--flake-report=.agents/delivery/flakes-world-all-${pass}-2-${process.env.GITHUB_RUN_ATTEMPT || "local"}.json`,
          ],
          label: `${prefix}-parallel`,
        });
        if (pass === failingPass) break;
      }
      expect(executions).toEqual(expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
test("area files and shared metadata select the inventory check and preserve model policy", () => {
  for (const path of [
    "verification/coverage/Q01.json",
    "verification/coverage/new-area.json",
    "verification/coverage/_meta.json",
  ]) {
    const inventoryGraph: Graph = {
      ...graph,
      files: new Set([...graph.files, path]),
    };
    for (const models of [false, true]) {
      const selection = selectValidation(
        inventoryGraph,
        [path],
        () => false,
        [path],
        () => models,
      );
      expect(selection.full).toBe(false);
      expect(selection.unit).toContain("scripts/verification-coverage.test.ts");
      expect(selection.verification).toBe(models);
    }
  }
});

test.each(["unit", "world", "web"])(
  "an empty %s CI shard retains empty evidence and starts no test process",
  (lane) => {
    const root = mkdtempSync(join(tmpdir(), "ci-empty-shard-"));
    try {
      const child = Bun.spawnSync(
        [
          process.execPath,
          join(import.meta.dir, "ci-tests.ts"),
          lane,
          lane === "world" ? "1" : "1/2",
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            HERDR_CI_SELECTION: JSON.stringify({
              unit: [],
              world: [],
              web: [],
            }),
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      expect(child.exitCode).toBe(0);
      expect(child.stderr.toString()).toBe("");
      expect(child.stdout.toString()).toContain("no affected suites");
      const file = lane === "world" ? "1" : "1-of-2";
      const report = join(
        root,
        `.agents/delivery/flakes-${lane}-${file}-empty-${process.env.GITHUB_RUN_ATTEMPT || "local"}.json`,
      );
      expect(JSON.parse(readFileSync(report, "utf8"))).toEqual({
        files: [],
        flaky: [],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test.each(["unit", "web"])(
  "%s CI reports preserve the workflow upload path and opt into scoped retry",
  (lane) => {
    const root = mkdtempSync(join(tmpdir(), "ci-report-path-"));
    try {
      mkdirSync(join(root, "scripts"));
      writeFileSync(
        join(root, "scripts/run-tests.ts"),
        'await Bun.write("args.json", JSON.stringify(process.argv.slice(2)));',
      );
      const selection = {
        unit: ["scripts/example.test.ts"],
        web: ["web/src/Example.browser.test.ts"],
        world: [],
      };
      const child = Bun.spawnSync(
        [process.execPath, join(import.meta.dir, "ci-tests.ts"), lane, "1/2"],
        {
          cwd: root,
          env: {
            ...process.env,
            HERDR_CI_SELECTION: JSON.stringify(selection),
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      expect(child.exitCode).toBe(0);
      expect(child.stderr.toString()).toBe("");
      const args = JSON.parse(readFileSync(join(root, "args.json"), "utf8"));
      expect(args).toContain(
        `--reporter-outfile=.agents/delivery/${lane === "web" ? "web-browser" : "unit"}-1-of-2.xml`,
      );
      expect(args).toContain(
        `--retry-flaky=${lane === "unit" ? "unit" : "browser"}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
