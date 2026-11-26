import { affected, buildGraph, gitChanges, TEST, type Graph } from "./affected";
import { readFileSync } from "node:fs";
import { readCoverageScope } from "./coverage-scope";
import { isCoveragePath } from "./coverage";
import {
  worldBrowserSuites,
  worldBrowserShards,
  worldRuntimeSuites,
  webBrowserSuites,
} from "./world-browser-suites";

/** One conservative allowlist shared by CI and the local delivery gate. */
export function isToolingPath(path: string): boolean {
  // No normalization: git paths are canonical; ambiguous inputs fail closed.
  if (
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    path.includes("\\")
  )
    return false;
  return (
    path.startsWith("scripts/agent/") || path === "docs/agent-development.md"
  );
}

export function isToolingOnlyChange(paths: readonly string[]): boolean {
  return paths.length > 0 && paths.every(isToolingPath);
}

export function isDocumentationPath(path: string): boolean {
  return (
    path.endsWith(".md") &&
    (!path.startsWith(".agents/") || /^\.agents\/skills\/.+\.md$/.test(path)) &&
    !["verification/", "quint/", "tools/quint/", "openspec/", ".github/"].some(
      (prefix) => path.startsWith(prefix),
    ) &&
    ![
      // Copied into every release package by scripts/package-release.sh.
      "THIRD_PARTY_NOTICES.md",
      "DEPENDENCY_NOTICES.md",
      "DEPENDENCY_LICENSES.md",
      "UPSTREAM.md",
    ].includes(path)
  );
}

export type ValidationSelection = {
  full: boolean;
  tooling: boolean;
  documentation: boolean;
  reason: string;
  unit: string[];
  world: string[];
  worldShards: number[];
  web: string[];
  verification: boolean;
  packaging: boolean;
};

const NATIVE =
  /^(?:scripts\/(?:install|installer|package|release|build-version|publish|world-plugin|plugin|homebrew|verify-release|check-(?:binary|homebrew))|herdr-plugin\.toml$)/;
const WORLD_RUNTIME =
  /^(?:web\/src\/world\/|server\/src\/(?:world|connections|bridge)\/|server\/src\/index\.ts$|web\/src\/(?:store(?:\/|\.ts$)|api\.ts$|worldSnapshotDecode\.ts$)|shared\/world)/;

/** Runtime directory scans have no import edges from their guarded inputs. */
const STRUCTURE_CHECKS = [
  [
    /^openspec\//,
    [
      "scripts/openspec-feature-map.test.ts",
      "scripts/check-knowledge-map.test.ts",
      "scripts/check-knowledge-map-links.test.ts",
      "scripts/pages-features.test.ts",
    ],
  ],
  [
    /^(?:(?:web\/src\/|server\/src\/(?:world|features|shipyard)\/).*\.tsx?$|openspec\/specs\/world-storage\/notes\.md$)/,
    ["server/src/storage/catalog.test.ts"],
  ],
] as const;

