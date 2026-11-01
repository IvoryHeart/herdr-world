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
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data)),
      request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  };
  const command = (method: string, params = {}) =>
    new Promise<any>((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Capture CDP deadline: ${method}`));
      }, 20000);
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
  return { command, close: () => socket.close() };
}
