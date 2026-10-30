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
