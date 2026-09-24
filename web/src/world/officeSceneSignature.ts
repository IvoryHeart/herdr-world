import type { HerdrOfficeProjection } from "./herdrOfficeProjection";
import type { OfficeLayout } from "./officeGeometry";
import type { OfficeObservability } from "./officeObservability";

export function officeSceneSignature({
  layout,
  projection,
  selectedKey,
  completionSeenKeys = new Set<string>(),
  observability,
  visibleRoomIndices,
}: {
  layout: OfficeLayout;
  projection: HerdrOfficeProjection;
  selectedKey: string | null;
  completionSeenKeys?: ReadonlySet<string>;
  observability?: OfficeObservability;
  visibleRoomIndices: readonly number[];
}) {
  return JSON.stringify({
    selectedKey,
    completionSeenKeys: [...completionSeenKeys].sort(),
    layout: {
      officeWidth: layout.officeWidth,
      totalHeight: layout.totalHeight,
      layoutRevision: layout.layoutRevision,
      inputDigest: layout.inputDigest ?? null,
      rooms: visibleRoomIndices.map(
        (index) =>
          layout.rooms.find(({ index: roomIndex }) => roomIndex === index) ??
          null,
      ),
    },
    hosts: projection.hosts,
    rooms: visibleRoomIndices.map((index) => projection.rooms[index] ?? null),
    receptions: projection.receptions,
    barAgents: projection.barAgents,
    coverage: projection.coverage,
    observability: observability
      ? {
          health: observability.health,
          observedAt: observability.observedAt,
          windowSeconds: observability.windowSeconds,
          models: observability.models,
          totalCostUsd: observability.totalCostUsd,
          totalUsage: observability.totalUsage,
        }
      : null,
  });
}
