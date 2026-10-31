import { existsSync, realpathSync } from "node:fs";
import { balanceShards } from "./balance-shards";
import timings from "./world-browser-timings.json";
import { join, relative, resolve, sep } from "node:path";

/**
 * Suites whose input delays the non-blocking World latency trend reports.
 * They assert only what does not depend on the runner's speed, so CI runs
 * them in the ordinary shards below; the trend job runs them again, one at a
 * time on quiet runners, to record timing (scripts/latency-trend.ts).
 */
export const worldLatencyTrendSuites = [
  "ProductionContexts.board",
  "ProductionContexts.town",
  "ProductionContexts.animated",
  "ConcurrentContexts",
].map((name) => `web/src/world/${name}.test.ts`);

// Opt-in report suites share the browser queue but never join protected shards.
export const reportBrowserSuites = [
  "scripts/town-golden.browser.test.ts",
  "scripts/town-golden-negative.browser.test.ts",
];

/**
 * End-to-end consumers of the World runtime: a change to the runtime itself
 * (WORLD_RUNTIME in validation-scope.ts) runs them even when the import graph
 * does not reach them.
 */
export const worldRuntimeSuites = [
  ...worldLatencyTrendSuites,
  "web/src/world/ProductionContexts.test.ts",
  "web/src/world/WorldTerminalHandoff.test.ts",
];

// Six runners, longest-first by measured CI seconds (source recorded in JSON).
// TownCanvas's original 22 cases now span five files; the inventory assertion
// still rejects missing or duplicated suites. These weights are estimates of
// future work, not test deadlines or runner-speed assertions.
export const worldBrowserShards = balanceShards(
  Object.keys(timings.seconds) as Array<keyof typeof timings.seconds>,
  timings.seconds,
  6,
).map((shard) => shard.map((name) => `web/src/world/${name}.test.ts`));

export const worldBrowserSuites = worldBrowserShards.flat();
export const worldBrowserIgnorePattern = ignorePattern(worldBrowserSuites);

/**
 * Chrome-driven suites outside World. CI runs them in their own job of the
 * browser workflow rather than one file at a time inside repository
 * validation, where they took about half of the unit-test time.
 */
export const webBrowserSuites = [
  "web/src/appStartup.browser.test.ts",
  "server/src/world/appearance.browser.test.ts",
  "web/src/uiScale.test.ts",
  "web/src/filePreviewNavigation.test.ts",
  "web/src/sourceFileInspector.test.ts",
  "web/src/promptAnswers.test.ts",
  "web/src/mobileTerminal.test.ts",
  "web/src/layerStack.browser.test.ts",
  "web/src/components/VisualPreview.test.ts",
  "web/src/components/TerminalThemeDialog.test.ts",
  "web/src/components/HerdrSetupCard.test.ts",
  "web/src/components/ThemedSelect.browser.test.ts",
  "web/src/components/WindowArrangementMenu.test.ts",
  "web/src/components/MobileTabSheet.test.ts",
  "web/src/components/WorkspaceInspectorPortal.test.ts",
  "server/src/workspace/html-preview.browser.test.ts",
];
/** Everything the browser workflow runs, for repository validation to skip. */
export const browserWorkflowIgnorePattern = ignorePattern([
  ...worldBrowserSuites,
  ...webBrowserSuites,
]);

// Repository-relative paths: a `**/` prefix would also skip an ordinary test
// that shares a registered suite's name in another directory.
function ignorePattern(paths: string[]) {
  return `{${paths.join(",")}}`;
}

const browserSource = (source: string) =>
  /^\/\/ @world-browser-suite\b/m.test(source) ||
  /CHROME_BIN|--headless/.test(source);

export function selectWorldBrowserShard(shard?: string): string[] {
  if (!shard) return [...worldBrowserSuites];
  const match = /^(\d+)\/(\d+)$/.exec(shard);
  const index = Number(match?.[1]);
  const total = Number(match?.[2]);
  if (total !== worldBrowserShards.length || index < 1 || index > total) {
    throw new Error(
      `World shard must be 1/${worldBrowserShards.length} through ${worldBrowserShards.length}/${worldBrowserShards.length}`,
    );
  }
  return [...worldBrowserShards[index - 1]!];
}

export async function assertWorldBrowserInventory(root = process.cwd()) {
  const actual: string[] = [];
  for await (const path of new Bun.Glob("**/*.test.{ts,tsx}").scan({
    cwd: join(root, "web/src/world"),
  })) {
    const source = await Bun.file(join(root, "web/src/world", path)).text();
    if (browserSource(source)) actual.push(`web/src/world/${path}`);
  }
  const expected = new Set(worldBrowserSuites);
  const missing = actual.filter((path) => !expected.has(path));
  const nonexistent = worldBrowserSuites.filter(
    (path) => !actual.includes(path),
  );
  if (
    expected.size !== worldBrowserSuites.length ||
    missing.length ||
    nonexistent.length
  ) {
    throw new Error(
      `World browser inventory mismatch: unassigned=${missing.join(",")}; missing=${nonexistent.join(",")}; duplicate=${expected.size !== worldBrowserSuites.length}`,
    );
  }
}

export async function assertWebBrowserInventory(root = process.cwd()) {
  const actual: string[] = [];
  for (const directory of ["web/src", "server/src"]) {
    for await (const path of new Bun.Glob("**/*.test.{ts,tsx}").scan({
      cwd: join(root, directory),
    })) {
      const file = `${directory}/${path}`;
      if (file.startsWith("web/src/world/")) continue;
      if (browserSource(await Bun.file(join(root, file)).text()))
        actual.push(file);
    }
  }
  const missing = actual.filter((path) => !webBrowserSuites.includes(path));
  const nonexistent = webBrowserSuites.filter((path) => !actual.includes(path));
  if (missing.length || nonexistent.length) {
    throw new Error(
      `Web browser inventory mismatch: unassigned=${missing.join(",")}; missing=${nonexistent.join(",")}`,
    );
  }
}

/**
 * Whether Bun selectors can include Chrome. Unknown filters and options are
 * conservatively queued: option values are not necessarily test paths.
 */
export function includesBrowserSuites(
  args: readonly string[],
  root = process.cwd(),
): boolean {
  return includesSuites(
    args,
    [...webBrowserSuites, ...worldBrowserSuites, ...reportBrowserSuites],
    root,
  );
}

function includesSuites(
  args: readonly string[],
  suites: readonly string[],
  root: string,
): boolean {
  const valueFlags = new Set([
    "-t",
    "--test-name-pattern",
    "--timeout",
    "--max-concurrency",
    "--reporter",
    "--reporter-outfile",
    "--seed",
    "--rerun-each",
    "--retry",
  ]);
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("-")) {
      paths.push(arg);
      continue;
    }
    if (!valueFlags.has(arg.split("=", 1)[0]!)) return true;
    if (!arg.includes("=") && ++i >= args.length) return true;
  }
  // No path means Bun's default full run, even when only flags were supplied.
  if (paths.length === 0) return true;
  return paths.some((arg) => {
    const absolute = resolve(root, arg);
    if (!existsSync(absolute)) return true;
    try {
      const path = relative(realpathSync(root), realpathSync(absolute))
        .split(sep)
        .join("/");
      if (!path || path === ".." || path.startsWith("../")) return true;
      return suites.some(
        (suite) => suite === path || suite.startsWith(`${path}/`),
      );
    } catch {
      return true;
    }
  });
}
