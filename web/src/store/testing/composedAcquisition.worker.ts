import { bridge } from "../../api";
import { set, store, captureConnectionLease } from "../../store";
import { stampPendingFocusWorkspace, refreshAfterCurrent } from "../refresh";
import { ManualClock, SimulatedDocument } from "./simulatedWorld";

// Native I/O stays real. The manual clock owns only browser scheduling.
const clock = new ManualClock(),
  page = new SimulatedDocument();
const requests: Record<string, any>[] = [],
  controls: Record<string, any>[] = [];
const notices: unknown[] = [];
const holds = new Map<string, () => void>();
const controlWaiters = new Set<{
  match: Record<string, unknown>;
  resolve(value: unknown): void;
}>();
const match = (
  value: Record<string, unknown>,
  expected: Record<string, unknown>,
) => Object.entries(expected).every(([key, field]) => value[key] === field);
bridge.onControl((control) => {
  const value = control as unknown as Record<string, any>;
  controls.push(value);
  for (const waiter of controlWaiters)
    if (match(value, waiter.match)) {
      controlWaiters.delete(waiter);
      waiter.resolve(value);
    }
});
const snapshot = () =>
  JSON.parse(
    JSON.stringify({
      state: store.get(),
      alpha: store.getConnection("alpha"),
      beta: store.getConnection("beta"),
      requests,
      controls,
      notices,
      completions: {
        alpha: notices.filter(
          (notice: any) => notice.actionPaneId === "p-alpha-task",
        ).length,
        beta: notices.filter(
          (notice: any) => notice.actionPaneId === "p-beta-task",
        ).length,
      },
    }),
  );
function valueAt(path: (string | number)[]) {
  return path.reduce((value, key) => value?.[key], snapshot());
}
function when(path: (string | number)[], expected: unknown): Promise<void> {
  if (JSON.stringify(valueAt(path)) === JSON.stringify(expected))
    return Promise.resolve();
  return new Promise<void>((resolve) => {
    const stop = store.subscribe(() => {
      if (JSON.stringify(valueAt(path)) === JSON.stringify(expected)) {
        stop();
        resolve();
      }
    });
  });
}
async function command(method: string, params: any): Promise<unknown> {
  if (method === "boot") {
    const base = new URL(params.base),
      NativeSocket = globalThis.WebSocket,
      nativeFetch = globalThis.fetch;
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: { protocol: base.protocol, host: base.host, origin: base.origin },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: page,
    });
    globalThis.WebSocket = class extends NativeSocket {
      override send(data: Parameters<WebSocket["send"]>[0]) {
        if (typeof data === "string") requests.push(JSON.parse(data));
        super.send(data);
      }
    };
    globalThis.fetch = ((input, init) => {
      const url = new URL(String(input), base);
      // Update discovery is outside this contract and must not contact a registry.
      if (url.pathname === "/api/update/check")
        return Promise.resolve(Response.json({ update_available: false }));
      return nativeFetch(url, init);
    }) as typeof fetch;
    clock.install();
    store.init();
    await when(["state", "catalogueReady"], true);
    await when(["alpha", "panes", 1, "pane_id"], "p-alpha-a");
    await store.loadConnectionSession("beta");
    const owner = store.get().connections.find((owner) => owner.id === "beta")!;
    holds.set(
      "Inspector",
      store.holdFocusedOwner({
        connection_id: owner.id,
        connection_generation: owner.generation,
      }),
    );
    await clock.flushTimeouts();
    await store.loadConnectionSession("beta");
    await bridge.call("bridge.ping");
    set({
      taskNotificationsEnabled: true,
      taskNotificationPreferences: { completed: true, blocked: true },
    });
    store.subscribe(() => {
      const notice = store.get().notice;
      if (notice && notices[notices.length - 1] !== notice)
        notices.push(notice);
    });
    return snapshot();
  }
  if (method === "snapshot") return snapshot();
  if (method === "wait") {
    await when(params.path, params.value);
    return snapshot();
  }
  if (method === "waitControl")
    return new Promise((resolve) =>
      controlWaiters.add({ match: params, resolve }),
    );
  if (method === "fence") {
    await bridge.call("bridge.ping");
    return snapshot();
  }
  if (method === "flush") {
    await bridge.call("bridge.ping");
    await clock.flushTimeouts();
    return snapshot();
  }
  if (method === "advance") {
    // A native WebSocket heartbeat must settle before advancing past its timeout.
    // These round trips are ordering barriers, not observation polls.
    for (let remaining = params.ms; remaining > 0; ) {
      const step = Math.min(1000, remaining);
      await clock.advance(step);
      await bridge.call("bridge.ping");
      remaining -= step;
    }
    return snapshot();
  }
  if (method === "refresh") {
    await refreshAfterCurrent(captureConnectionLease(params.id));
    return snapshot();
  }
  if (method === "visible") {
    page.setVisibility(params.visible ? "visible" : "hidden");
    await bridge.call("bridge.ping");
    await clock.flushTimeouts();
    return snapshot();
  }
  if (method === "call") return bridge.call(params.method, params.params ?? {});
  if (method === "navigation") {
    set({ selectedPaneId: params.pane });
    stampPendingFocusWorkspace(params.workspace);
    return snapshot();
  }
  if (method === "attachment") {
    const client = captureConnectionLease("alpha").client;
    const attempt = store.beginTerminalAttachment(client, params.terminal);
    store.completeTerminalAttachment(
      client,
      params.terminal,
      attempt,
      params.advertisement,
    );
    return snapshot();
  }
  if (method === "close") {
    for (const release of holds.values()) release();
    holds.clear();
    bridge.disconnect("composed parity complete");
    clock.uninstall();
    return null;
  }
  throw new Error(`Unknown composed browser command: ${method}`);
}
self.onmessage = (
  event: MessageEvent<{ id: number; method: string; params: unknown }>,
) => {
  const { id, method, params } = event.data;
  void command(method, params).then(
    (result) => self.postMessage({ id, result }),
    (error) => self.postMessage({ id, error: String(error?.stack ?? error) }),
  );
};
