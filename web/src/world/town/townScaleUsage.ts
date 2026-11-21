import type { UsageLimit, WorldUsageSnapshot } from "../../../../shared/usage";
// Keep the small economy fixture in the existing usage chunk rather than
// adding a separate asset for these testing-only reads.
import { usageFixture } from "../testing/usageFixture";
import {
  townScaleConnections,
  townScaleSceneRequested,
} from "./townScaleScene";
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
    limits: townScaleLimits(hosts, observedAt),
    today: {
      total: today.total,
      unattributed: today.unattributed,
      rollups: today.rollups,
    },
  };
}

const MINUTE = 60_000;

/**
 * The scene's subscription limits, one per FUEL state (#1087): a fresh Claude
 * reading with both windows (atlas), one 40 minutes old that dims and reads
 * "as of …" (nova), and a fresh one with only the week window, whose 5 h row
 * reads "not reported" (zephyr). Codex, whose agents work on every host, has
 * no reading anywhere and reads "no reading yet".
 */
export function townScaleLimits(
  hosts: readonly { connectionId: string; generation?: number }[],
  now: number,
): UsageLimit[] {
  const claude: Record<string, Pick<UsageLimit, "observed_at" | "windows">> = {
    "scene-atlas": {
      observed_at: now - 2 * MINUTE,
      windows: [
        {
          window_minutes: 300,
          used_percent: 38,
          resets_at: now + 140 * MINUTE,
        },
        {
          window_minutes: 10080,
          used_percent: 52,
          resets_at: now + 3 * 1440 * MINUTE,
        },
      ],
    },
    "scene-nova": {
      observed_at: now - 40 * MINUTE,
      windows: [
        {
          window_minutes: 300,
          used_percent: 20,
          resets_at: now + 200 * MINUTE,
        },
        {
          window_minutes: 10080,
          used_percent: 18,
          resets_at: now + 3 * 1440 * MINUTE,
        },
      ],
    },
    [`scene-${TOWN_SCALE_NO_USAGE_HOST}`]: {
      observed_at: now - 4 * MINUTE,
      windows: [
        {
          window_minutes: 10080,
          used_percent: 61,
          resets_at: now + 3 * 1440 * MINUTE,
        },
      ],
    },
  };
  return hosts.flatMap((host) => {
    const base = {
      connection_id: host.connectionId,
      connection_generation: host.generation ?? 1,
      reason: null,
      reached: null,
    };
    const reading = claude[host.connectionId];
    return [
      reading
        ? {
            ...base,
            harness: "claude" as const,
            state: "available" as const,
            source: "claude-status-line" as const,
            ...reading,
          }
        : {
            ...base,
            harness: "claude" as const,
            state: "missing" as const,
            source: null,
            observed_at: null,
            windows: [],
          },
      {
        ...base,
        harness: "codex" as const,
        state: "missing" as const,
        source: null,
        observed_at: null,
        windows: [],
      },
    ];
  });
}
