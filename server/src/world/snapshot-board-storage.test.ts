import { afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDenseSnapshotFixture } from "../../../web/src/world/browserAcceptanceFixture";
import { resolveDataPaths } from "../config/data-paths";
import { openStorage, type WorldStorage } from "../service/storage";
import { systemClock, systemScheduler } from "../service/ports";
import { STORAGE_BOUNDS } from "../storage/world-protocol";
import { recordSpawnClaims, relationObservations } from "./relations";
import { handleWorldRpc } from "../rpc/world";
import type { BridgeRpcContext } from "../rpc/context";
import type { WorldSnapshotResult } from "./snapshot";
import { WorldObservation } from "./observation-v1";
import { planBoardPatch } from "./board-plan";
import {
  legacyAppearanceObservations,
  legacyAppearanceObservationOps,
} from "./appearance-observation";
import { tabCardKey } from "../../../shared/terminalColor";

let dense: WorldSnapshotResult;
const stores: WorldStorage[] = [],
  roots: string[] = [];
beforeAll(async () => {
  dense = await createDenseSnapshotFixture().service.snapshot();
});
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
async function open() {
  const root = mkdtempSync(join(tmpdir(), "board-dense-metadata-"));
  roots.push(root);
  const store = await openStorage(
    resolveDataPaths({ HERDR_WORLD_DATA_DIR: root }),
    { clock: systemClock, scheduler: systemScheduler },
  );
  stores.push(store);
  return store;
}
function withSpawn(
  base: WorldSnapshotResult = dense,
  parentIndex = 1,
): WorldSnapshotResult {
  const host = base.connections[0]!,
    parent = host.snapshot!.panes[parentIndex]!;
  return {
    ...base,
    connections: base.connections.map((connection, index) =>
      index
        ? connection
        : {
            ...host,
            snapshot: {
              ...host.snapshot!,
              panes: host.snapshot!.panes.map((pane, index) =>
                index
                  ? pane
                  : {
                      ...pane,
                      tokens: {
                        spawned_by: parent.pane_id,
                        unrelated_metadata: "x".repeat(1024 * 1024),
                      },
                    },
              ),
            },
          },
    ),
  };
}
function completeHost(): WorldSnapshotResult {
  const host = dense.connections[0]!,
    source = host.snapshot!,
    tab = source.tabs[0]!;
  const panes = source.panes.filter((p) => p.tab_id === tab.tab_id),
    tabs = [tab],
    workspaces = source.workspaces.filter(
      (w) => w.workspace_id === tab.workspace_id,
    );
  return {
    ...dense,
    connections: dense.connections.map((connection, index) =>
      index
        ? connection
        : {
            ...host,
            snapshot: {
              ...source,
              panes,
              tabs,
              workspaces,
              coverage: {
                ...source.coverage,
                panes: panes.length,
                tabs: tabs.length,
                workspaces: workspaces.length,
              },
            },
          },
    ),
  };
}
test("a maintained dense snapshot records a small spawn claim through the real storage root", async () => {
  const store = await open(),
    snapshot = withSpawn(),
    warnings: unknown[] = [];
  expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeGreaterThan(
    STORAGE_BOUNDS.queuedBytes,
  );
  const projection = relationObservations(snapshot);
  expect(Buffer.byteLength(JSON.stringify(projection))).toBeLessThan(
    STORAGE_BOUNDS.queuedBytes,
  );
  expect(JSON.stringify(projection)).not.toContain("unrelated_metadata");
  await recordSpawnClaims(
    store.board(),
    snapshot,
    () => {},
    { warn: (message, fields) => warnings.push({ message, fields }) },
    1000,
  );
  expect(store.board().get().relations.spawns).toHaveLength(1);
  expect(warnings).toEqual([]);
});

