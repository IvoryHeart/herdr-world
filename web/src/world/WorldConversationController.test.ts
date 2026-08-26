// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import type { BridgeRuntime } from "../bridge";
import type { BridgeConnectionState } from "../runtimeConnection";
import type { Snapshot } from "../types";
import {
  readWorldConversationTargets,
  worldConversationAdmissionPending,
} from "./WorldConversationController";

const STORAGE_KEY = "herdrWeb.worldConversations.v1";

afterEach(() => {
  sessionStorage.clear();
});

describe("World conversation controller boundary", () => {
  it("restores only bounded valid targets and derives their window identity", () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        ...Array.from({ length: 6 }, (_, index) => ({
          windowId: "untrusted",
          kind: index % 2 === 0 ? "agent" : "desk",
          targetKey: `target-${index}`,
          agentKey: index % 2 === 0 ? `agent-${index}` : null,
          bridgeId: `host-${index}`,
          paneId: `pane-${index}`,
          generationKey: `generation-${index}`,
        })),
        { kind: "agent", targetKey: "missing-runtime-fields" },
      ]),
    );

    expect(readWorldConversationTargets()).toHaveLength(5);
    expect(readWorldConversationTargets()[0]).toMatchObject({
      windowId: "host-0:pane-0",
      targetKey: "target-0",
    });
    expect(readWorldConversationTargets().map(({ targetKey }) => targetKey)).not.toContain(
      "missing-runtime-fields",
    );
  });

  it("keeps a current target pending only while capability or snapshot admission is unresolved", () => {
    const candidate = runtime();

    expect(worldConversationAdmissionPending(candidate, null, candidate.generationKey)).toBe(
      true,
    );
    expect(
      worldConversationAdmissionPending(
        { ...candidate, capabilityState: "probing" },
        null,
        candidate.generationKey,
      ),
    ).toBe(true);
    expect(
      worldConversationAdmissionPending(
        candidate,
        state(candidate.generationKey, "loading"),
        candidate.generationKey,
      ),
    ).toBe(true);
    expect(
      worldConversationAdmissionPending(
        candidate,
        state(candidate.generationKey, "ready"),
        candidate.generationKey,
      ),
    ).toBe(false);
    expect(
      worldConversationAdmissionPending(
        candidate,
        state(candidate.generationKey, "error"),
        candidate.generationKey,
      ),
    ).toBe(false);
    expect(
      worldConversationAdmissionPending(candidate, null, "stale-generation"),
    ).toBe(false);
  });
});

function runtime(): BridgeRuntime {
  return {
    id: "host-a",
    mode: "configured",
    label: "Host A",
    color: "#89b4fa",
    backend: null,
    connectionKey: "host-a:connection",
    capabilityGeneration: 1,
    generationKey: "host-a:connection:capability:1",
    resumeToken: 0,
    capabilities: {
      features: ["snapshot", "terminal_attach"],
      commands: [],
    },
    capabilityState: "ready",
    capabilityError: null,
    canConnect: true,
    httpUrl: (path) => path,
    wsUrl: (path) => path,
  };
}

function state(
  connectionKey: string,
  loadState: BridgeConnectionState["loadState"],
): BridgeConnectionState {
  return {
    connectionKey,
    snapshot: loadState === "ready" ? ({} as Snapshot) : null,
    loadState,
  };
}
