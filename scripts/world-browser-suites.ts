import { join } from "node:path";

// Spread the large scenario matrices and existing integration suites across
// eight machines. Each machine runs one case at a time, including latency
// workloads. Per-file timings in CI artifacts guide subsequent rebalancing.
export const worldBrowserShards = [
  [
    "HostsFilter",
    "ProductionContexts",
    "windows/WindowFrame",
    "HostsFilter.cold",
  ],
  ["HostsFilter.actions", "ProductionContexts.board", "BoardView"],
  ["HostsFilter.navigation", "ProductionContexts.town"],
  ["HostsFilter.creation", "HostsFilter.inspector-timeout"],
  ["HostsFilter.resources", "ProductionContexts.animated", "town/TownCanvas"],
  ["HostsFilter.pending", "SharedViewCreation"],
  ["HostsFilter.arrangement", "WorldTerminalHandoff", "DeskView.browser"],
  [
    "HostsFilter.timeouts",
    "ConcurrentContexts",
    "WorldViewErrorBoundary",
    "useSpacesTabWindowArrangement.browser",
  ],
].map((shard) => shard.map((name) => `web/src/world/${name}.test.ts`));

export const worldBrowserSuites = worldBrowserShards.flat();

/**
 * Suites that assert wall-clock budgets (input latency, frame counts). They
 * fail when other work competes for the CPU, so the local gate runs them on
 * their own after everything else.
 */
export const worldTimedSuites = [
  "ProductionContexts",
  "ProductionContexts.board",
  "ProductionContexts.town",
  "ProductionContexts.animated",
  "ConcurrentContexts",
  "WorldTerminalHandoff",
].map((name) => `web/src/world/${name}.test.ts`);
export const worldBrowserIgnorePattern = `{${worldBrowserSuites
  .map((path) => `**/${path.slice("web/src/".length)}`)
  .join(",")}}`;

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
    if (
      /^\/\/ @world-browser-suite\b/m.test(source) ||
      /CHROME_BIN|--headless/.test(source)
    ) {
      actual.push(`web/src/world/${path}`);
    }
  }
  const expected = new Set(worldBrowserSuites);
  const missing = actual.filter((path) => !expected.has(path));
  const nonexistent = worldBrowserSuites.filter(
    (path) => !actual.includes(path),
  );
  const untracked = worldTimedSuites.filter((path) => !expected.has(path));
  if (
    expected.size !== worldBrowserSuites.length ||
    missing.length ||
    nonexistent.length ||
    untracked.length
  ) {
    throw new Error(
      `World browser inventory mismatch: unassigned=${missing.join(",")}; missing=${nonexistent.join(",")}; duplicate=${expected.size !== worldBrowserSuites.length}; timed-unknown=${untracked.join(",")}`,
    );
  }
}
