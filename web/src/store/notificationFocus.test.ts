import { expect, test } from "bun:test";
import { focusTaskNotification } from "./notificationFocus";
import type { StoreConnectionLease } from "./types";

test("an ask notification never focuses a replacement terminal reusing its pane ID", async () => {
  let focused = false,
    unavailable = false;
  const lease = {
    client: {
      serverRuntimeGeneration: 2,
      call: async () => ({
        pane: {
          pane_id: "w1:p1",
          workspace_id: "w1",
          terminal_id: "replacement-terminal",
        },
      }),
    },
  } as unknown as StoreConnectionLease;
  await focusTaskNotification(
    {
      connectionId: "alpha",
      runtimeGeneration: 2,
      workspaceId: "w1",
      paneId: "w1:p1",
      terminalId: "original-terminal",
    },
    {},
    {
      targetIsCurrent: () => true,
      captureLease: () => lease,
      navigationRevision: () => 1,
      isCurrent: () => true,
      focus: async () => {
        focused = true;
        return true;
      },
      activate: () => true,
      unavailable: () => {
        unavailable = true;
      },
    },
  );
  expect(focused).toBe(false);
  expect(unavailable).toBe(true);
});
