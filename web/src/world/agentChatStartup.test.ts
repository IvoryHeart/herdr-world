import { expect, test } from "bun:test";
import {
  worldInspectorForNode,
  reconcileWorldInspectorConversation,
  applyRequestedInspectorView,
  launchedWorldLeaf,
} from "./worldTerminalPresentation";
import type { WorldLeafObject, WorldObjectNode } from "./worldObject";
const node = {
  id: "agent",
  kind: "agent",
  actionable: true,
  connectionId: "synthetic",
  generation: 7,
  nativeId: "pane",
  terminalId: "terminal",
  workspaceId: "room",
  tabId: "tab",
  label: "Reviewer",
  hostLabel: "Demo",
  spaceLabel: "Room",
  pane: { agent: "codex" },
} as unknown as WorldObjectNode;
const context = {
  kind: "agent",
  label: "Reviewer",
  agent: "codex",
  stateLabel: "Unknown",
  locationLabel: "Room",
} as const;
const create = (session?: string) =>
  worldInspectorForNode(
    {
      ...node,
      ...(session ? { agentSessionFingerprint: session } : {}),
    } as WorldObjectNode,
    "history",
    ["terminal", "history", "files"],
    context,
    { dock: "right", expanded: false, size: 520 },
  )!;
test("no session opens Terminal and arms one qualified Chat handoff", () => {
  const window = create();
  expect(window.view).toBe("terminal");
  expect(window.awaitChatSession).toBe(true);
});
test("session arrival switches an armed continuing pane to Chat", () => {
  const window = {
    ...create(),
    view: "terminal" as const,
    awaitChatSession: true,
  };
  const next = reconcileWorldInspectorConversation(
    window,
    create("a".repeat(64)),
  );
  expect(next.view).toBe("history");
  expect(next.awaitChatSession).not.toBe(true);
});
test("a manual view or a different pane never inherits the pending handoff", () => {
  const manual = {
    ...create(),
    view: "files" as const,
    awaitChatSession: false,
  };
  expect(
    reconcileWorldInspectorConversation(manual, create("a".repeat(64))).view,
  ).toBe("files");
  const other = {
    ...create("b".repeat(64)),
    paneId: "other-pane",
    terminalId: "other-terminal",
  };
  expect(
    reconcileWorldInspectorConversation(
      { ...create(), view: "terminal", awaitChatSession: true },
      other,
    ).awaitChatSession,
  ).not.toBe(true);
});

test("explicit Chat opens of an existing window cannot bypass startup resolution", () => {
  const observed = create();
  expect(
    applyRequestedInspectorView(
      { ...observed, view: "files" },
      observed,
      "history",
    ),
  ).toMatchObject({ view: "terminal", awaitChatSession: true });
});

test("startup handoff state ends after the first native session, preserving later resource replacement rules", () => {
  const first = reconcileWorldInspectorConversation(
    { ...create(), view: "files", awaitChatSession: false },
    create("a".repeat(64)),
  );
  expect(first.view).toBe("files");
  expect(first.awaitChatSession).toBeUndefined();
  const next = reconcileWorldInspectorConversation(first, {
    ...create("b".repeat(64)),
    view: "terminal",
  });
  expect(next.view).toBe("terminal");
});

test("a launcher receipt opens only its current runtime and then uses the startup view policy", () => {
  const target = {
    connectionId: "synthetic",
    runtimeGeneration: 7,
    terminalId: "terminal",
  };
  const leaf = node as WorldLeafObject;
  expect(
    launchedWorldLeaf({ leaves: [{ ...leaf, generation: 8 }] }, target),
  ).toBeUndefined();
  expect(
    launchedWorldLeaf({ leaves: [{ ...leaf, connectionId: "other" }] }, target),
  ).toBeUndefined();
  expect(
    launchedWorldLeaf({ leaves: [{ ...leaf, actionable: false }] }, target),
  ).toBeUndefined();
  expect(launchedWorldLeaf({ leaves: [leaf] }, target)).toBe(leaf);
  expect(create().view).toBe("terminal");
  expect(create().awaitChatSession).toBe(true);
});

test("aggregate replacement permanently retires the original window intent until an explicit new open", () => {
  const original = create();
  const replacement = worldInspectorForNode(
    { ...node, terminalId: "replacement-terminal" } as WorldObjectNode,
    "history",
    ["terminal", "history", "files"],
    context,
    { dock: "right", expanded: false, size: 520 },
  )!;
  const first = reconcileWorldInspectorConversation(original, replacement);
  expect(first.awaitChatSession).toBe(false);
  expect(first.startupIntent).toBe(original.startupIntent);
  const next = reconcileWorldInspectorConversation(first, replacement);
  expect(next.awaitChatSession).toBe(false);
  const arrived = reconcileWorldInspectorConversation(next, {
    ...replacement,
    agentSessionFingerprint: "a".repeat(64),
  });
  expect(arrived.view).toBe("terminal");
  const explicit = applyRequestedInspectorView(next, replacement, "history");
  expect(explicit.awaitChatSession).toBe(true);
  expect(explicit.startupIntent).toBe(replacement.startupIntent);
  expect(explicit.startupIntent).not.toBe(original.startupIntent);
});
