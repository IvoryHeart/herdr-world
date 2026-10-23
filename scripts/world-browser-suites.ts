import { existsSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/**
 * Suites that assert wall-clock budgets (input latency, frame counts). They
 * fail when other work competes for the CPU, so they run on their own: on CI
 * in the dedicated, quiet "latency" job, one at a time, and locally in the
 * gate's quiet lane.
 */
export const worldTimedSuites = [
  "ProductionContexts",
  "ProductionContexts.board",
  "ProductionContexts.town",
  "ProductionContexts.animated",
  "ConcurrentContexts",
  "WorldTerminalHandoff",
].map((name) => `web/src/world/${name}.test.ts`);

// The other suites spread across six machines, one case at a time, balanced
// by mean CI file timings (seconds, four runs to 2026-10-21). The slowest file
// bounds the slowest shard, so more machines would not finish sooner. Per-file
// timings in CI artifacts guide later rebalancing.
export const worldBrowserShards = [
  ["SharedViewCreation", "WorldViewErrorBoundary"], // 72
  ["HostsFilter.resources", "HostsFilter.inspector-timeout"], // 60
  ["HostsFilter", "HostsFilter.cold", "HostsFilter.timeouts"], // 60
  [
    "HostsFilter.actions",
    "DeskView.browser",
    "BoardView",
    "useSpacesTabWindowArrangement.browser",
  ], // 60
  ["HostsFilter.creation", "HostsFilter.arrangement", "windows/WindowFrame"], // 58
  ["HostsFilter.navigation", "town/TownCanvas", "HostsFilter.pending"], // 59
].map((shard) => shard.map((name) => `web/src/world/${name}.test.ts`));

export const worldBrowserSuites = [
  ...worldBrowserShards.flat(),
  ...worldTimedSuites,
];
export const worldBrowserIgnorePattern = ignorePattern(worldBrowserSuites);

/**
 * Chrome-driven suites outside World. CI runs them in their own job of the
 * browser workflow rather than one file at a time inside repository
 * validation, where they took about half of the unit-test time.
 */
export const webBrowserSuites = [
  "web/src/uiScale.test.ts",
  "web/src/filePreviewNavigation.test.ts",
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
  if (shard === "latency") return [...worldTimedSuites];
  const match = /^(\d+)\/(\d+)$/.exec(shard);
  const index = Number(match?.[1]);
  const total = Number(match?.[2]);
  if (total !== worldBrowserShards.length || index < 1 || index > total) {
    throw new Error(
      `World shard must be 1/${worldBrowserShards.length} through ${worldBrowserShards.length}/${worldBrowserShards.length}, or latency`,
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
  return selectsSuites(
    args,
    [...webBrowserSuites, ...worldBrowserSuites],
    root,
  );
}

/**
 * Whether the selection includes a timed (latency) suite, which needs the
 * whole machine rather than the browser slot alone. Same conservative rules.
 */
export function includesTimedSuites(
  args: readonly string[],
  root = process.cwd(),
): boolean {
  return selectsSuites(args, worldTimedSuites, root);
}

function selectsSuites(
  args: readonly string[],
  suites: readonly string[],
  root: string,
): boolean {
  if (args.length === 0) return true;
  return args.some((arg) => {
    if (arg.startsWith("-")) return true;
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
