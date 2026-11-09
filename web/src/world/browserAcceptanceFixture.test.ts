import { expect, test } from "bun:test";
import { createDenseSnapshotFixture } from "./browserAcceptanceFixture";

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
    // Release host reads here; the browser acceptance owns the real 20 s stall.
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
