import { describe, expect, it } from "vitest";
import type { BridgeRuntime } from "../bridge";
import { hostProfile } from "../hostProfile";
import type { Snapshot } from "../types";
import { worldSourcesFromRuntime } from "./worldRuntime";

const EMPTY_SNAPSHOT: Snapshot = { workspaces: [], tabs: [], panes: [], layouts: [] };

describe("World runtime source adapter", () => {
  it("uses only current-generation admitted state and preserves stale snapshots", () => {
    const current = runtime("current", "ready", ["snapshot", "terminal_attach"]);
    const stale = runtime("stale", "offline", null);
    const sources = worldSourcesFromRuntime(
      [
        hostProfile("current", "Host", "http://current.example", true, 0),
        hostProfile("stale", "Host", "http://stale.example", true, 1),
      ],
      [current, stale],
      {
        current: {
          connectionKey: current.generationKey,
          snapshot: EMPTY_SNAPSHOT,
          loadState: "ready",
        },
        stale: {
          connectionKey: stale.generationKey,
          snapshot: EMPTY_SNAPSHOT,
          loadState: "error",
        },
      },
    );

    expect(sources[0]).toMatchObject({
      connectionState: "compatible",
      generationKey: current.generationKey,
      snapshot: EMPTY_SNAPSHOT,
    });
    expect(sources[1]).toMatchObject({
      connectionState: "offline",
      generationKey: stale.generationKey,
      snapshot: EMPTY_SNAPSHOT,
    });
  });

  it("rejects prior-generation state and retains disabled profiles as structural hosts", () => {
    const enabled = runtime("enabled", "ready", ["snapshot"]);
    const disabled = runtime("disabled", "ready", ["snapshot", "terminal_attach"]);
    const sources = worldSourcesFromRuntime(
      [
        hostProfile("enabled", "Enabled", "http://enabled.example", true, 0),
        hostProfile("disabled", "Disabled", "http://disabled.example", false, 1),
      ],
      [enabled, disabled],
      {
        enabled: {
          connectionKey: "prior-generation",
          snapshot: EMPTY_SNAPSHOT,
          loadState: "ready",
        },
        disabled: {
          connectionKey: disabled.generationKey,
          snapshot: EMPTY_SNAPSHOT,
          loadState: "ready",
        },
      },
    );

    expect(sources[0]).toMatchObject({
      connectionState: "connecting",
      generationKey: null,
      snapshot: null,
    });
    expect(sources[1]).toMatchObject({ connectionState: "disabled" });
  });
});

function runtime(
  id: string,
  capabilityState: BridgeRuntime["capabilityState"],
  features: string[] | null,
): BridgeRuntime {
  return {
    id,
    mode: "configured",
    label: id,
    color: "#fff",
    backend: null,
    connectionKey: `${id}:connection`,
    capabilityGeneration: 1,
    generationKey: `${id}:connection:capability:1`,
    resumeToken: 0,
    capabilities: features
      ? {
          bridge_api_version: 1,
          bridge_version: "0.1.0",
          herdr_version: "0.8.2",
          terminal_protocol: 20,
          features,
          commands: [],
        }
      : null,
    capabilityState,
    capabilityError: null,
    canConnect: true,
    httpUrl: (path) => path,
    wsUrl: (path) => path,
  };
}
