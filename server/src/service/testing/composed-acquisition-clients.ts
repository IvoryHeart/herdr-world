/** Native socket/Worker completion signals; timeouts guard hangs, never assert latency. */
function guard<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(new Error(`Composed acquisition never completed: ${label}`)),
        10000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}
export class StoreBrowser {
  private readonly worker = new Worker(
    new URL(
      "../../../../web/src/store/testing/composedAcquisition.worker.ts",
      import.meta.url,
    ).href,
  );
  private sequence = 0;
  private readonly requests = new Map<
    number,
    { resolve(value: any): void; reject(error: Error): void }
  >();
  constructor() {
    this.worker.onmessage = (event) => {
      const { id, result, error } = event.data;
      const request = this.requests.get(id);
      if (!request) return;
      this.requests.delete(id);
      if (error) request.reject(new Error(error));
      else request.resolve(result);
    };
    this.worker.onerror = (error) => {
      for (const request of this.requests.values())
        request.reject(new Error(error.message));
      this.requests.clear();
    };
  }
  command(method: string, params: unknown = {}): Promise<any> {
    const id = ++this.sequence;
    const result = new Promise((resolve, reject) =>
      this.requests.set(id, { resolve, reject }),
    );
    this.worker.postMessage({ id, method, params });
    return guard(result, `browser ${method} ${JSON.stringify(params)}`);
  }
  async close() {
    try {
      await this.command("close");
    } finally {
      this.worker.terminate();
    }
  }
}
export class SocketBrowser {
  readonly controls: Record<string, any>[] = [];
  readonly hello: Promise<any>;
  private readonly ws: WebSocket;
  private readonly closed = Promise.withResolvers<void>();
  private sequence = 0;
  private readonly replies = new Map<
    string,
    { resolve(value: any): void; reject(error: Error): void }
  >();
  private readonly waiters = new Set<{
    match(value: Record<string, any>): boolean;
    resolve(value: any): void;
  }>();
  constructor(base: string) {
    const hello = Promise.withResolvers<any>();
    this.hello = guard(hello.promise, "second browser hello");
    this.ws = new WebSocket(`${base.replace("http:", "ws:")}/ws`);
    this.ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.hello) hello.resolve(message);
      if (message.control) {
        this.controls.push(message.control);
        for (const waiter of this.waiters)
          if (waiter.match(message.control)) {
            this.waiters.delete(waiter);
            waiter.resolve(message.control);
          }
      }
      const pending = this.replies.get(message.id);
      if (pending) {
        this.replies.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      }
    };
    this.ws.onerror = () =>
      hello.reject(new Error("Second real socket failed"));
    this.ws.onclose = () => this.closed.resolve();
  }
  call(
    method: string,
    params: unknown = {},
    owner?: { connection_id: string; connection_generation: number },
    marked = false,
  ): Promise<any> {
    const id = `second-${++this.sequence}`;
    const result = new Promise((resolve, reject) =>
      this.replies.set(id, { resolve, reject }),
    );
    this.ws.send(
      JSON.stringify({
        id,
        method,
        params,
        ...owner,
        ...(marked ? { focused_observation: true } : {}),
      }),
    );
    return guard(result, `second browser ${method}`);
  }
  next(match: (frame: Record<string, any>) => boolean) {
    return guard(
      new Promise<any>((resolve) => this.waiters.add({ match, resolve })),
      "second browser control",
    );
  }
  async relist(owner: {
    connection_id: string;
    connection_generation: number;
  }) {
    await Promise.all(
      ["workspace.list", "tab.list", "pane.list", "agent.list"].map((method) =>
        this.call(method, {}, owner, true),
      ),
    );
  }
  fence() {
    return this.call("bridge.ping");
  }
  async close() {
    this.ws.close();
    await guard(this.closed.promise, "second browser close");
  }
}