test("the actual snapshot RPC adopts a legacy tab colour from maintained dense metadata", async () => {
  const observed = completeHost();
  const store = await open(),
    board = store.board(),
    host = observed.connections[0]!,
    snapshot = host.snapshot!,
    tab = snapshot.tabs[0]!;
  expect(Buffer.byteLength(JSON.stringify(observed))).toBeGreaterThan(
    STORAGE_BOUNDS.queuedBytes,
  );
  const key = tabCardKey(
    host.connection_id,
    String(tab.tab_id),
    new Set(snapshot.workspaces.map((w) => String(w.workspace_id))),
  );
  await board.patch([{ op: "card.color", key, color: "pink" }]);
  const warnings: unknown[] = [],
    errors: unknown[] = [],
    published: number[] = [];
  const ws = {};
  await handleWorldRpc({
    id: "synthetic-dense-snapshot",
    method: "world.snapshot",
    params: {},
    req: { id: "synthetic-dense-snapshot", method: "world.snapshot" },
    ws,
    requestIsCurrent: () => true,
    services: {
      board: () => board,
      clock: systemClock,
      clients: new Set([ws]),
      safeSend: () => true,
      publishBoardChanged: (revision: number) => published.push(revision),
      logger: {
        warn: (message: string, fields: unknown) =>
          warnings.push({ message, fields }),
      },
      connectionManager: {
        readyRuntimeLease: (id: string) => {
          const host = observed.connections.find((h) => h.connection_id === id);
          return host
            ? {
                generation: host.generation,
                isCurrent: () => true,
                runtime: {
                  herdr: {
                    call: async () => ({ panes: host.snapshot?.panes ?? [] }),
                  },
                },
              }
            : null;
        },
      },
      worldSnapshots: {
        observation: new WorldObservation("synthetic-dense-service"),
        snapshot: async () => observed,
      },
    },
    sendReply: () => true,
    sendError: (_context: string, error: unknown) => errors.push(error),
  } as unknown as BridgeRpcContext);
  expect(warnings).toEqual([]);
  expect(errors).toEqual([]);
  expect(
    Object.values(board.get().appearance ?? {}).some(
      (record) => record.color_key === key,
    ),
  ).toBe(true);
  expect(board.get().layout.colors[key]).toBe("pink");
  expect(warnings).toEqual([]);
  expect(errors).toEqual([]);
  expect(published).toHaveLength(1);
});

test("compact relation plans retain completeness and recheck authority against the latest committed records", async () => {
  const store = await open(),
    board = store.board(),
    snapshot = withSpawn(completeHost()),
    host = snapshot.connections[0]!;
  const gone = {
    child: {
      connection_id: host.connection_id,
      terminal_id: "synthetic-gone-child",
    },
    parent: {
      connection_id: host.connection_id,
      terminal_id: "synthetic-gone-parent",
    },
    source: "herdr:spawned_by",
    generation: 0,
    observed_at: 1,
  };
  const warnings: unknown[] = [],
    publish: number[] = [];
  const logger = {
    warn: (message: string, fields: unknown) =>
      warnings.push({ message, fields }),
  };
  const seed = board.patch([{ op: "spawn.record", claims: [gone] }]);
  await recordSpawnClaims(
    board,
    snapshot,
    (revision) => publish.push(revision),
    logger,
    1000,
  );
  await seed;
  expect(board.get().relations.spawns).toHaveLength(1);
  expect(board.get().relations.spawns[0]!.child.terminal_id).toBe(
    String(host.snapshot!.panes[0]!.terminal_id),
  );
  await board.patch([{ op: "spawn.record", claims: [gone] }]);
  await recordSpawnClaims(
    board,
    withSpawn(),
    (revision) => publish.push(revision),
    logger,
    1001,
  );
  expect(board.get().relations.spawns).toHaveLength(2);
  const before = board.get();
  let current = true;
  const retiring = board.patch(
    planBoardPatch([], () => {
      current = false;
      return null;
    }),
  );
  await recordSpawnClaims(
    board,
    withSpawn(completeHost(), 2),
    (revision) => publish.push(revision),
    logger,
    1002,
    (id, generation) =>
      id !== host.connection_id || (current && generation === host.generation),
  );
  await retiring;
  expect(board.get()).toEqual(before);
  expect(warnings).toEqual([]);
  expect(publish).toHaveLength(1);
});

test.each(["current", "retired", "partial", "generation"])(
  "compact appearance plans use committed colours and preserve %s authority",
  async (mode) => {
    const store = await open(),
      board = store.board(),
      snapshot = completeHost(),
      host = snapshot.connections[0]!;
    if (mode === "partial") host.snapshot!.coverage.panes++;
    if (mode === "generation") host.snapshot_generation = host.generation - 1;
    const observations = legacyAppearanceObservations(snapshot),
      tab = host.snapshot!.tabs[0]!;
    const key = tabCardKey(
      host.connection_id,
      String(tab.tab_id),
      new Set(host.snapshot!.workspaces.map((w) => String(w.workspace_id))),
    );
    let current = true;
    const queued = [board.patch([{ op: "card.color", key, color: "pink" }])];
    if (mode === "retired")
      queued.push(
        board.patch(
          planBoardPatch([], () => {
            current = false;
            return null;
          }),
        ),
      );
    const plan = planBoardPatch([observations], (document) => {
      const ops = legacyAppearanceObservationOps(
        document,
        observations,
        (id, generation) =>
          id !== host.connection_id ||
          (current && generation === host.generation),
      );
      return ops.length ? ops : null;
    });
    expect(plan.retainedBytes).toBeLessThan(STORAGE_BOUNDS.queuedBytes);
    queued.push(board.patch(plan));
    await Promise.all(queued);
    expect(
      Object.values(board.get().appearance ?? {}).some(
        (record) => record.color_key === key,
      ),
    ).toBe(mode === "current");
    expect(board.get().layout.colors[key]).toBe("pink");
  },
);
