import { expect, test } from "bun:test";
import { createDenseSnapshotFixture } from "./browserAcceptanceFixture";
import { SNAPSHOT_RESPONSE_DEADLINE_MS } from "../../../server/src/world/snapshot";
import { RPC_TIMEOUT_MS } from "../api";

test("owner maximum-scale acceptance observes three hosts, eight workspaces and fifteen tabs per workspace", async () => {
  const fixture = createDenseSnapshotFixture({ maximumScale: true });
  const snapshot = await fixture.service.snapshot();
  expect(snapshot.connections).toHaveLength(3);
  for (const connection of snapshot.connections) {
    const native = connection.snapshot!;
    expect(connection.actionable).toBe(true);
    expect(native.workspaces).toHaveLength(8);
    expect(native.tabs).toHaveLength(8 * 15);
    expect(native.panes).toHaveLength(8 * 15 * 17);
    expect(new Set(native.panes.map((pane) => pane.pane_id)).size).toBe(
      native.panes.length,
    );
    for (const space of native.workspaces)
      expect(
        native.tabs.filter((tab) => tab.workspace_id === space.workspace_id),
      ).toHaveLength(15);
  }
  expect(fixture.stalledIds).toEqual(["beta", "synthetic-0"]);
  fixture.release();
});

test("production fixture refresh sends only changed topology against its negotiated base", async () => {
  const fixture = createDenseSnapshotFixture({ maximumScale: true });
  try {
    const initial = await fixture.snapshot();
    expect(initial.service_incarnation).toBe(
      fixture.service.observation.incarnation,
    );
    expect(
      initial.connections.every((host) => host.snapshot && !host.unchanged),
    ).toBe(true);
    const base = {
      service_incarnation: initial.service_incarnation,
      hosts: initial.connections.map((host) => ({
        connection_id: host.connection_id,
        generation: host.generation,
        token: host.token!,
      })),
    };
    fixture.startStalledAttentionRefresh();
    // Release host reads here; the next case holds them past the deadline.
    fixture.release();
    const refreshed = await fixture.snapshot({ base });
    expect(refreshed.connections.map((host) => host.connection_id)).toEqual(
      initial.connections.map((host) => host.connection_id),
    );
    expect(
      refreshed.connections
        .filter((host) => host.snapshot)
        .map((host) => host.connection_id),
    ).toEqual(["alpha"]);
    expect(
      refreshed.connections[0]!.snapshot!.panes.every(
        (pane) => pane.agent_status === "working",
      ),
    ).toBe(true);
    for (const peer of refreshed.connections.slice(1)) {
      expect(peer.unchanged).toBe(true);
      expect("snapshot" in peer).toBe(false);
    }
    const complete = await fixture.snapshot();
    expect(
      complete.connections.every((host) => host.snapshot && !host.unchanged),
    ).toBe(true);
  } finally {
    fixture.release();
  }
});

test("a stalled refresh replies when its 20 s response deadline expires in test time, with the stalled hosts stale", async () => {
  const fixture = createDenseSnapshotFixture({ maximumScale: true });
  try {
    const initial = await fixture.snapshot();
    const base = {
      service_incarnation: initial.service_incarnation,
      hosts: initial.connections.map((host) => ({
        connection_id: host.connection_id,
        generation: host.generation,
        token: host.token!,
      })),
    };
    fixture.startStalledAttentionRefresh();
    const refreshed = await fixture.snapshot({ base });
    expect(fixture.expiredDeadlines).toEqual([SNAPSHOT_RESPONSE_DEADLINE_MS]);
    const alpha = refreshed.connections[0]!;
    expect(alpha.connection_id).toBe("alpha");
    expect(alpha.stale).toBeFalsy();
    expect(
      alpha.snapshot!.panes.every((pane) => pane.agent_status === "working"),
    ).toBe(true);
    for (const id of fixture.stalledIds)
      expect(
        refreshed.connections.find((host) => host.connection_id === id)?.stale,
      ).toBe(true);
  } finally {
    fixture.release();
  }
});

test("the browser waits for a snapshot reply longer than the service's response deadline", () => {
  // The acceptance fixture expires the deadline in test time, so this holds
  // the property its 20 real seconds used to show: a stalled host's reply
  // reaches the browser before the browser gives up on the request.
  expect(RPC_TIMEOUT_MS).toBeGreaterThan(SNAPSHOT_RESPONSE_DEADLINE_MS);
});