// Native jobs are the authority for their explicitly named test consumers.
// Derive these paths so adding a native test cannot leave scoped PR CI skipping it.
const nativeTestConsumers = new Set<string>();
for (const [file, jobs] of [["installer-upgrade.yml", ["upgrade"]]] as const) {
  const workflow = Bun.YAML.parse(
    readFileSync(
      new URL(`../.github/workflows/${file}`, import.meta.url),
      "utf8",
    ),
  ) as { jobs: Record<string, { steps: { run?: string }[] }> };
  for (const job of jobs)
    for (const step of workflow.jobs[job]!.steps)
      for (const path of step.run?.match(/[\w./-]+\.test\.[cm]?[jt]sx?/g) ?? [])
        nativeTestConsumers.add(path.replace(/^\.\//, ""));
}

export function ordinaryDocumentation(
  paths: readonly string[],
  owns: (path: string) => boolean,
): boolean {
  return (
    paths.length > 0 &&
    paths.every(isDocumentationPath) &&
    !paths.some(isToolingPath) &&
    !paths.some(owns)
  );
}

/** Whole-PR policy; optional incremental paths narrow tests only. */
export function selectValidation(
  graph: Graph,
  paths: readonly string[],
  owns: (path: string) => boolean = () => false,
  testPaths = paths,
  models: (path: string) => boolean = owns,
): ValidationSelection {
  const completeTooling = isToolingOnlyChange(paths);
  // The accepted agent-tooling exception uses unit evidence, not Q41's broad
  // scripts owner. Uncovered agent modules therefore still need the fallback.
  const relevantOwner = completeTooling ? () => false : owns;
  const complete = affected(
    graph,
    paths,
    worldBrowserSuites,
    relevantOwner,
    completeTooling ? () => false : models,
  );
  const tests = affected(
    graph,
    testPaths,
    worldBrowserSuites,
    relevantOwner,
    completeTooling ? () => false : models,
  );
  // A reverted gate/configuration edit can exist only in the incremental diff.
  // Preserve the tooling exception only when that diff is also tooling-only.
  const tooling =
    completeTooling && !(tests.full && !isToolingOnlyChange(testPaths));
  if (
    ordinaryDocumentation(paths, owns) &&
    !tests.full &&
    !tests.unit.length &&
    !tests.browser.length
  )
    return {
      full: false,
      tooling: false,
      documentation: true,
      reason: "ordinary documentation",
      unit: [],
      world: [],
      worldShards: [],
      web: [],
      verification: false,
      packaging: false,
    };
  const allTests = [...graph.files]
    .filter((path) => TEST.test(path) && !graph.gone.has(path))
    .sort();
  const full = !tooling && (paths.length === 0 || complete.full || tests.full);
  const fallback = tooling && (complete.full || tests.full);
  const chosen = full
    ? allTests
    : fallback
      ? allTests.filter((path) => path.startsWith("scripts/agent/"))
      : tests.full
        ? allTests
        : tests.unit;
  if (!full && paths.some((path) => isCoveragePath(path) || owns(path)))
    chosen.push("scripts/verification-coverage.test.ts");
  // Use the complete PR even when a local push narrows affected units.
  for (const [inputs, checks] of STRUCTURE_CHECKS)
    if ([...paths, ...testPaths].some((path) => inputs.test(path)))
      chosen.push(
        ...checks.filter(
          (path) => graph.files.has(path) && !graph.gone.has(path),
        ),
      );
  const shardTable =
    paths.includes("scripts/world-browser-suites.ts") ||
    paths.includes("scripts/world-browser-timings.json") ||
    paths.includes("scripts/balance-shards.ts");
  const world = new Set(worldBrowserSuites);
  const web = new Set(webBrowserSuites);
  const runtime =
    !tooling && !full && paths.some((path) => WORLD_RUNTIME.test(path));
  const affectedWorld =
    full || shardTable
      ? worldBrowserSuites
      : tooling || tests.full
        ? []
        : tests.browser;
  const chosenWorld = worldBrowserSuites.filter(
    (path) =>
      affectedWorld.includes(path) ||
      (runtime && worldRuntimeSuites.includes(path)),
  );
  // Production build calls do not import main.tsx into the Bun test process.
  // Keep the real-entry journey selected even across that build-tool seam.
  const boot = "web/src/productionBoot.browser.test.ts";
  const bootChanged =
    paths.some((path) => path.startsWith("web/src/")) && graph.files.has(boot);
  return {
    full,
    tooling,
    documentation: false,
    reason: full
      ? tests.full
        ? tests.reason
        : complete.full
          ? complete.reason
          : "empty or unknown change"
      : tooling
        ? "agent tooling"
        : "affected contracts and consumers",
    unit: [
      ...new Set(chosen.filter((path) => !world.has(path) && !web.has(path))),
    ].sort(),
    web: shardTable
      ? webBrowserSuites
      : [
          ...new Set([
            ...chosen.filter((path) => web.has(path)),
            ...(bootChanged ? [boot] : []),
          ]),
        ],
    world: chosenWorld,
    worldShards: worldBrowserShards.flatMap((shard, index) =>
      chosenWorld.some((path) => shard.includes(path)) ? [index + 1] : [],
    ),
    verification:
      !tooling && (full || (!complete.full && complete.verification)),
    packaging:
      !tooling &&
      paths.some(
        (path) =>
          (NATIVE.test(path) && !TEST.test(path)) ||
          nativeTestConsumers.has(path) ||
          /^(?:\.github\/workflows\/(?:release[^/]*|installer-upgrade)\.yml$|scripts\/(?:herdr-core-install|herdr-bootstrap|generate-homebrew|check-homebrew|homebrew-|install-linux\/)|server\/src\/cli\/(?:service-context|update(?:-finish)?)\.ts$|server\/src\/config\/(?:service-|plugin-|launchd-)|server\/src\/herdr-core\/install\.)/.test(
            path,
          ),
      ),
  };
}

export function repositorySelection(
  root: string,
  base: string,
  head = "HEAD",
  testBase = base,
): ValidationSelection {
  const complete = gitChanges(root, base, head);
  const tests = testBase === base ? complete : gitChanges(root, testBase, head);
  const coverage = readCoverageScope(root, base);
  return selectValidation(
    buildGraph(root, complete.tracked, [...complete.deleted, ...tests.deleted]),
    complete.changed,
    coverage.owns,
    tests.changed,
    coverage.models,
  );
}

export function fullValidationSelection(root: string): ValidationSelection {
  const files = gitChanges(root, "HEAD");
  return selectValidation(buildGraph(root, files.tracked, files.deleted), []);
}

if (import.meta.main) {
  const base = process.argv[2]?.match(/^--docs-since=([0-9a-f]{40})$/)?.[1];
  if (!base) throw new Error("Use validation-scope.ts --docs-since=<commit>");
  const root = process.cwd();
  process.exitCode = ordinaryDocumentation(
    gitChanges(root, base).changed,
    readCoverageScope(root).owns,
  )
    ? 0
    : 1;
}
