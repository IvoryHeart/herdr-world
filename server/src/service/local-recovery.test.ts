import { expect, test } from "bun:test";
import { strict as assert } from "node:assert";
import * as net from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BinReader, BinWriter, encodeFrame } from "../bridge/bincode";
import { startTestService, login } from "./testing/services";
async function deadline<T>(promise: Promise<T>, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} deadline`)), 10000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function nativeFixture(root: string) {
  const servers: net.Server[] = [];
  const sockets = new Set<net.Socket>();
  const calls: string[] = [];
  const handshakes: Array<{
    kind: string;
    generation?: number;
    protocol?: number;
  }> = [];
  const subscribed = Promise.withResolvers<void>(),
    endpoint = Promise.withResolvers<void>();
  let subscriptionSocket: net.Socket;
  const key = crypto.randomUUID();
  const paths =
    process.platform === "win32"
      ? {
          socketPath: `\\\\.\\pipe\\local-recovery-${key}`,
          clientSocketPath: `\\\\.\\pipe\\local-recovery-client-${key}`,
        }
      : {
          socketPath: join(root, "control.sock"),
          clientSocketPath: join(root, "render.sock"),
        };
  const track = (s: net.Socket) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
    s.on("error", () => {});
  };
  const listen = (server: net.Server, path: string) =>
    new Promise<void>((resolve, reject) => {
      servers.push(server);
      server.once("error", reject);
      server.listen(path, resolve);
    });
  return {
    paths,
    calls,
    handshakes,
    async fence() {
      await deadline(
        Promise.all([subscribed.promise, endpoint.promise]),
        "native subscription and endpoint",
      );
      subscriptionSocket.write(
        JSON.stringify({
          event: "workspace.updated",
          data: { workspace_id: "synthetic-workspace" },
        }) + "\n",
      );
    },
    async start() {
      await listen(
        net.createServer((socket) => {
          track(socket);
          let input = "";
          socket.on("data", (chunk) => {
            input += chunk.toString();
            let n;
            while ((n = input.indexOf("\n")) >= 0) {
              const request = JSON.parse(input.slice(0, n));
              input = input.slice(n + 1);
              calls.push(request.method);
              const result =
                request.method === "ping"
                  ? { version: "0.9.5", protocol: 22 }
                  : request.method === "workspace.list"
                    ? {
                        workspaces: [
                          {
                            workspace_id: "synthetic-workspace",
                            name: "Synthetic workspace",
                          },
                        ],
                      }
                    : request.method === "tab.list"
                      ? { tabs: [] }
                      : request.method === "pane.list"
                        ? { panes: [] }
                        : request.method === "agent.list"
                          ? { agents: [] }
                          : {};
              socket.write(JSON.stringify({ id: request.id, result }) + "\n");
              if (request.method !== "events.subscribe") socket.end();
              else {
                subscriptionSocket = socket;
                subscribed.resolve();
              }
            }
          });
        }),
        paths.socketPath,
      );
      await listen(
        net.createServer((socket) => {
          track(socket);
          let input = Buffer.alloc(0),
            welcomed = false;
          socket.on("data", (chunk) => {
            if (welcomed) return;
            input = Buffer.concat([input, Buffer.from(chunk)]);
            if (input.length < 4) return;
            const length = input.readUInt32LE(0);
            if (input.length < length + 4) return;
            const reader = new BinReader(input.subarray(4, length + 4));
            const variant = reader.variant();
            welcomed = true;
            if (variant === 20) {
              assert.equal(reader.string(), "endpoint.hello.v1");
              const hello = JSON.parse(reader.string());
              assert.equal(hello.generation, 1);
              handshakes.push({ kind: "endpoint", generation: 1 });
              endpoint.resolve();
              for (const [kind, data] of [
                [
                  "endpoint.welcome.v1",
                  {
                    generation: 1,
                    server_version: "0.9.5",
                    snapshot_codec: "shell.snapshot.v1",
                    surface_codec: "shell.surface.v1",
                    input_codec: "shell.input.semantic.v1",
                    blob_codec: "shell.blob.v1",
                    methods: [],
                    capabilities: [],
                  },
                ],
                [
                  "shell.snapshot.v1",
                  { boot_id: "synthetic-boot", revision: 1 },
                ],
              ]) {
                const writer = new BinWriter();
                writer.variant(20);
                writer.string(kind as string);
                writer.string(JSON.stringify(data));
                socket.write(encodeFrame(writer.toBuffer()));
              }
            } else {
              assert.equal(variant, 0);
              const protocol = reader.varint();
              assert.equal(protocol, 22);
              handshakes.push({ kind: "thin", protocol });
              const writer = new BinWriter();
              writer.variant(0);
              writer.varint(22);
              writer.varint(1);
              writer.option(undefined, (v: any) => writer.string(v));
              socket.write(encodeFrame(writer.toBuffer()));
            }
          });
        }),
        paths.clientSocketPath,
      );
    },
    async stop() {
      for (const s of sockets) s.destroy();
      await Promise.all(
        servers.map(
          (s) => new Promise<void>((resolve) => s.close(() => resolve())),
        ),
      );
    },
  };
}

// Real composition root, adapter, sockets, browser RPC and World snapshot.
// Only the native runtime is synthetic; no default runtime is contacted.
test("late local sockets automatically recover through production admission", async () => {
  const root = mkdtempSync(join(tmpdir(), "local-recovery-"));
  const native = nativeFixture(root);
  let started: Awaited<ReturnType<typeof startTestService>> | undefined;
  let ws: WebSocket | undefined;
  try {
    started = await startTestService(join(root, "data"), native.paths);
    await started.connected;
    const cookie = await login(started.base, "world-service-test-password");
    const Socket = WebSocket as unknown as new (
      url: string,
      options: Bun.WebSocketOptions,
    ) => WebSocket;
    ws = new Socket(started.base.replace("http:", "ws:") + "/ws", {
      headers: { cookie },
    });
    const hello = Promise.withResolvers<void>();
    const ready = Promise.withResolvers<void>();
    let invalidated = Promise.withResolvers<void>();
    const replies = new Map<string, (message: any) => void>();
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.hello) hello.resolve();
      if (message.id) replies.get(message.id)?.(message);
      if (message.control?.type === "world_invalidated") {
        invalidated.resolve();
        if (message.control.connection_state === "ready") ready.resolve();
      }
    };
    await deadline(hello.promise, "browser hello");
    let sequence = 0;
    const rpc = async (method: string, scope: Record<string, unknown> = {}) => {
      const id = `recovery-${++sequence}`;
      const reply = Promise.withResolvers<any>();
      replies.set(id, reply.resolve);
      ws!.send(JSON.stringify({ id, method, params: {}, ...scope }));
      try {
        return await deadline(reply.promise, method);
      } finally {
        replies.delete(id);
      }
    };
    const initial = await rpc("connections.list");
    const failed = initial.result.connections.find(
      (entry: any) => entry.id === "startup-default",
    );
    expect(failed.state).toBe("reconnecting");
    const before = await rpc("world.snapshot");
    const unavailable = before.result.connections[0];
    expect(unavailable.actionable).toBeFalse();
    expect(unavailable.snapshot).toBeNull();
    const denied = await rpc("workspace.list", {
      connection_id: failed.id,
      connection_generation: failed.generation,
    });
    expect(denied.error).toBeDefined();
    expect(native.calls).toHaveLength(0);
    expect((await fetch(started.base + "/healthz")).status).toBe(200);
    await native.start();
    await deadline(ready.promise, "automatic local readiness");
    invalidated = Promise.withResolvers<void>();
    await native.fence();
    await deadline(invalidated.promise, "fresh native event");
    const after = await rpc("world.snapshot");
    const recovered = after.result.connections[0];
    expect(recovered.state).toBe("ready");
    expect(recovered.generation).toBeGreaterThan(failed.generation);
    expect(recovered.actionable).toBeTrue();
    expect(recovered.stale).toBeFalse();
    expect(recovered.snapshot.workspaces[0].workspace_id).toBe(
      "synthetic-workspace",
    );
    const admitted = await rpc("workspace.list", {
      connection_id: failed.id,
      connection_generation: recovered.generation,
    });
    expect(admitted.error).toBeUndefined();
    expect(admitted.result.workspaces[0].workspace_id).toBe(
      "synthetic-workspace",
    );
    const retired = await rpc("workspace.list", {
      connection_id: failed.id,
      connection_generation: failed.generation,
    });
    expect(retired.error).toBeDefined();
    expect(native.handshakes).toContainEqual({ kind: "thin", protocol: 22 });
    expect(native.handshakes).toContainEqual({
      kind: "endpoint",
      generation: 1,
    });
  } finally {
    ws?.close();
    await started?.service.stop();
    await native.stop();
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);
