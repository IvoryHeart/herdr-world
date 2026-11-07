/** The routing fields of a raw RPC line, read before it is handled or logged. */
export function parseRpcMeta(raw: string): {
  id: string | null;
  method: string | null;
  connectionId: unknown;
  connectionGeneration: unknown;
  lane: "interactive" | "background";
} {
  try {
    const msg = JSON.parse(raw);
    return {
      id: typeof msg?.id === "string" ? msg.id : null,
      method: typeof msg?.method === "string" ? msg.method : null,
      lane: msg?.lane === "background" ? "background" : "interactive",
      connectionId: Object.hasOwn(msg ?? {}, "connection_id")
        ? msg.connection_id
        : undefined,
      connectionGeneration: Object.hasOwn(msg ?? {}, "connection_generation")
        ? msg.connection_generation
        : undefined,
    };
  } catch {
    return {
      id: null,
      method: null,
      connectionId: undefined,
      connectionGeneration: undefined,
      lane: "interactive",
    };
  }
}
