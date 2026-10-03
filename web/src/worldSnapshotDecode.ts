/** Decode large read-only observations away from terminal/keyboard tasks.
 * Each isolated worker owns one request. Host-sized messages split decoded
 * admission across tasks; the complete semantic result is retained.
 */
const SOURCE = `let admit, awaiting = -1;
self.onmessage = async ({data}) => {
  if (!Array.isArray(data)) {
    if (admit && data?.admitted === awaiting) {
      const release = admit;
      admit = undefined;
      awaiting = -1;
      release();
    }
    return;
  }
  try {
    const began = performance.now();
    const value = JSON.parse(data.join(""));
    if (!value || typeof value !== "object" || !Array.isArray(value.connections) || value.connections.length > 64) throw Error("invalid World snapshot response");
    const connections = value.connections;
    delete value.connections;
    self.postMessage({header: value, total: connections.length, parseMs: performance.now() - began});
    for (let index = 0; index < connections.length; index++) {
      await new Promise(resolve => {
        admit = resolve;
        awaiting = index;
        self.postMessage({index, connection: connections[index]});
      });
    }
    self.postMessage({complete: true});
  } catch { self.postMessage({error: "invalid World snapshot response"}); }
};`;

let activeJobs = 0;
const MAX_JOBS = 2;
const OFF_THREAD_CHARACTERS = 1024 * 1024;

export function decodeWorldSnapshot(
  parts: string[],
  signal: AbortSignal,
): Promise<unknown> {
  if (signal.aborted)
    return Promise.reject(new Error("World snapshot decode retired"));
  const characters = parts.reduce((total, part) => total + part.length, 0);
  if (characters < OFF_THREAD_CHARACTERS) {
    try {
      return Promise.resolve(JSON.parse(parts.join("")));
    } catch {
      return Promise.reject(new Error("invalid World snapshot response"));
    }
  }
  if (activeJobs >= MAX_JOBS)
    return Promise.reject(new Error("World snapshot decode capacity exceeded"));
  activeJobs++;
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined;
    let url: string | undefined;
    let done = false;
    let header: Record<string, unknown> | undefined;
    let total = 0;
    const connections: unknown[] = [];
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      signal.removeEventListener("abort", retire);
      worker?.terminate();
      if (url) URL.revokeObjectURL(url);
      activeJobs--;
      if (error) reject(error);
      else resolve({ ...header, connections });
    };
    const retire = () => finish(new Error("World snapshot decode retired"));
    signal.addEventListener("abort", retire, { once: true });
    try {
      // A local, self-contained worker: no remote bridge or external script.
      url = URL.createObjectURL(
        new Blob([SOURCE], { type: "text/javascript" }),
      );
      worker = new Worker(url);
      worker.onerror = () => finish(new Error("World snapshot decoder failed"));
      worker.onmessage = ({ data }) => {
        if (done || signal.aborted) return;
        if (!data || typeof data !== "object" || Array.isArray(data))
          return finish(new Error("invalid World snapshot response"));
        if (data.error)
          return finish(new Error("invalid World snapshot response"));
        if (data.header) {
          if (
            header ||
            typeof data.header !== "object" ||
            Array.isArray(data.header) ||
            !Number.isInteger(data.total) ||
            data.total < 0 ||
            data.total > 64
          )
            return finish(new Error("invalid World snapshot response"));
          header = data.header;
          performance.mark("world-snapshot-worker-decoded", {
            detail: { parseMs: data.parseMs },
          });
          performance.clearMarks("world-snapshot-worker-decoded");
          total = data.total;
        } else if (data.complete) {
          if (!header || connections.length !== total)
            return finish(new Error("invalid World snapshot response"));
          finish();
        } else if (
          header &&
          data.index === connections.length &&
          connections.length < total &&
          data.connection &&
          typeof data.connection === "object" &&
          !Array.isArray(data.connection)
        ) {
          connections.push(data.connection);
          // Each host arrives in its own message task. Acknowledge after this
          // handler without inserting another scheduled task: the next host
          // still requires a worker round trip and a fresh browser message task.
          queueMicrotask(() => {
            if (!done && !signal.aborted)
              worker?.postMessage({ admitted: data.index });
          });
        } else finish(new Error("invalid World snapshot response"));
      };
      const began = performance.now();
      worker.postMessage(parts);
      performance.mark("world-snapshot-worker-posted", {
        detail: { postMs: performance.now() - began },
      });
      performance.clearMarks("world-snapshot-worker-posted");
    } catch {
      finish(new Error("World snapshot decoder unavailable"));
    }
  });
}
