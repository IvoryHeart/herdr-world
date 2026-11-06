import { describe, expect, test } from "bun:test";
import { WorldObservation, parseObservationBase } from "./observation-v1";
import type { WorldConnectionSnapshot, WorldSnapshotResult } from "./snapshot";

function host(generation = 1, label = "room"): WorldConnectionSnapshot {
  return {
    connection_id: "alpha",
    label: "Alpha",
    source: "saved-profile",
    is_default: false,
    state: "ready",
    generation,
    snapshot_generation: generation,
    stale: false,
    actionable: true,
    snapshot: {
      workspaces: [{ workspace_id: "room", label }],
      tabs: [],
      panes: [],
      agents: [],
      coverage: {
        workspaces: 1,
        tabs: 0,
        panes: 0,
        agent_panes: 0,
        status: { working: 0, idle: 0, blocked: 0, done: 0, unknown: 0 },
        by_workspace: [],
      },
      watch_admission: {
        revision: 0,
        registered: 0,
        missing: 0,
        unresolved: 0,
        matched: 0,
        admitted: 0,
        admission_failed: 0,
      },
    },
  };
}
const result = (
  ...connections: WorldConnectionSnapshot[]
): WorldSnapshotResult => ({ revision: 1, observed_at: 1000, connections });

describe("observation v1 service reply", () => {
  test("no base keeps complete topology; matched base confirms without topology", () => {
    const observation = new WorldObservation("service-a");
    const snapshot = result(host());
    const first = observation.reply(snapshot);
    expect(first.service_incarnation).toBe("service-a");
    expect(first.connections[0]!.snapshot).toBe(
      snapshot.connections[0]!.snapshot,
    );
    const base = {
      service_incarnation: "service-a",
      hosts: [
        {
          connection_id: "alpha",
          generation: 1,
          token: first.connections[0]!.token!,
        },
      ],
    };
    const next = observation.reply(snapshot, base);
    expect(next.connections[0]!.unchanged).toBe(true);
    expect(next.connections[0]).not.toHaveProperty("snapshot");
    expect(next.connections[0]!.token).toBe(first.connections[0]!.token);
    expect(JSON.stringify(snapshot)).not.toContain("unchanged");
  });

  test("exhaustive incarnation, generation and token admission matrix", () => {
    const observation = new WorldObservation("service-a");
    for (const generation of [1, 2]) {
      const snapshot = result(host(generation));
      const token = observation.reply(snapshot).connections[0]!.token!;
      for (const incarnation of ["service-a", "service-b"])
        for (const baseGeneration of [1, 2])
          for (const baseToken of [token, "unknown"])
            for (const connectionId of ["alpha", "unknown"]) {
              const reply = observation.reply(snapshot, {
                service_incarnation: incarnation,
                hosts: [
                  {
                    connection_id: connectionId,
                    generation: baseGeneration,
                    token: baseToken,
                  },
                ],
              });
              const confirmed =
                incarnation === "service-a" &&
                generation === baseGeneration &&
                token === baseToken &&
                connectionId === "alpha";
              expect(reply.connections[0]!.unchanged === true).toBe(confirmed);
              expect(Object.hasOwn(reply.connections[0]!, "snapshot")).toBe(
                !confirmed,
              );
            }
    }
  });

  test("tokens cover projected content, generation, coverage and watch admission", () => {
    const observation = new WorldObservation("service-a");
    const token = (connection: WorldConnectionSnapshot) =>
      observation.reply(result(connection)).connections[0]!.token;
    expect(token(host())).toBe(token(host()));
    expect(token(host(2))).not.toBe(token(host()));
    expect(token(host(1, "renamed"))).not.toBe(token(host()));
    const coverage = host();
    coverage.snapshot!.coverage.tabs = 2;
    expect(token(coverage)).not.toBe(token(host()));
    const watch = host();
    watch.snapshot!.watch_admission.revision = 2;
    expect(token(watch)).not.toBe(token(host()));
  });

  test("one changed host replaces whole; metadata changes accompany confirmations", () => {
    const observation = new WorldObservation("service-a");
    const alpha = host();
    const beta = { ...host(), connection_id: "beta" };
    const first = observation.reply(result(alpha, beta));
    const base = {
      service_incarnation: "service-a",
      hosts: first.connections.map((c) => ({
        connection_id: c.connection_id,
        generation: c.generation,
        token: c.token!,
      })),
    };
    const next = observation.reply(
      result(
        {
          ...alpha,
          stale: true,
          actionable: false,
          state: "error",
          snapshot_error: "synthetic outage",
        },
        { ...host(1, "changed"), connection_id: "beta" },
      ),
      base,
    );
    expect(next.connections[0]).toMatchObject({
      unchanged: true,
      stale: true,
      actionable: false,
      state: "error",
      snapshot_error: "synthetic outage",
    });
    expect(next.connections[1]!.snapshot!.workspaces[0]!.label).toBe("changed");
    const retired = observation.reply(
      result({ ...alpha, generation: 2 }),
      base,
    );
    expect(retired.connections[0]).toHaveProperty("snapshot");
    const empty = observation.reply(
      result({ ...alpha, snapshot: null, snapshot_generation: null }),
    );
    expect(empty.connections[0]!.token).toBeNull();
  });
});

test("base is bounded and malformed entries are refused before acquisition", () => {
  const valid = {
    service_incarnation: "service-a",
    hosts: [{ connection_id: "alpha", generation: 1, token: "opaque" }],
  };
  expect(parseObservationBase({ base: valid })).toEqual(valid);
  expect(parseObservationBase({})).toBeUndefined();
  for (const base of [
    null,
    [],
    {},
    { ...valid, service_incarnation: "" },
    { ...valid, hosts: Array(65).fill(valid.hosts[0]) },
    { ...valid, hosts: [valid.hosts[0], valid.hosts[0]] },
    ...[
      null,
      {},
      { ...valid.hosts[0], token: "x".repeat(65) },
      { ...valid.hosts[0], token: "" },
      { ...valid.hosts[0], token: null },
      { ...valid.hosts[0], generation: -1 },
      { ...valid.hosts[0], generation: 1.5 },
      { ...valid.hosts[0], connection_id: "bad/id" },
    ].map((entry) => ({ ...valid, hosts: [entry] })),
  ])
    expect(() => parseObservationBase({ base })).toThrow(
      "invalid World observation base",
    );
});
