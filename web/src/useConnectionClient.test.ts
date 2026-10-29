import { resourcePresentationClient } from "./resourcePresentationClient";
import { agentWorktreeHttpEndpoint } from "./agentWorktreeClient";
import type { ConnectionClient } from "./api";
import { describe, expect, test } from "bun:test";
import { connectionClientScopeKey } from "./useConnectionClient";

describe("connection client scope keys", () => {
  test("isolates identical resources by connection and generation", () => {
    const alpha = { connectionId: "alpha", generation: 1 };
    const beta = { connectionId: "beta", generation: 1 };
    expect(connectionClientScopeKey(alpha, "same", "same")).not.toBe(
      connectionClientScopeKey(beta, "same", "same"),
    );
    expect(connectionClientScopeKey(alpha, "same", "same")).not.toBe(
      connectionClientScopeKey(
        { connectionId: "alpha", generation: 2 },
        "same",
        "same",
      ),
    );
  });
});

test("retained cache identity grants no RPC or HTTP authority during worktree readmission", async () => {
  const target = {
    subject: {
      connectionId: "alpha",
      generation: 7,
      paneId: "pane",
      sessionFingerprint: null,
    },
    revision: "r1",
    candidateId: "first",
  };
  let calls = 0;
  const displayed: ConnectionClient = {
    connectionId: "alpha",
    generation: 1,
    serverRuntimeGeneration: 7,
    agentWorktree: target,
    isCurrent: () => false,
    acceptsServerGeneration: (value) => value === 7,
    call: async () => {
      calls++;
      return {};
    },
  };
  const pending = {
    ...displayed,
    generation: 3,
    agentWorktree: null,
    isCurrent: () => true,
  };
  const retained = resourcePresentationClient(pending, displayed);
  expect(connectionClientScopeKey(retained, "files")).toBe(
    connectionClientScopeKey(displayed, "files"),
  );
  expect(retained.agentWorktree).toBeNull();
  expect(retained.isCurrent()).toBe(false);
  await expect(retained.call("file.list", {})).rejects.toThrow("admission");
  expect(() => agentWorktreeHttpEndpoint(retained, "/download")).toThrow(
    "current",
  );
  expect(calls).toBe(0);
  const replacement = {
    ...pending,
    agentWorktree: { ...target, revision: "r2", candidateId: "replacement" },
  };
  expect(
    connectionClientScopeKey(
      resourcePresentationClient(replacement, displayed),
      "files",
    ),
  ).toBe(connectionClientScopeKey(replacement, "files"));
  for (const changed of [
    { ...pending, connectionId: "beta" },
    { ...pending, serverRuntimeGeneration: 8 },
  ])
    expect(
      connectionClientScopeKey(
        resourcePresentationClient(changed, displayed),
        "files",
      ),
    ).not.toBe(connectionClientScopeKey(displayed, "files"));
});
