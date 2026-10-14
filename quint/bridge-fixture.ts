import assert from "node:assert/strict";
import { Bridge } from "../web/src/api";

export class SyntheticSocket {
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;
  static readonly CLOSED = 3;
  static instances: SyntheticSocket[] = [];
  readyState = SyntheticSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: Record<string, any>[] = [];
  onSend: ((message: Record<string, any>) => void) | null = null;
  constructor() {
    SyntheticSocket.instances.push(this);
  }
  send(raw: string) {
    const message = JSON.parse(raw);
    this.sent.push(message);
    this.onSend?.(message);
  }
  receive(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  close() {
    this.readyState = SyntheticSocket.CLOSED;
    this.onclose?.();
  }
}

/** Isolated replay owns these globals and restores them after draining Bridge. */
export function syntheticBridge(
  decode?: (parts: string[], signal: AbortSignal) => Promise<unknown>,
  BridgeClass = Bridge,
  admission = false,
  existing?: Bridge,
) {
  const webSocket = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
  const location = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    writable: true,
    value: SyntheticSocket,
  });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { protocol: "https:", host: "synthetic.example" },
  });
  const bridge = existing ?? new BridgeClass(2000, 2000, decode);
  const sockets: SyntheticSocket[] = [];
  const ids = ["synthetic-a", "synthetic-b"];
  const connect = (live = [true, true]) => {
    if (bridge.status !== "connected") {
      bridge.connect();
      const socket = SyntheticSocket.instances.at(-1)!;
      sockets.push(socket);
      socket.receive({
        hello: true,
        bridge_protocol_version: 2,
        default_connection_id: ids[0],
        capabilities: {
          connection_id: true,
          connection_scoped_http: true,
          connection_runtime_generation: true,
          world_snapshot_chunks: true,
          world_snapshot_chunk_admission: admission,
        },
      });
      assert.equal(
        bridge.status,
        "connected",
        "Synthetic bridge hello was rejected",
      );
    }
    bridge.setConnectionRuntimeGenerations(
      ids.map((id, h) => ({ id, generation: live[h] ? 1 : 3, state: "ready" })),
    );
    return sockets.at(-1)!;
  };
  try {
    connect();
  } catch (error) {
    restore();
    throw error;
  }
  function restore() {
    try {
      bridge.disconnect("Synthetic replay complete");
    } finally {
      if (webSocket) Object.defineProperty(globalThis, "WebSocket", webSocket);
      else Reflect.deleteProperty(globalThis, "WebSocket");
      if (location) Object.defineProperty(globalThis, "location", location);
      else Reflect.deleteProperty(globalThis, "location");
      SyntheticSocket.instances = [];
    }
  }
  return { bridge, sockets, connect, restore };
}
