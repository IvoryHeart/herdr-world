import type { WorldUsageSnapshot } from "../../../../shared/usage";
import type { UsageFixtureRow } from "../testing/usageFixture";
import { townScaleUsageClient } from "./townScaleUsage";

/** Explicit, one-load testing switch. Normal reads and settings are untouched. */
export function townEconomyPreviewClient<
  T extends {
    call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  },
>(client: T): Pick<T, "call"> {
  if (typeof window === "undefined") return client;
  const url = new URL(window.location.href);
  const sceneClient = townScaleUsageClient(client, url.search);
  if (sceneClient !== client) return sceneClient;
  const mode = url.searchParams.get("town-economy-preview");
  if (!mode) return client;
  url.searchParams.delete("town-economy-preview");
  window.history.replaceState(window.history.state, "", url);
  return {
    call: async (method, params) => {
      const snapshot = (await client.call(
        method,
        params,
      )) as WorldUsageSnapshot;
      return townEconomyPreview(snapshot, mode);
    },
  };
}

/** Synthetic amounts on the connected buildings; no transcript or setting writes. */
export async function townEconomyPreview(
  snapshot: WorldUsageSnapshot,
  mode: string,
) {
  const { usageFixture, USAGE_FIXTURE_PRICES } = await import(
    "../testing/usageFixture"
  );
  const owners = [
    ...new Map(snapshot.sources.map((s) => [s.connection_id, s])).values(),
  ];
  const first = owners[0];
  if (!first) return snapshot;
  const second = owners[1] ?? first;
  const observedAt =
    mode === "midnight"
      ? Math.floor(snapshot.observed_at / 86_400_000) * 86_400_000 - 1
      : snapshot.observed_at;
  const day = new Date(observedAt).toISOString().slice(0, 10);
  const yesterday = new Date(Date.parse(day) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  const target = (owner: typeof first, place: string) => ({
    connection: owner.connection_id,
    generation: owner.connection_generation,
    workspace: `example-${place}`,
    tab: `example-${place}`,
    pane: `example-${place}`,
  });
  const rows: UsageFixtureRow[] = [
    {
      ...target(first, "studio"),
      input: 120_000,
      cacheRead: 540_000,
      cacheWrite: 40_000,
      output: 20_000,
    },
    {
      connection: first.connection_id,
      generation: first.connection_generation,
      input: 30_000,
      cacheRead: 135_000,
      cacheWrite: 10_000,
      output: 5_000,
    },
    {
      ...target(second, "lab"),
      harness: "codex",
      model: mode === "unpriced" ? "example-unlisted" : "example-small",
      input: 50_000,
      cacheRead: 225_000,
      cacheWrite: 15_000,
      output: 10_000,
    },
    {
      ...target(first, "stale"),
      state: "stale",
      input: 10_000_000,
      cacheRead: 0,
      cacheWrite: 0,
      output: 0,
    },
  ];
  const options = {
    sources: owners.map((owner) => ({
      connection: owner.connection_id,
      generation: owner.connection_generation,
      state: "partial" as const,
    })),
    prices: mode === "no-table" ? null : USAGE_FIXTURE_PRICES,
    observedAt,
  };
  const today = usageFixture({ ...options, rows });
  const week = usageFixture({
    ...options,
    window: "7d",
    rows: [
      ...rows,
      ...rows
        .filter((r) => r.state !== "stale")
        .map((r) => ({
          ...r,
          day: yesterday,
          input: r.input / 2,
          cacheRead: r.cacheRead! / 2,
          cacheWrite: r.cacheWrite! / 2,
          output: r.output! / 2,
        })),
    ],
  });
  return {
    ...week,
    incarnation: "town-economy-preview",
    today: {
      total: today.total,
      unattributed: today.unattributed,
      rollups: today.rollups,
    },
  };
}
