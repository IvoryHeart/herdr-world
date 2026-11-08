import type { WorldUsageSnapshot } from "../../../../shared/usage";
import { townScaleSceneRequested } from "./townScaleScene";
import {
  townScaleDeskTokens,
  TOWN_SCALE_NO_USAGE_HOST,
} from "./townScaleValues";

type UsageClient = {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
};

/** Replace the entire economy source when topology is the synthetic scene. */
export function townScaleUsageClient(
  client: UsageClient,
  search: string,
  clock: () => number = Date.now,
): UsageClient {
  if (!townScaleSceneRequested(search)) return client;
  return {
    call: (method, params) =>
      method === "world.usage.get"
        ? townScaleUsage(clock())
        : client.call(method, params),
  };
}
async function townScaleUsage(observedAt: number): Promise<WorldUsageSnapshot> {
  const { usageFixture } = await import("../testing/usageFixture");
  const { townScaleConnections } = await import("./townScaleScene");
  const hosts = townScaleConnections();
  const rows = hosts.flatMap((host) =>
    host.connectionId === `scene-${TOWN_SCALE_NO_USAGE_HOST}`
      ? []
      : host.snapshot!.tabs.flatMap((tab) => {
          const tokens = townScaleDeskTokens(tab.tab_id);
          if (!tokens) return [];
          const pane =
            host.snapshot!.panes.find(
              (p) => p.tab_id === tab.tab_id && p.agent,
            ) ?? host.snapshot!.panes.find((p) => p.tab_id === tab.tab_id)!;
          return [
            {
              connection: host.connectionId,
              generation: host.generation!,
              workspace: tab.workspace_id,
              tab: tab.tab_id,
              pane: pane.pane_id,
              harness: pane.agent || "claude",
              model: "synthetic-model",
              input: tokens,
              cacheRead: 0,
              cacheWrite: 0,
              output: 0,
            },
          ];
        }),
  );
  const options = {
    observedAt,
    sources: hosts.flatMap((host) =>
      ["claude", "codex", "pi"].map((harness) => ({
        connection: host.connectionId,
        generation: host.generation!,
        harness,
        state:
          host.connectionId === `scene-${TOWN_SCALE_NO_USAGE_HOST}`
            ? ("missing" as const)
            : ("available" as const),
      })),
    ),
    prices: {
      version: "town-scale-synthetic",
      models: {
        "synthetic-model": {
          input: 6,
          cache_read: 6,
          cache_write: 6,
          output: 6,
        },
      },
    },
  };
  const today = usageFixture({ ...options, rows });
  const yesterday = new Date(observedAt - 86_400_000)
    .toISOString()
    .slice(0, 10);
  const week = usageFixture({
    ...options,
    window: "7d",
    rows: [...rows, ...rows.map((row) => ({ ...row, day: yesterday }))],
  });
  return {
    ...week,
    incarnation: "town-scale",
    today: {
      total: today.total,
      unattributed: today.unattributed,
      rollups: today.rollups,
    },
  };
}
