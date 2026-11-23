/** Connect only to a disposable capture browser's dynamic CDP port. */
export async function connectCapture(port: string) {
  const targets = (await (
    await fetch(`http://127.0.0.1:${port}/json/list`)
  ).json()) as { type: string; webSocketDebuggerUrl: string }[];
  const socket = new WebSocket(
    targets.find((target) => target.type === "page")!.webSocketDebuggerUrl,
  );
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error("Capture connection failed"));
  });
  let nextId = 0;
  const pending = new Map<
    number,
    {
      resolve(value: any): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const listeners = new Map<string, Set<(params: any) => void>>();
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data)),
      request = pending.get(message.id);
    if (message.method) {
      for (const listener of listeners.get(message.method) ?? [])
        listener(message.params);
      return;
    }
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  };
  /** Sends a CDP command; `deadlineMs` lengthens it for long measurements. */
  const command = (method: string, params = {}, deadlineMs = 20000) =>
    new Promise<any>((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Capture CDP deadline: ${method}`));
      }, deadlineMs);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  socket.onclose = () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("Capture browser disconnected"));
    }
    pending.clear();
  };
  /** Subscribes to a CDP event; returns the unsubscribe. */
  const on = (method: string, listener: (params: any) => void) => {
    const set = listeners.get(method) ?? new Set();
    set.add(listener);
    listeners.set(method, set);
    return () => set.delete(listener);
  };
  return { command, on, close: () => socket.close() };
}
