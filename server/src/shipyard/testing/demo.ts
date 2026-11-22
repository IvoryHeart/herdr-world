import {
  SHIPYARD_LIMITS as L,
  type ShipyardInstance,
  type ShipyardWindow,
} from "../../../../shared/shipyard";
import { ShipyardService } from "../service";
import {
  githubFixture,
  MAIN_SHA,
  SHIPYARD_SCENARIOS,
  type ShipyardScenario,
} from "./fixture";

export const SHIPYARD_DEMOS = [...SHIPYARD_SCENARIOS, "stale"] as const;
export function demoInstances(now: number): ShipyardWindow<ShipyardInstance> {
  const common = {
    generation: "11111111-1111-4111-8111-111111111111",
    repo: "example-org/widgets",
    branch: "preview/widgets",
    sha: MAIN_SHA,
    kind: "source" as const,
    startedAt: now - 100_000,
    releaseId: null,
  };
  return {
    complete: true,
    detail: null,
    items: [
      {
        ...common,
        id: "1".repeat(24),
        version: "1.0.0",
        port: 19091,
        reportedAt: now,
        expiresAt: now + L.instanceLeaseMs,
        state: "fresh",
        openUrl: "http://127.0.0.1:19091/",
      },
      {
        ...common,
        id: "2".repeat(24),
        version: "dev",
        port: 19092,
        reportedAt: now - 90_000,
        expiresAt: now - 45_000,
        state: "stale",
        openUrl: null,
      },
    ],
  };
}
export async function demoShipyard(scenario: (typeof SHIPYARD_DEMOS)[number]) {
  let now = Date.parse("2026-01-04T00:00:00Z");
  let failing = false;
  const fixture = githubFixture(
    scenario === "stale" ? "populated" : (scenario as ShipyardScenario),
  );
  const service = new ShipyardService({
    run: (argv, timeout) =>
      failing
        ? Promise.resolve({ code: 1, stdout: "", stderr: "synthetic offline" })
        : fixture.run(argv, timeout),
    source: () => ({ enabled: true, generation: 0 }),
    projects: async () => ({
      projects: [{ repo: "example-org/widgets", name: "widgets", rooms: 1 }],
      pending: 0,
      omitted: 0,
    }),
    instances: () => demoInstances(now),
    now: () => now,
  });
  let result = await service.snapshot("example-org/widgets");
  if (scenario === "stale") {
    now += L.forcedRefreshMs + 1;
    failing = true;
    result = await service.snapshot("example-org/widgets", true);
  }
  service.close();
  return result;
}
