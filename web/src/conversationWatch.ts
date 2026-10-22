import { bridge, type ConnectionClient } from "./api";

/**
 * Watches one pane's conversation for every view that shows it (Chat, the
 * Town peek). The service keeps one watch per socket and pane, so this counts
 * the views: the first asks the service to watch, the last asks it to stop.
 * Each view's `onChange` runs when the service pushes
 * `agent_conversation_changed` for its exact connection and pane, and again
 * after a reconnect, when the watch is renewed.
 */
type Watch = {
  client: ConnectionClient;
  paneId: string;
  listeners: Set<() => void>;
};

const watches = new Map<string, Watch>();
let stopControl: (() => void) | null = null;
let stopStatus: (() => void) | null = null;

const keyOf = (client: ConnectionClient, paneId: string) =>
  JSON.stringify([client.connectionId, client.serverRuntimeGeneration, paneId]);

function request(watch: Watch, method: "watch" | "unwatch") {
  if (!watch.client.isCurrent()) return;
  watch.client
    .call(`agent_conversation.${method}`, { pane_id: watch.paneId })
    .catch(() => {});
}

function listen() {
  if (stopControl) return;
  stopControl = bridge.onControl((control) => {
    if (control.type !== "agent_conversation_changed") return;
    for (const watch of watches.values())
      if (
        control.connection_id === watch.client.connectionId &&
        control.pane_id === watch.paneId &&
        (control.connection_generation === undefined ||
          watch.client.serverRuntimeGeneration === null ||
          control.connection_generation ===
            watch.client.serverRuntimeGeneration)
      )
        for (const listener of [...watch.listeners]) listener();
  });
  // onStatus reports the current status at once; only a later reconnect
  // needs the watches renewed.
  let initial = true;
  stopStatus = bridge.onStatus((status) => {
    if (initial || status !== "connected") return;
    for (const watch of watches.values()) {
      request(watch, "watch");
      for (const listener of [...watch.listeners]) listener();
    }
  });
  initial = false;
}

export function watchConversation(
  client: ConnectionClient,
  paneId: string,
  onChange: () => void,
): () => void {
  const key = keyOf(client, paneId);
  let watch = watches.get(key);
  if (!watch) {
    watch = { client, paneId, listeners: new Set() };
    watches.set(key, watch);
    listen();
    request(watch, "watch");
  }
  watch.listeners.add(onChange);
  const owned = watch;
  return () => {
    if (!owned.listeners.delete(onChange) || owned.listeners.size) return;
    watches.delete(key);
    request(owned, "unwatch");
    if (!watches.size) {
      stopControl?.();
      stopStatus?.();
      stopControl = stopStatus = null;
    }
  };
}
