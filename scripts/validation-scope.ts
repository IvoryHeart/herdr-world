import { affected, buildGraph, gitChanges, TEST, type Graph } from "./affected";
import { readCoverageScope } from "./coverage-scope";
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
    path.startsWith("scripts/agent/") ||
    [
      "docs/agent-development.md",
      "docs/crew-runbook.md",
      "docs/dispatch-runbook.md",
    ].includes(path) ||
    /^changes\/[a-z0-9][a-z0-9-]*\.md$/.test(path)
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
  /^(?:server\/|shared\/|scripts\/(?:install|installer|package|release|prepare-release|build-version|publish|world-plugin|plugin|homebrew|verify-release|check-(?:binary|homebrew))|herdr-plugin\.toml$)/;
const WORLD_RUNTIME =
  /^(?:web\/src\/world\/|server\/src\/(?:world|connections|bridge)\/|server\/src\/index\.ts$|web\/src\/(?:store(?:\/|\.ts$)|api\.ts$|worldSnapshotDecode\.ts$)|shared\/world)/;

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
  if (
    !full &&
    paths.some((path) => path === "verification/coverage.json" || owns(path))
  )
    chosen.push("scripts/verification-coverage.test.ts");
  const browserPlanPaths = [
    "scripts/world-browser-suites.ts",
    "scripts/world-browser-timings.json",
    "scripts/world-browser-suites.test.ts",
  ];
  const shardTable =
    paths.includes("scripts/world-browser-suites.ts") ||
    paths.includes("scripts/world-browser-timings.json") ||
    paths.includes("scripts/balance-shards.ts");
  const browserPlanOnly =
    shardTable &&
    paths.every(
      (path) =>
        browserPlanPaths.includes(path) ||
        (isDocumentationPath(path) && !owns(path)),
    );
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
    web: shardTable ? webBrowserSuites : chosen.filter((path) => web.has(path)),
    world: chosenWorld,
    worldShards: worldBrowserShards.flatMap((shard, index) =>
      chosenWorld.some((path) => shard.includes(path)) ? [index + 1] : [],
    ),
    verification:
      !tooling && (full || (!complete.full && complete.verification)),
    packaging:
      !tooling &&
      (full ||
        paths.some((path) => NATIVE.test(path) && !TEST.test(path)) ||
        (!browserPlanOnly &&
          chosen.some((path) =>
            /^scripts\/(?:install|plugin|package|homebrew)/.test(path),
          ))),
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
