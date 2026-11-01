import { expect, test } from "bun:test";
import { buildShape, shapes } from "./fixture";

test("scale fixtures reproduce declared input counts and qualified identity collisions", () => {
  for (const shape of shapes) {
    const hosts = buildShape(shape);
    expect(hosts).toHaveLength(shape.sources);
    for (const key of ["workspaces", "tabs", "panes", "agents"] as const) {
      expect(hosts.reduce((n, host) => n + host[key].length, 0)).toBe(
        shape[key],
      );
    }
    expect(
      hosts.flatMap((h) => h.agents).filter((a) => a.status === "working"),
    ).toHaveLength(shape.active);
    for (const host of hosts) {
      const spaces = new Set(host.workspaces.map((w) => w.workspace_id));
      const tabs = new Set(host.tabs.map((t) => t.tab_id));
      expect(
        host.panes.every(
          (p) => spaces.has(p.workspace_id) && tabs.has(p.tab_id),
        ),
      ).toBe(true);
      expect(host.panes.every((p) => typeof p.agent_status === "string")).toBe(
        true,
      );
    }
    if (hosts.length > 1)
      expect(hosts[0]!.panes[0]!.pane_id).toBe(hosts[1]!.panes[0]!.pane_id);
  }
  const room = buildShape(shapes.find((s) => s.id === "room-1440")!);
  expect(room[0]!.workspaces).toHaveLength(1);
  expect(room[0]!.panes).toHaveLength(1440);
});
