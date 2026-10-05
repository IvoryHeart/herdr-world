import { expect, test } from "bun:test";
import {
  admitCreatedTerminal,
  createdTerminalIdentity,
} from "./createdTerminalAdmission";

function fixture() {
  let state = {
    available: false,
    observation: "1",
    invalidReason: undefined as string | undefined,
  };
  const listeners = new Set<() => void>();
  const subscription = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    current: () => state,
    observe: async () => {},
  };
  return {
    ...subscription,
    listeners,
    update: (patch: Partial<typeof state>) => {
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    },
  };
}

test("created-terminal admission waits for topology and retries only a new observation", async () => {
  const f = fixture();
  const attempted = Promise.withResolvers<void>();
  let opens = 0;
  const pending = admitCreatedTerminal({
    ...f,
    open: async () => {
      opens++;
      attempted.resolve();
      if (opens === 1) throw new Error("Synthetic transient admission failure");
    },
  });
  expect(opens).toBe(0);
  f.update({ available: true });
  await attempted.promise;
  await Promise.resolve();
  await Promise.resolve();
  f.update({ available: true });
  expect(opens).toBe(1);
  f.update({ observation: "2" });
  await pending;
  expect(opens).toBe(2);
  expect(f.listeners.size).toBe(0);
});

test("newer intent or runtime retirement aborts an in-flight admission", async () => {
  for (const invalidReason of [
    "Newer Inspector selection",
    "Runtime retired",
  ]) {
    const f = fixture();
    f.update({ available: true });
    let signal: AbortSignal | null = null;
    const gate = Promise.withResolvers<void>();
    const pending = admitCreatedTerminal({
      ...f,
      open: async (currentSignal) => {
        signal = currentSignal;
        await gate.promise;
      },
    });
    void pending.catch(() => {});
    f.update({ invalidReason });
    await expect(pending).rejects.toThrow(invalidReason);
    expect(signal!.aborted).toBe(true);
    expect(f.listeners.size).toBe(0);
    gate.resolve();
  }
});

test("missing created topology and cancelled shells release subscriptions by a finite deadline", async () => {
  const f = fixture();
  await expect(
    admitCreatedTerminal({
      ...f,
      timeoutMs: 5,
      open: async () => {
        throw new Error("Should not open");
      },
    }),
  ).rejects.toThrow("snapshot window");
  expect(f.listeners.size).toBe(0);
  const controller = new AbortController();
  const pending = admitCreatedTerminal({
    ...f,
    signal: controller.signal,
    open: async () => {},
  });
  controller.abort();
  await expect(pending).rejects.toThrow("superseded");
  expect(f.listeners.size).toBe(0);
});

test("created-terminal identity requires the returned qualified root, never another pane", () => {
  const root_pane = {
    pane_id: "created-pane",
    terminal_id: "created-terminal",
    workspace_id: "workspace",
    tab_id: "tab",
  };
  expect(createdTerminalIdentity({ root_pane })).toEqual({
    paneId: root_pane.pane_id,
    terminalId: root_pane.terminal_id,
    workspaceId: root_pane.workspace_id,
    tabId: root_pane.tab_id,
  });
  expect(createdTerminalIdentity({ pane: root_pane })).toBeNull();
  expect(
    createdTerminalIdentity({ root_pane: { pane_id: "created-pane" } }),
  ).toBeNull();
});
