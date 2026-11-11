/** A connected byte stream to one core endpoint (socket, forward or test pipe). */
export type CoreByteStream = {
  write(bytes: Uint8Array): void;
  close(): void;
  onData(listener: (bytes: Uint8Array) => void): void;
  onClose(listener: (error?: Error) => void): void;
};

export type CoreStreamConnector = (
  socketPath: string,
  signal?: AbortSignal,
) => Promise<CoreByteStream>;

/**
 * Connects to an existing Unix socket and nothing else: an absent or refused
 * endpoint is an error, never a reason to start a core.
 */
export const connectUnixStream: CoreStreamConnector = async (
  socketPath,
  signal,
) => {
  signal?.throwIfAborted();
  const dataListeners: Array<(bytes: Uint8Array) => void> = [];
  const closeListeners: Array<(error?: Error) => void> = [];
  const early: Uint8Array[] = [];
  let closed: { error?: Error } | null = null;
  let queue: Uint8Array[] = [];
  const finish = (error?: Error) => {
    if (closed) return;
    closed = { error };
    queue = [];
    for (const listener of closeListeners) listener(error);
  };
  const socket = await Bun.connect({
    unix: socketPath,
    socket: {
      data(_socket, data) {
        const bytes = new Uint8Array(data);
        if (dataListeners.length === 0) early.push(bytes);
        for (const listener of dataListeners) listener(bytes);
      },
      drain(socket) {
        while (queue.length > 0) {
          const next = queue[0]!;
          const written = socket.write(next);
          if (written === next.byteLength) queue.shift();
          else {
            queue[0] = next.subarray(Math.max(0, written));
            return;
          }
        }
      },
      close() {
        finish();
      },
      error(_socket, error) {
        finish(error);
      },
      connectError(_socket, error) {
        finish(error);
      },
    },
  });
  const abort = () => socket.end();
  signal?.addEventListener("abort", abort, { once: true });
  return {
    write(bytes) {
      if (closed) return;
      if (queue.length > 0) {
        queue.push(bytes);
        return;
      }
      const written = socket.write(bytes);
      if (written < bytes.byteLength)
        queue.push(bytes.subarray(Math.max(0, written)));
    },
    close() {
      signal?.removeEventListener("abort", abort);
      socket.end();
      finish();
    },
    onData(listener) {
      dataListeners.push(listener);
      for (const bytes of early.splice(0)) listener(bytes);
    },
    onClose(listener) {
      if (closed) listener(closed.error);
      else closeListeners.push(listener);
    },
  };
};

/** Two connected in-memory ends, for fakes and recorded replays. */
export function memoryStreamPair(): [CoreByteStream, CoreByteStream] {
  type End = {
    data: Array<(bytes: Uint8Array) => void>;
    close: Array<(error?: Error) => void>;
    early: Uint8Array[];
    closed: boolean;
  };
  const make = (): End => ({ data: [], close: [], early: [], closed: false });
  const a = make();
  const b = make();
  const deliver = (to: End, bytes: Uint8Array) => {
    if (to.closed) return;
    const copy = bytes.slice();
    queueMicrotask(() => {
      if (to.closed) return;
      if (to.data.length === 0) to.early.push(copy);
      for (const listener of to.data) listener(copy);
    });
  };
  const shut = (end: End) => {
    if (end.closed) return;
    end.closed = true;
    for (const listener of end.close) listener();
  };
  const side = (self: End, peer: End): CoreByteStream => ({
    write: (bytes) => {
      if (!self.closed) deliver(peer, bytes);
    },
    close: () => {
      queueMicrotask(() => {
        shut(self);
        shut(peer);
      });
    },
    onData: (listener) => {
      self.data.push(listener);
      for (const bytes of self.early.splice(0)) listener(bytes);
    },
    onClose: (listener) => {
      if (self.closed) listener();
      else self.close.push(listener);
    },
  });
  return [side(a, b), side(b, a)];
}
