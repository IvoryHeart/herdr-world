import { WorldSnapshotService } from "../../server/src/world/snapshot";
import { buildShape, type Shape } from "./fixture";
import { snapshotCounts } from "./service";

export async function observationCase(shape: Shape) {
  const hosts = buildShape(shape);
  let calls = 0;
  let retired = false;
  const generation = 7;
  const ids = hosts.map((_, i) => `source-${i}`);
  const service = new WorldSnapshotService({
    list: () =>
      ids.map((id, i) => ({
        id,
        label: id,
        source: "synthetic Herdr",
        is_default: i === 0,
        state: retired && i === 0 ? ("error" as const) : ("ready" as const),
        generation: retired && i === 0 ? generation + 1 : generation,
      })),
    readyRuntimeLease: (id) => {
      const i = ids.indexOf(id),
        host = hosts[i]!;
      if (retired && i === 0) return null;
      return {
        connectionId: id,
        generation,
        runtime: {
          herdr: {
            async call(method: string) {
              calls++;
              const key = `${method.split(".")[0]}s` as keyof typeof host;
              // Clone approximates a decoded isolated response. No real native IPC here.
              return { [key]: structuredClone(host[key]) };
            },
          },
        },
        isCurrent: () => !(retired && i === 0),
      };
    },
  });
  const phases = [];
  for (const name of ["initial", "cache", "refresh", "retired-generation"]) {
    if (name === "refresh") for (const id of ids) service.invalidate(id);
    if (name === "retired-generation") {
      retired = true;
      service.invalidate(ids[0]);
    }
    const before = calls,
      began = performance.now(),
      snapshot = await service.snapshot(),
      generationMs = performance.now() - began;
    const serializedAt = performance.now(),
      json = JSON.stringify(snapshot),
      serializationMs = performance.now() - serializedAt;
    if (name === "retired-generation") {
      const first = snapshot.connections[0]!;
      if (
        first.actionable ||
        !first.stale ||
        first.snapshot_generation === first.generation
      )
        throw new Error("Retired synthetic observation regained authority");
    }
    phases.push({
      name,
      generationMs,
      serializationMs,
      jsonBytes: Buffer.byteLength(json),
      nativeListCalls: calls - before,
      counts: snapshotCounts(snapshot),
    });
  }
  return {
    boundary:
      "source-executed WorldSnapshotService; no composition/persistence/native IPC",
    phases,
  };
}
