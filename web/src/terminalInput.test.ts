import { expect, test } from "bun:test";
import { type ConnectionClient, UncertainRequestError } from "./api";
import { __storeTesting, store } from "./store";
import { sendTerminalInput } from "./terminalInput";

test("a reliable not-sent failure cannot suppress the first subsequent uncertainty", async () => {
  const previous = store.get();
  let outcome: Error = new Error("synthetic not connected");
  const client: ConnectionClient = {
    connectionId: "synthetic-ordered-errors",
    generation: 31,
    serverRuntimeGeneration: 7,
    isCurrent: () => false,
    acceptsServerGeneration: () => false,
    call: async () => {
      throw outcome;
    },
  };
  try {
    await expect(
      sendTerminalInput(client, new Uint8Array([97]), "original"),
    ).rejects.toThrow("not connected");
    expect(store.get().notice?.message).toBe("Terminal input was not sent");
    outcome = new UncertainRequestError(
      "terminal.input",
      "synthetic lost acknowledgement",
    );
    await expect(
      sendTerminalInput(client, new Uint8Array([98]), "original"),
    ).rejects.toThrow("uncertain");
    expect(store.get().notice?.message).toBe(
      "Terminal input outcome is uncertain",
    );
    expect(store.get().notice?.detail).toContain("Refresh");
  } finally {
    __storeTesting.replaceState(previous);
  }
});

test("uncertainty returns after a reliable failure replaces its notice and consecutive uncertainty stays throttled", async () => {
  const previous = store.get();
  const clock = Date.now;
  let outcome: Error = new UncertainRequestError(
    "terminal.input",
    "synthetic lost acknowledgement",
  );
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const client: ConnectionClient = {
    connectionId: "synthetic-replaced-notice",
    generation: 91,
    serverRuntimeGeneration: 7,
    isCurrent: () => true,
    acceptsServerGeneration: () => true,
    call: async (method, params) => {
      calls.push({ method, params });
      throw outcome;
    },
  };
  __storeTesting.replaceState({
    ...previous,
    notice: null,
    connections: [
      {
        id: client.connectionId,
        label: "Original synthetic owner",
        source: "fixture",
        is_default: true,
        state: "ready",
        generation: 7,
      },
    ],
  });
  let notices = 0;
  const stop = store.subscribe(() => {
    if (store.get().notice) notices++;
  });
  try {
    // All outcomes occur within the same throttle window, without sleeps.
    Date.now = () => 1000;
    await expect(
      sendTerminalInput(client, new Uint8Array([97]), "same-terminal"),
    ).rejects.toThrow("uncertain");
    expect(store.get().notice?.message).toBe(
      "Terminal input outcome is uncertain",
    );
    outcome = new Error("synthetic definite rejection");
    await expect(
      sendTerminalInput(client, new Uint8Array([98]), "same-terminal"),
    ).rejects.toThrow("definite rejection");
    expect(store.get().notice?.message).toBe("Terminal input was not sent");
    outcome = new UncertainRequestError(
      "terminal.input",
      "synthetic lost acknowledgement",
    );
    await expect(
      sendTerminalInput(client, new Uint8Array([99]), "same-terminal"),
    ).rejects.toThrow("uncertain");
    expect(store.get().notice?.message).toBe(
      "Terminal input outcome is uncertain",
    );
    expect(store.get().notice?.detail).toContain("Original synthetic owner");
    expect(store.get().notice?.detail).toContain("Refresh");
    expect(store.get().notice?.actionPaneId).toBeUndefined();
    expect(notices).toBe(3);
    await expect(
      sendTerminalInput(client, new Uint8Array([100]), "same-terminal"),
    ).rejects.toThrow("uncertain");
    expect(notices).toBe(3);
    expect(calls).toEqual(
      ["a", "b", "c", "d"].map((text) => ({
        method: "terminal.input",
        params: { terminal_id: "same-terminal", data: btoa(text) },
      })),
    );
  } finally {
    stop();
    Date.now = clock;
    __storeTesting.replaceState(previous);
  }
});

test("the first uncertainty is reported even when the clock begins at zero", async () => {
  const previous = store.get();
  const clock = Date.now;
  const client: ConnectionClient = {
    connectionId: "synthetic-zero-clock",
    generation: 41,
    serverRuntimeGeneration: 7,
    isCurrent: () => false,
    acceptsServerGeneration: () => false,
    call: async () => {
      throw new UncertainRequestError(
        "terminal.input",
        "synthetic lost acknowledgement",
      );
    },
  };
  try {
    Date.now = () => 0;
    await expect(
      sendTerminalInput(client, new Uint8Array([97]), "original"),
    ).rejects.toThrow("uncertain");
    expect(store.get().notice?.message).toBe(
      "Terminal input outcome is uncertain",
    );
  } finally {
    Date.now = clock;
    __storeTesting.replaceState(previous);
  }
});

test("lost input acknowledgement reports its original owner after retirement and bounds a burst without replay", async () => {
  const previous = store.get();
  const held = Promise.withResolvers<unknown>();
  let dispatches = 0,
    notices = 0;
  const client: ConnectionClient = {
    connectionId: "synthetic-uncertain-owner",
    generation: 19,
    serverRuntimeGeneration: 7,
    isCurrent: () => false,
    acceptsServerGeneration: () => false,
    call: () => {
      dispatches++;
      return held.promise;
    },
  };
  __storeTesting.replaceState({
    ...previous,
    notice: null,
    connections: [
      {
        id: client.connectionId,
        label: "Original synthetic owner",
        source: "fixture",
        is_default: true,
        state: "ready",
        generation: 7,
      },
    ],
  });
  const stop = store.subscribe(() => {
    if (store.get().notice?.message.includes("uncertain")) notices++;
  });
  try {
    const first = sendTerminalInput(
      client,
      new TextEncoder().encode("a"),
      "synthetic-terminal",
    ).catch((error) => error);
    const second = sendTerminalInput(
      client,
      new TextEncoder().encode("b"),
      "synthetic-terminal",
    ).catch((error) => error);
    __storeTesting.replaceState({
      ...store.get(),
      connections: [
        {
          ...store.get().connections[0]!,
          label: "Replacement synthetic owner",
          generation: 8,
        },
      ],
    });
    held.reject(
      new UncertainRequestError(
        "terminal.input",
        "synthetic lost acknowledgement",
      ),
    );
    expect(await first).toBeInstanceOf(UncertainRequestError);
    expect(await second).toBeInstanceOf(UncertainRequestError);
    expect(store.get().notice?.detail).toContain("Original synthetic owner");
    expect(store.get().notice?.detail).toContain("Refresh");
    expect(store.get().notice?.actionPaneId).toBeUndefined();
    expect(notices).toBe(1);
    expect(dispatches).toBe(2);
  } finally {
    stop();
    __storeTesting.replaceState(previous);
  }
});
