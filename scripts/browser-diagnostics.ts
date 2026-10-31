#!/usr/bin/env bun
// Opt-in Chrome adapter for lifecycle comparisons; preserves the caller's arguments.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type DiagnosticChild = {
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  signalCode?: unknown;
  kill: (signal?: NodeJS.Signals) => void;
};
type DiagnosticOptions = {
  executable?: string;
  directory?: string;
  mode?: string;
  args: readonly string[];
};
type DiagnosticDependencies = {
  spawn?: (argv: string[]) => DiagnosticChild;
  writeStderr?: (chunk: Uint8Array) => void;
};

/** The CLI and in-process fixtures share observation, forwarding and drain behavior. */
export async function runBrowserDiagnostics(
  options: DiagnosticOptions,
  dependencies: DiagnosticDependencies = {},
): Promise<number> {
  const { executable, directory, args } = options;
  const mode = options.mode || "lifecycle";
  if (!executable || !directory) {
    throw new Error(
      "Set HERDR_DIAGNOSTIC_CHROME and HERDR_BROWSER_DIAGNOSTICS_DIR",
    );
  }
  if (mode !== "lifecycle" && mode !== "stderr") {
    throw new Error(
      "HERDR_BROWSER_DIAGNOSTICS_MODE must be lifecycle or stderr",
    );
  }
  mkdirSync(directory, { recursive: true });
  const output = join(directory, `browser-${crypto.randomUUID()}.ndjson`);
  const record = (event: string, data: unknown) =>
    appendFileSync(
      output,
      `${JSON.stringify({ at: Date.now(), event, data })}\n`,
    );
  record("launch", { args, mode });
  const spawn =
    dependencies.spawn ??
    ((argv: string[]) =>
      Bun.spawn(argv, { stdin: "inherit", stdout: "inherit", stderr: "pipe" }));
  const writeStderr =
    dependencies.writeStderr ??
    ((chunk: Uint8Array) => process.stderr.write(chunk));
  const child = spawn([
    executable,
    "--enable-logging=stderr",
    ...(mode === "lifecycle" &&
    !args.some((arg) => arg.startsWith("--remote-debugging-port"))
      ? ["--remote-debugging-port=0"]
      : []),
    ...args,
  ]);
  let socket: WebSocket | undefined;
  let sequence = 0;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Map<number, string>();
  const attached = new Set<string>();
  const send = (method: string, params = {}, sessionId?: string) => {
    const id = ++sequence;
    pending.set(id, method);
    socket?.send(JSON.stringify({ id, method, params, sessionId }));
  };
  function observe(endpoint: string) {
    if (socket) return;
    socket = new WebSocket(endpoint);
    socket.onopen = () => {
      record("debugger-connected", {});
      send("Target.setDiscoverTargets", { discover: true });
      send("Target.getTargets");
    };
    const attach = (target: {
      targetId: string;
      type: string;
      url: string;
    }) => {
      if (target.type !== "page" || attached.has(target.targetId)) return;
      attached.add(target.targetId);
      record("page-target", target);
      send("Target.attachToTarget", {
        targetId: target.targetId,
        flatten: true,
      });
    };
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(String(data));
      const method = message.id ? pending.get(message.id) : message.method;
      if (message.id) pending.delete(message.id);
      if (message.error)
        record("debugger-error", { method, error: message.error });
      if (method === "Target.getTargets") {
        for (const target of message.result?.targetInfos ?? []) attach(target);
      }
      if (method === "Target.targetCreated") attach(message.params.targetInfo);
      if (method === "Target.attachedToTarget") {
        const session = message.params.sessionId;
        record("page-attached", message.params.targetInfo);
        send("Runtime.enable", {}, session);
        send("Page.enable", {}, session);
        send("Network.enable", {}, session);
        send("Page.setLifecycleEventsEnabled", { enabled: true }, session);
        send(
          "Runtime.evaluate",
          {
            expression:
              "JSON.stringify({readyState:document.readyState,visibility:document.visibilityState,url:location.href})",
            returnByValue: true,
          },
          session,
        );
      }
      if (method === "Runtime.evaluate")
        record("document-state", message.result);
      if (method === "Runtime.exceptionThrown")
        record("page-exception", message.params);
      if (method === "Runtime.consoleAPICalled") {
        record("page-console", {
          type: message.params.type,
          args: message.params.args.map(
            (arg: { value?: unknown; description?: string }) =>
              String(arg.value ?? arg.description ?? "").slice(0, 2000),
          ),
        });
      }
      if (method === "Network.requestWillBeSent") {
        const { request, type } = message.params;
        record("request", {
          url: request.url,
          method: request.method,
          type,
          ...(new URL(request.url).pathname === "/result"
            ? { result: request.postData }
            : {}),
        });
      }
      if (method === "Network.responseReceived") {
        const { response, type } = message.params;
        record("response", {
          url: response.url,
          status: response.status,
          mimeType: response.mimeType,
          type,
        });
      }
      if (
        [
          "Page.lifecycleEvent",
          "Network.loadingFailed",
          "Target.targetCrashed",
          "Inspector.detached",
        ].includes(method)
      ) {
        record(method, message.params);
      }
    };
    socket.onerror = () => record("debugger-connection-error", {});
    socket.onclose = () => record("debugger-closed", {});
  }
  const handlers = new Map<NodeJS.Signals, () => void>();
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    const handler = () => {
      record("signal", { signal });
      child.kill(signal);
      stopTimer ??= setTimeout(() => {
        record("forced-stop", {});
        child.kill("SIGKILL");
      }, 1000);
      stopTimer.unref();
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  try {
    const stderrReader = child.stderr.getReader();
    const readStderr = (async () => {
      const decoder = new TextDecoder();
      let remainder = "";
      while (true) {
        const { value: chunk, done } = await stderrReader.read();
        if (done) break;
        writeStderr(chunk);
        remainder += decoder.decode(chunk, { stream: true });
        const lines = remainder.split("\n");
        remainder = lines.pop() ?? "";
        for (const line of lines) {
          record("chrome-stderr", line);
          const endpoint = line.match(
            /DevTools listening on (ws:\/\/\S+)/,
          )?.[1];
          if (endpoint && mode === "lifecycle") observe(endpoint);
        }
      }
      remainder += decoder.decode();
      if (remainder) record("chrome-stderr", remainder);
    })();
    const code = await child.exited;
    clearTimeout(stopTimer);
    socket?.close();
    let drainTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      readStderr,
      new Promise<void>((resolve) => {
        drainTimer = setTimeout(() => {
          record("stderr-drain-timeout", {});
          void stderrReader
            .cancel()
            .catch((error) => record("stderr-cancel-error", String(error)));
          resolve();
        }, 1000);
      }),
    ]);
    clearTimeout(drainTimer);
    record("exit", { code, signal: child.signalCode });
    return code;
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
}

if (import.meta.main)
  process.exit(
    await runBrowserDiagnostics({
      executable: Bun.env.HERDR_DIAGNOSTIC_CHROME,
      directory: Bun.env.HERDR_BROWSER_DIAGNOSTICS_DIR,
      mode: Bun.env.HERDR_BROWSER_DIAGNOSTICS_MODE,
      args: process.argv.slice(2),
    }),
  );
