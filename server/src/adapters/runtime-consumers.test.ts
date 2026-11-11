import { expect, test } from "bun:test";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import { writeTerminalTokens } from "../agent/terminal-tokens";
import { readDeskWatch } from "../world/desk-watch-read";
import { WorldSnapshotService } from "../world/snapshot";

test("World snapshots accept a runtime with typed operations and no native client", async () => {
  const operations = {
    listWorkspaces: async () => ({ workspaces: [{ workspace_id: "room" }] }),
    listTabs: async () => ({
      tabs: [{ tab_id: "desk", workspace_id: "room" }],
    }),
    listTerminals: async () => ({
      panes: [
        {
          pane_id: "seat",
          workspace_id: "room",
          tab_id: "desk",
          terminal_id: "terminal",
        },
      ],
    }),
    listAgents: async () => ({ agents: [] }),
  };
  const snapshots = new WorldSnapshotService({
    list: () => [
      {
        id: "example",
        label: "Example",
        source: "test",
        is_default: true,
        generation: 1,
        state: "ready" as const,
      },
    ],
    readyRuntimeLease: (connectionId) => ({
      connectionId,
      generation: 1,
      runtime: { operations },
      isCurrent: () => true,
    }),
  });
  const result = await snapshots.snapshot();
  expect(result.connections[0]?.actionable).toBe(true);
  expect(result.connections[0]?.snapshot?.panes[0]?.terminal_id).toBe(
    "terminal",
  );
});

test("Desk screen reads use typed operations and discard a changed session", async () => {
  let replaced = false;
  const runtime = {
    operations: {
      getTerminal: async () => ({
        pane: {
          pane_id: "seat",
          terminal_id: "terminal",
          agent_session: replaced
            ? {
                source: "harness",
                agent: "claude",
                kind: "id",
                value: "replacement",
              }
            : null,
        },
      }),
      readTerminal: async () => {
        replaced = true;
        return { text: "old screen" };
      },
    },
  } as unknown as LegacyConnectionRuntime;
  const target = {
    connection_id: "example",
    connection_generation: 1,
    pane_id: "seat",
    session: null,
  };
  expect(await readDeskWatch(runtime, "screen", target, () => true)).toEqual({
    retired: true,
  });
});

test("typed metadata producers keep terminal ownership checks without a native client", async () => {
  let current = true;
  const writes: unknown[] = [];
  const lease = {
    generation: 1,
    isCurrent: () => current,
    runtime: {
      operations: {
        getTerminal: async () => ({
          pane: { pane_id: "seat", terminal_id: "terminal" },
        }),
        listTerminals: async () => ({ panes: [] }),
      },
      sessions: {
        reportMetadata: async (report: unknown) => {
          writes.push(report);
        },
      },
    },
  };
  await writeTerminalTokens(lease, "seat", "terminal", {
    world_terminal: "terminal",
  });
  expect(writes).toEqual([
    {
      pane_id: "seat",
      source: "herdr-world:terminal-settings",
      tokens: { world_terminal: "terminal" },
    },
  ]);
  current = false;
  await expect(
    writeTerminalTokens(lease, "seat", "terminal", {
      world_terminal: "terminal",
    }),
  ).rejects.toThrow("runtime changed");
  expect(writes).toHaveLength(1);
});
