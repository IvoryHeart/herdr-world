import * as net from "node:net";
import { join } from "node:path";
import { resolveDataPaths } from "../../config/data-paths";
import type { ServerConfig } from "../../config/server-config";
import { readWorldCliToken } from "../../config/session-secret";
import { herdrAdapter, systemClock, systemScheduler } from "../ports";
import { openStorage } from "../storage";
import { createWorldService, type WorldServiceDeps } from "../world-service";

/** Loopback on any free port, password login, and no Herdr behind the sockets. */
export function testServerConfig(
  root: string,
  overrides: Partial<ServerConfig> = {},
): ServerConfig {
  return {
    appVersion: "0.0.0-test",
    host: "127.0.0.1",
    port: 0,
    password: "world-service-test-password",
    authRequired: true,
    socketPath: join(root, "missing-control.sock"),
    clientSocketPath: join(root, "missing-render.sock"),
    publicDir: join(root, "public"),
    openBrowserRequested: false,
    logLevel: "error",
    taskNotificationSource: "herdr",
    hasExplicitSocketPath: true,
    hasExplicitClientSocketPath: true,
    ...overrides,
  };
}

/**
 * One started World service in this process, its data folder at `root`.
 * `environment` holds per-file overrides, resolved as the entry point does.
 */
export async function startTestService(
  root: string,
  overrides: Partial<ServerConfig> = {},
  environment: Record<string, string> = {},
  deps: Partial<
    Pick<WorldServiceDeps, "storage" | "adapters" | "clock" | "scheduler">
  > = {},
) {
  const service = await createWorldService({
    config: testServerConfig(root, overrides),
    paths: resolveDataPaths({ ...environment, HERDR_WORLD_DATA_DIR: root }),
    clock: systemClock,
    scheduler: systemScheduler,
    storage: openStorage,
    adapters: { herdr: herdrAdapter },
    scheduleProcessExit: () => {
      throw new Error("a test service never installs an update");
    },
    ...deps,
  });
  const { port, connected } = service.start();
  return { service, base: `http://127.0.0.1:${port}`, connected };
}

export type TestService = Awaited<ReturnType<typeof startTestService>>;

export async function login(base: string, password: string): Promise<string> {
  const response = await fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  if (response.status !== 200)
    throw new Error(`login failed with ${response.status}`);
  return response.headers.get("set-cookie")!.split(";", 1)[0]!;
}

/** A logged-in browser socket that sends RPCs and resolves their replies. */
export async function browserSocket(base: string, cookie: string) {
  // Bun accepts handshake headers; lib.dom's constructor does not.
  const Socket = WebSocket as unknown as new (
    url: string,
    options: Bun.WebSocketOptions,
  ) => WebSocket;
  const ws = new Socket(`${base.replace("http:", "ws:")}/ws`, {
    headers: { cookie },
  });
  const replies = new Map<string, (message: any) => void>();
  await new Promise<void>((resolve, reject) => {
    ws.onerror = () => reject(new Error("WebSocket failed"));
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.hello) resolve();
      if (typeof message.id === "string") replies.get(message.id)?.(message);
    };
  });
  let sequence = 0;
  return {
    call(method: string, params?: unknown): Promise<any> {
      const id = `rpc-${++sequence}`;
      return new Promise((resolve, reject) => {
        replies.set(id, (message) => {
          replies.delete(id);
          if (message.error) reject(new Error(message.error.message));
          else resolve(message.result);
        });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () => ws.close(),
  };
}

/** Ask one question through the agent CLI, as a local command-line client. */
export async function askThroughCli(
  started: TestService,
  question: string,
): Promise<Response> {
  return fetch(`${started.base}/api/world/cli`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${readWorldCliToken(started.service.paths.sessionSecret)}`,
    },
    body: JSON.stringify({ command: "ask", params: { question } }),
  });
}

/**
 * A Herdr control socket that answers startup requests and holds every
 * `held` call open until its caller closes it.
 */
export async function holdingHerdr(path: string, held: string) {
  const arrived = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let input = "";
    socket.on("data", (chunk) => {
      input += chunk.toString();
      const newline = input.indexOf("\n");
      if (newline < 0) return;
      const request = JSON.parse(input.slice(0, newline)) as {
        id: string;
        method: string;
      };
      input = input.slice(newline + 1);
      if (request.method === held) {
        socket.on("close", () => released.resolve());
        arrived.resolve();
        return;
      }
      const result =
        request.method === "ping"
          ? { version: "0.0.0-test", protocol: 14 }
          : {};
      socket.write(`${JSON.stringify({ id: request.id, result })}\n`);
      if (request.method !== "events.subscribe") socket.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  return {
    /** A held call reached this Herdr. */
    arrived: arrived.promise,
    /** Its caller closed the held call's socket. */
    released: released.promise,
    close() {
      for (const socket of sockets) socket.destroy();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
