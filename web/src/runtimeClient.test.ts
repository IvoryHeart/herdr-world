import { describe, expect, it } from "vitest";
import {
  hostConnectionState,
  parseSnapshot,
  RuntimeCache,
  runtimeAdmissionReady,
  runtimeCommandReady,
  runtimeControlsEnabled,
  runtimeFeatureReady,
  SnapshotContractError,
} from "./runtimeClient";
import type { BridgeRuntime } from "./bridge";

describe("runtime cache", () => {
  it("reconciles topology only from an admitted host snapshot", () => {
    const cache = new RuntimeCache<{ panes: string[] }>();
    cache.configure("host-a", "connection-a", "generation-a");
    expect(cache.admitSnapshot("host-a", "generation-a", { panes: ["p1"] }, 1)).toBe(true);
    expect(cache.admitSnapshot("host-a", "stale-generation", { panes: ["p2"] }, 2)).toBe(false);
    expect(cache.get("host-a")?.snapshot).toEqual({ panes: ["p1"] });

    expect(cache.admitSnapshot("host-a", "generation-a", { panes: [] }, 3)).toBe(true);
    expect(cache.get("host-a")?.snapshot).toEqual({ panes: [] });
  });

  it("isolates host failures and retains only explicitly stale presentation state", () => {
    const cache = new RuntimeCache<{ panes: string[] }>();
    cache.configure("host-a", "connection-a", "generation-a");
    cache.configure("host-b", "connection-b", "generation-b");
    cache.admitSnapshot("host-a", "generation-a", { panes: ["same-id"] }, 1);
    cache.admitSnapshot("host-b", "generation-b", { panes: ["same-id"] }, 1);

    cache.markUnavailable("host-b", "generation-b");

    expect(cache.get("host-a")).toMatchObject({ stale: false, snapshot: { panes: ["same-id"] } });
    expect(cache.get("host-b")).toMatchObject({ stale: true, snapshot: { panes: ["same-id"] } });
  });

  it("retains stale presentation while isolating a new capability generation", () => {
    const cache = new RuntimeCache<{ panes: string[] }>();
    cache.configure("host-a", "connection-a", "generation-0");
    cache.admitSnapshot("host-a", "generation-0", { panes: ["p1"] }, 1);

    cache.configure("host-a", "connection-a", "generation-1");

    expect(cache.get("host-a")).toMatchObject({
      generationKey: "generation-1",
      stale: true,
      snapshot: { panes: ["p1"] },
    });
    expect(cache.admitSnapshot("host-a", "generation-0", { panes: ["stale"] })).toBe(false);
  });
});

describe("host connection state", () => {
  it("maps independent capability and snapshot outcomes to bounded states", () => {
    expect(hostConnectionState("probing", "loading", false)).toBe("connecting");
    expect(hostConnectionState("ready", "ready", true)).toBe("compatible");
    expect(hostConnectionState("ready", "error", true)).toBe("offline");
    expect(hostConnectionState("incompatible", "ready", false)).toBe("incompatible");
    expect(hostConnectionState("error", "error", true)).toBe("degraded");
  });

  it("enables controls only after a fresh compatible snapshot", () => {
    const runtime = readyRuntime();
    expect(runtimeControlsEnabled(runtime, "loading")).toBe(false);
    expect(runtimeControlsEnabled(runtime, "error")).toBe(false);
    expect(runtimeControlsEnabled(runtime, "ready")).toBe(true);
    expect(runtimeControlsEnabled({ ...runtime, capabilityState: "offline" }, "ready")).toBe(false);
    expect(
      runtimeAdmissionReady(runtime, {
        connectionKey: runtime.generationKey,
        snapshot: {},
        loadState: "ready",
      }, ["snapshot"]),
    ).toBe(true);
    expect(
      runtimeAdmissionReady(runtime, {
        connectionKey: "connection-a:capability:previous",
        snapshot: {},
        loadState: "ready",
      }, ["snapshot"]),
    ).toBe(false);
    expect(
      runtimeFeatureReady(
        runtime,
        { connectionKey: runtime.generationKey, snapshot: {}, loadState: "ready" },
        "snapshot",
      ),
    ).toBe(true);
    expect(
      runtimeCommandReady(
        { ...runtime, capabilities: { ...runtime.capabilities, commands: ["workspace.create"] } },
        { connectionKey: runtime.generationKey, snapshot: {}, loadState: "ready" },
        "workspace.create",
      ),
    ).toBe(true);
    expect(
      runtimeCommandReady(
        runtime,
        { connectionKey: runtime.generationKey, snapshot: {}, loadState: "error" },
        "workspace.create",
      ),
    ).toBe(false);
  });

  it("keeps core runtime admission independent from optional observability", () => {
    const runtime = readyRuntime();
    expect(runtime.capabilities?.observability).toBeUndefined();
    expect(
      runtimeAdmissionReady(
        runtime,
        { connectionKey: runtime.generationKey, snapshot: {}, loadState: "ready" },
        ["snapshot"],
      ),
    ).toBe(true);
  });
});

