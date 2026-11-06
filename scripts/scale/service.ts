import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { deadline } from "./support";
import type { WorldSnapshotResult } from "../../server/src/world/snapshot";
import type { syntheticSources } from "./source";

export async function startService(
  source: Awaited<ReturnType<typeof syntheticSources>>,
  scratch: string,
  log: string,
) {
  const data = join(scratch, "data");
  mkdirSync(data, { recursive: true, mode: 0o700 });
  if (source.profiles.length > 1)
    writeFileSync(
      join(data, "connections.json"),
      JSON.stringify({
        version: 2,
        default_connection_id: source.profiles[1]!.id,
        profiles: source.profiles.slice(1),
      }),
      { mode: 0o600 },
    );
  const first = source.profiles[0]!;
  const listener = Promise.withResolvers<string>(),
    connectionsReady = Promise.withResolvers<number>();
  const subscriptionsReady = Promise.withResolvers<void>();
  let output = "",
    readyCount = 0,
    subscriptionCount = 0;
  const began = performance.now();
  const child = Bun.spawn(
    [
      resolve("server/herdr-world"),
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--password",
      "synthetic-scale-password",
      "--socket-path",
      first.control_socket_path,
      "--client-socket-path",
      first.client_socket_path,
      "--session",
      "scale-synthetic-only",
      "--notification-source",
      "status",
    ],
    {
      cwd: scratch,
      env: {
        PATH: process.env.PATH,
        LANG: "C.UTF-8",
        HOME: scratch,
        XDG_CONFIG_HOME: join(scratch, ".config"),
        HERDR_WORLD_DATA_DIR: data,
        HERDR_CONFIG_PATH: join(scratch, "herdr.toml"),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const collect = async (stream: ReadableStream<Uint8Array>) => {
    let line = "";
    for await (const chunk of stream) {
      const text = new TextDecoder().decode(chunk);
      output += text;
      line += text;
      writeFileSync(log, output);
      let newline: number;
      while ((newline = line.indexOf("\n")) >= 0) {
        const current = line.slice(0, newline);
        line = line.slice(newline + 1);
        if (current.includes("invalid connection registry"))
          connectionsReady.reject(
            new Error(
              "Private synthetic connection registry refused; see service log",
            ),
          );
        if (
          current.includes(" INFO bridge connection ready ") &&
          ++readyCount === source.profiles.length
        )
          connectionsReady.resolve(performance.now() - began);
        if (
          current.includes("subscribed to Herdr events") &&
          ++subscriptionCount === source.profiles.length
        )
          subscriptionsReady.resolve();
        const match = current.match(
          /http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/,
        );
        if (match) {
          if ([8787, 8788].includes(Number(match[1])))
            listener.reject(new Error("Reserved owner port allocated"));
          else listener.resolve(`http://127.0.0.1:${match[1]}`);
        }
      }
    }
  };
  const collected = Promise.all([collect(child.stdout), collect(child.stderr)]);
  let ws: WebSocket | undefined;
  const stop = async () => {
    ws?.close();
    child.kill("SIGTERM");
    try {
      await deadline(child.exited, "service shutdown", 10_000);
    } catch {
      child.kill("SIGKILL");
      await child.exited;
    }
    await collected;
    writeFileSync(log, output);
  };
  try {
    const base = await deadline(
      Promise.race([
        listener.promise,
        child.exited.then((code) => {
          throw new Error(
            `Synthetic service exited ${code}: ${output.slice(-2000)}`,
          );
        }),
      ]),
      "service listener",
    );
    const listenerMs = performance.now() - began;
    const connectionReadyMs = await deadline(
      connectionsReady.promise,
      "all synthetic connections ready",
    );
    await deadline(
      subscriptionsReady.promise,
      "all synthetic event subscriptions ready",
    );
    const login = await fetch(`${base}/api/login`, {
      method: "POST",
      body: JSON.stringify({ password: "synthetic-scale-password" }),
    });
    if (!login.ok) throw new Error(`Private login failed ${login.status}`);
    const cookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
    const BunSocket = WebSocket as typeof WebSocket &
      (new (
        url: string,
        options: { headers: { cookie: string } },
      ) => WebSocket);
    ws = new BunSocket(base.replace("http:", "ws:") + "/ws", {
      headers: { cookie },
    });
    const hello = Promise.withResolvers<void>();
    const pending = new Map<
      string,
      ReturnType<typeof Promise.withResolvers<any>>
    >();
    const controls = new Set<(control: any) => void>();
    ws.onmessage = (event) => {
      const value = JSON.parse(String(event.data));
      if (value.hello) hello.resolve();
      if (value.control)
        for (const callback of controls) callback(value.control);
      if (value.id) {
        const reply = pending.get(value.id);
        pending.delete(value.id);
        if (value.error) reply?.reject(new Error(JSON.stringify(value.error)));
        else reply?.resolve(value.result);
      }
    };
    ws.onerror = () => hello.reject(new Error("Private RPC socket failed"));
    await deadline(hello.promise, "RPC hello");
    let nextId = 0;
    const call = async <T = any>(
      method: string,
      params: Record<string, unknown> = {},
    ): Promise<T> => {
      const id = `scale-${++nextId}`,
        result = Promise.withResolvers<T>();
      pending.set(id, result);
      ws!.send(JSON.stringify({ id, method, params }));
      try {
        return await deadline(result.promise, method);
      } finally {
        pending.delete(id);
      }
    };
    const invalidation = async (emit: () => void) => {
      const result = Promise.withResolvers<void>();
      const onControl = (control: any) => {
        if (control.type === "world_invalidated") result.resolve();
      };
      controls.add(onControl);
      try {
        emit();
        await deadline(result.promise, "source invalidation");
      } finally {
        controls.delete(onControl);
      }
    };
    return {
      base,
      cookie,
      child,
      call,
      invalidation,
      stop,
      listenerMs,
      connectionReadyMs,
      snapshot: () => call<WorldSnapshotResult>("world.snapshot"),
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

export function snapshotCounts(snapshot: WorldSnapshotResult) {
  return {
    connections: snapshot.connections.length,
    stale: snapshot.connections.filter((c) => c.stale).length,
    actionable: snapshot.connections.filter((c) => c.actionable).length,
    identities: snapshot.connections.map((c) => ({
      connection: c.connection_id,
      generation: c.generation,
      snapshotGeneration: c.snapshot_generation,
      stale: c.stale,
      actionable: c.actionable,
    })),
    coverage: snapshot.connections.map((c) => c.snapshot?.coverage ?? null),
    presented: snapshot.connections.map((c) => ({
      workspaces: c.snapshot?.workspaces.length ?? 0,
      tabs: c.snapshot?.tabs.length ?? 0,
      panes: c.snapshot?.panes.length ?? 0,
      agents: c.snapshot?.agents.length ?? 0,
    })),
  };
}
