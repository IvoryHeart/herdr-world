import { expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import {
  type FloatShellOwner,
  FloatShellRefusal,
  FloatShellService,
} from "../herdr-core/float-shell";
import type { BridgeRpcContext } from "./context";
import { handleFloatRpc } from "./float";

type Socket = ServerWebSocket<unknown>;

/**
 * The handler's own duties: the reply naming a stream reaches the browser
 * before anything that stream shows; pushes are control messages; a browser
 * that left while its shell opened never gets a view; refusals are errors.
 */
function fixture(stub: Partial<FloatShellService>) {
  const socket = { getBufferedAmount: () => 0 } as unknown as Socket;
  const wire: string[] = [];
  // The real owner registry; the stubbed calls see the owner it made.
  const registry = new FloatShellService({ lease: () => null });
  const service = Object.assign(registry, stub) as FloatShellService;
  const clients = new Set<Socket>([socket]);
  const rpc = (method: string, params: Record<string, unknown>) =>
    handleFloatRpc({
      id: "r1",
      method,
      params,
      ws: socket,
      sendReply: (reply: Record<string, unknown>) => {
        wire.push(JSON.stringify(reply));
        return true;
      },
      sendError: (_context: string, error: unknown) => {
        wire.push(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      },
      services: {
        clients,
        safeSend: (_ws: Socket, payload: string) => {
          wire.push(payload);
          return true;
        },
        core: { floats: service },
      },
    } as unknown as BridgeRpcContext);
  const owner = () =>
    service.ownerFor(socket, () => {
      throw new Error("the handler made no owner");
    });
  return { socket, wire, owner, clients, rpc };
}

const openParams = {
  connection_id: "core",
  connection_generation: 2,
  terminal_id: "t1",
  cols: 90,
  rows: 20,
};

test("the open reply precedes the stream's first paint, which arrives as a control push", async () => {
  const owners: FloatShellOwner[] = [];
  const seen: unknown[] = [];
  const f = fixture({
    open: async (who, request) => {
      owners.push(who);
      seen.push(request);
      return {
        stream: "float-1",
        address: "t9",
        name: "world-float-x",
        room: "hc:space:s1",
        created: true,
      };
    },
    start: (who, stream) => {
      who.send({ type: "float_output", stream, data: "aGk=" });
    },
  });
  await f.rpc("world.float.open", openParams);
  expect(seen).toEqual([
    {
      connectionId: "core",
      generation: 2,
      terminal: "t1",
      size: { cols: 90, rows: 20 },
    },
  ]);
  expect(f.wire.map((line) => JSON.parse(line))).toEqual([
    {
      id: "r1",
      result: {
        stream: "float-1",
        address: "t9",
        name: "world-float-x",
        room: "hc:space:s1",
        created: true,
      },
    },
    { control: { type: "float_output", stream: "float-1", data: "aGk=" } },
  ]);
  expect(owners).toEqual([f.owner()]);
});

test("a browser that left while the shell opened gets no view and no reply", async () => {
  const hidden: string[] = [];
  const f = fixture({
    open: async () => {
      f.clients.clear();
      return {
        stream: "float-1",
        address: "t9",
        name: "n",
        room: "r",
        created: false,
      };
    },
    hide: (_owner, stream) => {
      hidden.push(stream);
    },
    start: () => {
      throw new Error("never started");
    },
  });
  await f.rpc("world.float.open", openParams);
  expect(hidden).toEqual(["float-1"]);
  expect(f.wire).toEqual([]);
});

test("input is decoded and bounded; refusals reach the browser as errors", async () => {
  const typed: string[] = [];
  const f = fixture({
    input: (_owner, stream, bytes) => {
      typed.push(`${stream}:${new TextDecoder().decode(bytes)}`);
    },
    stop: async () => {
      throw new FloatShellRefusal("That float shell is no longer open");
    },
  });
  await f.rpc("world.float.input", {
    stream: "float-1",
    data: Buffer.from("ls\r").toString("base64"),
  });
  await f.rpc("world.float.input", {
    stream: "float-1",
    data: Buffer.alloc(64 * 1024 + 1).toString("base64"),
  });
  await f.rpc("world.float.stop", { stream: "float-1" });
  await f.rpc("world.float.missing", { stream: "float-1" });
  expect(typed).toEqual(["float-1:ls\r"]);
  expect(f.wire.map((line) => JSON.parse(line))).toEqual([
    { id: "r1", result: { ok: true } },
    { error: "Too much input at once" },
    { error: "That float shell is no longer open" },
    { error: "unknown float shell operation: world.float.missing" },
  ]);
});