describe("snapshot admission contract", () => {
  it("parses a bounded coherent Herdr snapshot", () => {
    expect(parseSnapshot(validSnapshot()).panes[0]?.pane_id).toBe("pane-1");
  });

  it("preserves admitted workspace worktree metadata and rejects malformed metadata", () => {
    const worktree = {
      repo_key: "repo-1",
      repo_name: "herdr-world",
      repo_root: "/forge/herdr-world",
      checkout_path: "/forge/herdr-world/.agents/worktree",
      is_linked_worktree: true,
    };
    const snapshot = validSnapshot();
    const input = {
      ...snapshot,
      workspaces: [{ ...snapshot.workspaces[0], worktree }],
    };

    expect(parseSnapshot(input).workspaces[0]?.worktree).toEqual(worktree);
    expect(() => parseSnapshot({
      ...input,
      workspaces: [{ ...input.workspaces[0], worktree: { repo_key: "repo-1" } }],
    })).toThrow(SnapshotContractError);
  });

  it("rejects missing collections, malformed members, and cross-reference drift", () => {
    expect(() => parseSnapshot({})).toThrow(SnapshotContractError);
    expect(() => parseSnapshot({ ...validSnapshot(), panes: [{}] })).toThrow(
      SnapshotContractError,
    );
    expect(() =>
      parseSnapshot({
        ...validSnapshot(),
        panes: [{ ...validSnapshot().panes[0], tab_id: "unknown-tab" }],
      }),
    ).toThrow(SnapshotContractError);
  });

  it("rejects unbounded collections without echoing host data", () => {
    const oversized = Array.from({ length: 20_001 }, () => validSnapshot().panes[0]);
    expect(() => parseSnapshot({ ...validSnapshot(), panes: oversized })).toThrow(
      "Herdr snapshot response is malformed",
    );
  });
});

function readyRuntime(): BridgeRuntime {
  return {
    id: "host-a",
    mode: "configured",
    label: "Host A",
    color: "#89b4fa",
    backend: { id: "host-a", name: "Host A", baseUrl: "http://host-a.example:8787" },
    connectionKey: "connection-a",
    capabilityGeneration: 0,
    generationKey: "connection-a:capability:0",
    resumeToken: 0,
    capabilities: { bridge_api_version: 1, commands: [], features: ["snapshot"] },
    capabilityState: "ready",
    capabilityError: null,
    canConnect: true,
    httpUrl: (path) => path,
    wsUrl: (path) => path,
  };
}

function validSnapshot() {
  return {
    workspaces: [
      {
        workspace_id: "workspace-1",
        number: 1,
        label: "Workspace",
        focused: true,
        pane_count: 1,
        tab_count: 1,
        active_tab_id: "tab-1",
        agent_status: "working",
      },
    ],
    tabs: [
      {
        tab_id: "tab-1",
        workspace_id: "workspace-1",
        number: 1,
        label: "Tab",
        focused: true,
        pane_count: 1,
        agent_status: "working",
      },
    ],
    panes: [
      {
        pane_id: "pane-1",
        terminal_id: "terminal-1",
        workspace_id: "workspace-1",
        tab_id: "tab-1",
        focused: true,
        agent_status: "working",
        revision: 1,
      },
    ],
    layouts: [],
    selected_pane_id: "pane-1",
  };
}
