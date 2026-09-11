import { describe, expect, it } from "vitest";

import { hostProfile } from "../hostProfile";
import type { PaneInfo, Snapshot } from "../types";
import { buildWorldModel } from "./worldModel";
import type { WorldRuntimeSource } from "./worldModel";

describe("World model", () => {
  it("builds one host-qualified hierarchy shared by every World projection", () => {
    const model = buildWorldModel([
      source("host-a", 1, snapshot([
        pane("agent", "working", { agent: "codex", display_agent: "Codex" }),
        pane("shell", "unknown"),
      ])),
      source("host-b", 0, snapshot([pane("agent", "idle", { agent: "claude" })])),
    ]);

    expect(model.hosts.map(({ hostKey }) => hostKey)).toEqual(["host-b", "host-a"]);
    expect(model.hosts.every(({ parentId }) => parentId === null)).toBe(true);
    expect(model.hosts.flatMap(({ spaces }) => spaces).every(({ kind }) => kind === "space"))
      .toBe(true);
    expect(model.hosts.find(({ hostKey }) => hostKey === "host-a")?.spaces[0]?.children)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "agent", agentKind: "codex" }),
        expect.objectContaining({ kind: "terminal", agentKind: null }),
      ]));
    expect(new Set(model.nodes.map(({ id }) => id)).size).toBe(model.nodes.length);
    expect(model.edges).toHaveLength(model.spaces.length + model.leaves.length);
    expect(model.nodes.some(({ kind }) => kind === "host")).toBe(true);
    expect(model.nodes.some(({ kind }) => kind === "space")).toBe(true);
    expect(model.nodes.some(({ kind }) => kind === "agent")).toBe(true);
    expect(model.nodes.some(({ kind }) => kind === "terminal")).toBe(true);
  });

  it("keeps terminal-backed identity stable when a terminal becomes an agent", () => {
    const before = buildWorldModel([source("host-a", 0, snapshot([pane("same", "unknown")]))]);
    const after = buildWorldModel([source(
      "host-a",
      0,
      snapshot([pane("same", "working", { agent: "codex", display_agent: "Codex" })]),
    )]);

    expect(before.leaves[0]).toMatchObject({ kind: "terminal" });
    expect(after.leaves[0]).toMatchObject({ kind: "agent" });
    expect(after.leaves[0]?.id).toBe(before.leaves[0]?.id);
    expect(after.leaves[0]?.parentId).toBe(before.leaves[0]?.parentId);
  });

  it("retains configured hosts without inventing descendants from absent snapshots", () => {
    const disabled = source("disabled", 0, snapshot([]));
    disabled.profile.enabled = false;
    disabled.connectionState = "disabled";
    const unavailable = source("offline", 1, null);
    unavailable.connectionState = "offline";
    const model = buildWorldModel([disabled, unavailable]);

    expect(model.hosts).toHaveLength(2);
    expect(model.hosts.every(({ spaces }) => spaces.length === 0)).toBe(true);
    expect(model.nodes.map(({ kind }) => kind)).toEqual(["host", "host"]);
  });

  it("retains admitted descendants as stale and non-actionable when their host disconnects", () => {
    const stale = source("stale", 0, snapshot([pane("agent", "working", { agent: "codex" })]));
    stale.connectionState = "offline";

    const model = buildWorldModel([stale]);

    expect(model.hosts[0]).toMatchObject({
      stale: true,
      actionable: false,
      source: { connectionState: "offline" },
    });
    expect(model.hosts[0]?.spaces).toHaveLength(1);
    expect(model.hosts[0]?.spaces[0]?.children).toHaveLength(1);
  });
});

function source(
  id: string,
  displayOrder: number,
  value: Snapshot | null,
): WorldRuntimeSource {
  return {
    profile: hostProfile(id, id, `http://${id}.example`, true, displayOrder),
    location: "remote",
    connectionState: value ? "compatible" : "offline",
    generationKey: value ? `${id}:generation` : null,
    features: ["snapshot", "terminal_attach"],
    snapshot: value,
  };
}

function snapshot(panes: PaneInfo[]): Snapshot {
  return {
    workspaces: [{
      workspace_id: "same-space",
      number: 1,
      label: "Space",
      focused: true,
      pane_count: panes.length,
      tab_count: 1,
      active_tab_id: "same-tab",
      agent_status: "unknown",
    }],
    tabs: [{
      tab_id: "same-tab",
      workspace_id: "same-space",
      number: 1,
      label: "Tab",
      focused: true,
      pane_count: panes.length,
      agent_status: "unknown",
    }],
    panes,
    layouts: [],
  };
}

function pane(
  id: string,
  status: PaneInfo["agent_status"],
  extra: Partial<PaneInfo> = {},
): PaneInfo {
  return {
    pane_id: `pane-${id}`,
    terminal_id: `terminal-${id}`,
    workspace_id: "same-space",
    tab_id: "same-tab",
    focused: false,
    agent_status: status,
    revision: 1,
    ...extra,
  };
}
