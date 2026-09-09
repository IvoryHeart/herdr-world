// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { CoreNavigationProvider } from "./CoreNavigation";
import { coreSurfaceRegistry } from "./surfaceRegistry";
import type { BridgeRuntime } from "./bridge";
import type { HostProfile } from "./hostProfile";
import type { BridgeConnectionRef, BridgeConnectionState } from "./runtimeConnection";
import type { Snapshot } from "./types";

const testState = vi.hoisted(() => ({
  hostRegistry: null as unknown,
  federatedRuntime: null as unknown,
}));

vi.mock("./hostRegistry", () => ({
  useHostRegistry: () => testState.hostRegistry,
}));

vi.mock("./federatedRuntime", () => ({
  useFederatedRuntime: () => testState.federatedRuntime,
}));

vi.mock("./TerminalView", () => ({
  TerminalView: () => <div>Selected Spaces terminal</div>,
}));

vi.mock("./world/WorldSurface", () => ({
  default: ({ context }: { context?: { selectedKey?: string | null } }) => (
    <output data-testid="world-selection">{context?.selectedKey ?? "none"}</output>
  ),
  isWorldSurfaceContext: (value: unknown) => Boolean(value && typeof value === "object"),
}));

const roots: Root[] = [];

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, "", "/spaces");
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem(
    "herdr.mobileWeb.displayPrefs.v2",
    JSON.stringify({ sidebarOpen: false, notesEnabled: false }),
  );
  window.localStorage.setItem(
    "herdr.mobileWeb.sharedNavigation.v1",
    JSON.stringify({
      selectedBridgeId: "host-a",
      selectedPane: { bridgeId: "host-a", paneId: "pane-a" },
      activeWorkspace: { bridgeId: "host-a", workspaceId: "space-a" },
      selectedPanesByBridgeId: { "host-a": "pane-a" },
      activeWorkspacesByBridgeId: { "host-a": "space-a" },
    }),
  );
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

  const snapshot = selectedSpacesSnapshot();
  const runtime = bridgeRuntime();
  const connectionState: BridgeConnectionState = {
    connectionKey: runtime.generationKey,
    snapshot,
    loadState: "ready",
  };
  const connectionRef: BridgeConnectionRef = {
    profileConnectionKey: runtime.connectionKey,
    connectionKey: runtime.generationKey,
    snapshot,
    activityGeneration: 0,
    resyncBarrierGeneration: 0,
    activityLog: [],
    sharedSelectionOverride: null,
    recoveryRequired: false,
    awaitingCapabilityHandshake: false,
  };
  const profile: HostProfile = {
    schemaVersion: 1,
    profileId: runtime.id,
    label: runtime.label,
    baseUrl: "https://host-a.example.test",
    enabled: true,
    displayOrder: 0,
  };

  testState.hostRegistry = {
    availableRuntimes: [runtime],
    enabledRuntimes: [runtime],
    enabledBridgeIds: [runtime.id],
    profiles: [profile],
    storeLoaded: true,
    lastSelectedBridgeId: runtime.id,
    getRuntime: (bridgeId: string | null | undefined) => bridgeId === runtime.id ? runtime : null,
    setLastSelectedBridgeId: vi.fn(),
    markBridgeUsed: vi.fn(),
    retryBridgeProbe: vi.fn(),
    routeTarget: vi.fn(() => runtime),
  };
  testState.federatedRuntime = {
    connectionStates: { [runtime.id]: connectionState },
    setConnectionStates: vi.fn(),
    connectionRefs: { current: { [runtime.id]: connectionRef } },
    runtimeCache: {},
    refreshSnapshot: vi.fn(),
    setObservers: vi.fn(),
    setFollowSharedSelection: vi.fn(),
  };
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("App view navigation", () => {
  it("seeds the selected Spaces pane when the collapsed strip opens a World view", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <CoreNavigationProvider registry={coreSurfaceRegistry}>
          <App />
        </CoreNavigationProvider>,
      );
    });

    const office = container.querySelector<HTMLButtonElement>("[aria-label='Switch to Office']");
    expect(office).not.toBeNull();
    await act(async () => {
      office?.click();
      await Promise.resolve();
    });
    await waitForWorldSurface(container);

    expect(container.querySelector("[data-testid='world-selection']")?.textContent).toBe(
      '["host-a","terminal","terminal-a"]',
    );
  });
});

async function waitForWorldSurface(container: HTMLElement) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (container.querySelector("[data-testid='world-selection']")) {
      return;
    }
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }
  throw new Error("World surface did not render");
}

function bridgeRuntime(): BridgeRuntime {
  return {
    id: "host-a",
    mode: "configured",
    label: "Host A",
    color: "#89b4fa",
    backend: null,
    connectionKey: "host-a-connection",
    capabilityGeneration: 1,
    generationKey: "host-a-generation-1",
    resumeToken: 0,
    capabilities: {
      commands: [],
      features: ["snapshot", "terminal_attach"],
    },
    capabilityState: "ready",
    capabilityError: null,
    canConnect: true,
    httpUrl: (path) => `https://host-a.example.test${path}`,
    wsUrl: (path) => `wss://host-a.example.test${path}`,
  };
}

function selectedSpacesSnapshot(): Snapshot {
  return {
    workspaces: [{
      workspace_id: "space-a",
      number: 1,
      label: "Synthetic space",
      focused: true,
      pane_count: 1,
      tab_count: 1,
      active_tab_id: "tab-a",
      agent_status: "working",
    }],
    tabs: [{
      tab_id: "tab-a",
      workspace_id: "space-a",
      number: 1,
      label: "Synthetic tab",
      focused: true,
      pane_count: 1,
      agent_status: "working",
    }],
    panes: [{
      pane_id: "pane-a",
      terminal_id: "terminal-a",
      workspace_id: "space-a",
      tab_id: "tab-a",
      focused: true,
      display_agent: "Synthetic agent",
      agent_status: "working",
      revision: 1,
    }],
    layouts: [],
    selected_pane_id: "pane-a",
  };
}
