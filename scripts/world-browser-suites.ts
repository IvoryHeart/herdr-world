import { join } from "node:path";

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

// The other suites spread across eight machines, one case at a time,
// balanced by CI timings (seconds, 2026-10-20). Per-file timings in CI
// artifacts guide later rebalancing.
export const worldBrowserShards = [
  ["SharedViewCreation", "WorldViewErrorBoundary"], // 60
  ["HostsFilter.timeouts", "windows/WindowFrame"], // 57
  ["HostsFilter.inspector-timeout", "BoardView"], // 58
  ["HostsFilter.resources", "DeskView.browser"], // 57
  [
    "HostsFilter",
    "HostsFilter.pending",
    "useSpacesTabWindowArrangement.browser",
  ], // 53
  ["HostsFilter.cold", "HostsFilter.arrangement"], // 58
  ["HostsFilter.actions", "HostsFilter.navigation"], // 55
  ["HostsFilter.creation", "town/TownCanvas"], // 43
].map((shard) => shard.map((name) => `web/src/world/${name}.test.ts`));

export const worldBrowserSuites = [
  ...worldBrowserShards.flat(),
  ...worldTimedSuites,
];
export const worldBrowserIgnorePattern = `{${worldBrowserSuites
  .map((path) => `**/${path.slice("web/src/".length)}`)
  .join(",")}}`;

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
