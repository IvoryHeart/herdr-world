import * as net from "node:net";
import { join } from "node:path";
import {
  BinReader,
  BinWriter,
  encodeFrame,
} from "../../server/src/bridge/bincode";
import { buildShape, type Shape } from "./fixture";
import { deadline } from "./support";

export async function syntheticSources(shape: Shape, scratch: string) {
  const hosts = buildShape(shape);
  const subscribers = hosts.map(() => new Set<net.Socket>());
  const sockets = new Set<net.Socket>();
  const servers: net.Server[] = [];
  const methods: Record<
    string,
    { calls: number; encodeMs: number; bytes: number }
  > = {};
  let sequence = 0;
  const profiles = [];
  const own = (socket: net.Socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => {
      sockets.delete(socket);
      for (const set of subscribers) set.delete(socket);
    });
  };
  try {
    for (const [h, data] of hosts.entries()) {
      const control = join(scratch, `c${h}.sock`),
        client = join(scratch, `r${h}.sock`);
      const server = net.createServer((socket) => {
        own(socket);
        let input = "";
        socket.on("data", (chunk) => {
          input += chunk;
          let newline: number;
          while ((newline = input.indexOf("\n")) >= 0) {
            const request = JSON.parse(input.slice(0, newline));
            input = input.slice(newline + 1);
            let result: unknown = {};
            const key = request.method.split(".")[0] as string;
            if (request.method === "ping")
              result = { version: "0.0.0-synthetic", protocol: 14 };
            if (
              ["workspace", "tab", "pane", "agent"].includes(key) &&
              request.method.endsWith(".list")
            ) {
              const plural = `${key}s` as keyof typeof data;
              result = { [plural]: data[plural] };
            }
            if (request.method === "pane.get")
              result = {
                pane: data.panes.find(
                  (p) => p.pane_id === request.params?.pane_id,
                ),
              };
            if (request.method === "pane.capture")
              result = {
                text: "Synthetic terminal",
                content: "Synthetic terminal",
              };
            const began = performance.now(),
              text = JSON.stringify({ id: request.id, result }) + "\n";
            const metric = (methods[request.method] ??= {
              calls: 0,
              encodeMs: 0,
              bytes: 0,
            });
            metric.calls++;
            metric.encodeMs += performance.now() - began;
            metric.bytes += Buffer.byteLength(text);
            socket.write(text);
            if (request.method === "events.subscribe")
              subscribers[h]!.add(socket);
            else socket.end();
          }
        });
      });
      servers.push(server);
      await new Promise<void>((resolve) => server.listen(control, resolve));
      const renderer = net.createServer((socket) => {
        own(socket);
        let input = Buffer.alloc(0),
          greeted = false;
        socket.on("data", (chunk) => {
          input = Buffer.concat([input, Buffer.from(chunk)]);
          if (
            greeted ||
            input.length < 4 ||
            input.length < input.readUInt32LE(0) + 4
          )
            return;
          const reader = new BinReader(input.subarray(4));
          if (reader.variant() !== 0) {
            socket.destroy();
            return;
          }
          const writer = new BinWriter();
          writer.variant(0);
          writer.varint(reader.varint());
          writer.varint(1);
          writer.option(undefined, (value: string) => writer.string(value));
          socket.write(encodeFrame(writer.toBuffer()));
          greeted = true;
          input = Buffer.alloc(0);
        });
      });
      servers.push(renderer);
      await new Promise<void>((resolve) => renderer.listen(client, resolve));
      profiles.push({
        id: `scale-${h}`,
        label: `Synthetic source ${h}`,
        type: "local",
        control_socket_path: control,
        client_socket_path: client,
        auto_connect: true,
      });
    }
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    await Promise.all(
      servers.map((s) => new Promise<void>((r) => s.close(() => r()))),
    );
    throw error;
  }

  const emit = (h: number) => {
    const workspace = hosts[h]!.workspaces[0];
    if (!workspace)
      throw new Error("Cannot emit without a synthetic workspace");
    workspace.label = `Synthetic refresh ${++sequence}`;
    const event = {
      event: "workspace.renamed",
      data: { workspace_id: workspace.workspace_id, label: workspace.label },
    };
    for (const socket of subscribers[h]!)
      socket.write(JSON.stringify(event) + "\n");
    return workspace.label as string;
  };
  return {
    profiles,
    methods,
    hosts,
    emit,
    async burst(rate: number, seconds: number) {
      const samples: { dueMs: number; sentMs: number }[] = [],
        began = performance.now();
      // Absolute scheduled deadlines: record overload rather than silently lowering rate.
      for (let i = 0; i < rate * seconds; i++) {
        const dueMs = (i * 1000) / rate;
        await new Promise<void>((resolve) =>
          setTimeout(resolve, Math.max(0, began + dueMs - performance.now())),
        );
        emit(i % hosts.length);
        samples.push({ dueMs, sentMs: performance.now() - began });
      }
      return {
        rate,
        seconds,
        elapsedMs: performance.now() - began,
        actualIntervalRate:
          samples.length > 1
            ? ((samples.length - 1) * 1000) /
              (samples.at(-1)!.sentMs - samples[0]!.sentMs)
            : null,
        samples,
      };
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await deadline(
        Promise.all(
          servers.map((s) => new Promise<void>((r) => s.close(() => r()))),
        ),
        "synthetic sockets close",
      );
    },
  };
}
