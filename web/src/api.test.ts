import { afterEach, describe, expect, test } from "bun:test";
import {
  Bridge,
  type ConnectionStatus,
  logoutBrowserSession,
  parseConnectionSummary,
} from "./api";
import { connectionHttpPath, connectionHttpResource } from "./connectionHttp";

const originalWebSocket = globalThis.WebSocket;
const originalFetch = globalThis.fetch;
const originalLocation = Object.getOwnPropertyDescriptor(
  globalThis,
  "location",
);
const testBridges: Bridge[] = [];

describe("simultaneous qualified runtime admission", () => {
  function setup(
    decode?: (parts: string[], signal: AbortSignal) => Promise<unknown>,
    admission = false,
  ) {
    class Socket extends HangingWebSocket {
      static instance: Socket;
      sent: Array<Record<string, any>> = [];
      constructor() {
        super();
        Socket.instance = this;
        this.readyState = HangingWebSocket.OPEN;
      }
      send(raw = "") {
        this.sent.push(JSON.parse(raw));
      }
      receive(message: object) {
        this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
      }
    }
    installBrowserGlobals(Socket as unknown as typeof WebSocket);
    const bridge = decode
      ? new Bridge(1000, 1000, decode)
      : createTestBridge(1000);
    if (decode) testBridges.push(bridge);
    bridge.connect();
    const socket = Socket.instance;
    socket.receive({
      hello: true,
      bridge_protocol_version: 2,
      default_connection_id: "alpha",
      capabilities: {
        connection_id: true,
        connection_scoped_http: true,
        connection_runtime_generation: true,
        world_snapshot_chunks: true,
        world_snapshot_chunk_admission: admission,
      },
    });
    bridge.setConnectionRuntimeGenerations([
      { id: "alpha", generation: 7 },
      { id: "beta", generation: 3 },
    ]);
    return { bridge, socket, currentSocket: () => Socket.instance };
  }

  test.each([false, true])(
    "browser snapshot credit yields to sibling input and fences retirement=%j",
    async (retire) => {
      const descriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        "scheduler",
      );
      const background = Promise.withResolvers<void>();
      Object.defineProperty(globalThis, "scheduler", {
        configurable: true,
        value: { postTask: () => background.promise },
      });
      try {
        const { bridge, socket } = setup(undefined, true);
        const snapshot = bridge.call("world.snapshot", {});
        void snapshot.catch(() => {});
        expect(socket.sent[0]!.accept_world_snapshot_chunk_admission).toBe(
          true,
        );
        const id = socket.sent[0]!.id;
        for (let index = 0; index < 4; index++)
          socket.receive({
            id,
            world_snapshot_chunk: { index, total: 5, data: " " },
          });
        expect(
          socket.sent.filter((frame) => frame.world_snapshot_admitted),
        ).toHaveLength(0);
        const input = bridge
          .connection("beta", 3)
          .call("terminal.input", { terminal_id: "same", data: "eA==" });
        socket.receive({
          id: socket.sent[1]!.id,
          connection_id: "beta",
          connection_generation: 3,
          result: { ok: true },
        });
        expect(await input).toEqual({ ok: true });
        if (retire) bridge.disconnect();
        background.resolve();
        await Promise.resolve();
        expect(
          socket.sent.filter((frame) => frame.world_snapshot_admitted),
        ).toEqual(
          retire ? [] : [{ world_snapshot_admitted: { id, index: 3 } }],
        );
        if (!retire)
          socket.receive({
            id,
            world_snapshot_chunk: {
              index: 4,
              total: 5,
              data: '{"connections":[]}',
            },
          });
        if (retire) await expect(snapshot).rejects.toThrow();
        else expect(await snapshot).toEqual({ connections: [] });
      } finally {
        background.resolve();
        if (descriptor)
          Object.defineProperty(globalThis, "scheduler", descriptor);
        else delete (globalThis as any).scheduler;
      }
    },
  );

  test("deferred snapshot decoding admits sibling ACKs and retires before old publication", async () => {
    const held = Promise.withResolvers<unknown>();
    let signal: AbortSignal | undefined;
    const { bridge, socket } = setup((_parts, captured) => {
      signal = captured;
      return held.promise;
    });
    let published = false;
    const snapshot = bridge.call("world.snapshot", {}).then((value) => {
      published = true;
      return value;
    });
    void snapshot.catch(() => {});
    socket.receive({
      id: socket.sent[0]!.id,
      world_snapshot_chunk: { index: 0, total: 1, data: '{"connections":[]}' },
    });
    const input = bridge
      .connection("beta", 3)
      .call("terminal.input", { terminal_id: "same", data: "eA==" });
    socket.receive({
      id: socket.sent[1]!.id,
      connection_id: "beta",
      connection_generation: 3,
      result: { ok: true },
    });
    expect(await input).toEqual({ ok: true });
    expect(published).toBe(false);
    expect(signal?.aborted).toBe(false);
    bridge.disconnect();
    expect(signal?.aborted).toBe(true);
    held.resolve({ connections: [] });
    await expect(snapshot).rejects.toThrow();
    await Promise.resolve();
    expect(published).toBe(false);
  });

  test("decode failure rejects only its owning snapshot and leaves a sibling global request usable", async () => {
    const held = Promise.withResolvers<unknown>();
    const { bridge, socket } = setup(() => held.promise);
    const snapshot = bridge.call("world.snapshot", {});
    void snapshot.catch(() => {});
    const ping = bridge.call("bridge.ping");
    void ping.catch(() => {});
    socket.receive({
      id: socket.sent[0]!.id,
      world_snapshot_chunk: { index: 0, total: 1, data: "{}" },
    });
    held.reject(Error("malformed decode"));
    await expect(snapshot).rejects.toThrow("malformed decode");
    socket.receive({ id: socket.sent[1]!.id, result: { ok: true } });
    expect(await ping).toEqual({ ok: true });
  });

  test("snapshot timeout cancels decode without retiring a healthy sibling", async () => {
    const held = Promise.withResolvers<unknown>();
    let signal: AbortSignal | undefined;
    const { bridge, socket } = setup((_parts, captured) => {
      signal = captured;
      return held.promise;
    });
    const snapshot = bridge.call("world.snapshot", {}, 5);
    void snapshot.catch(() => {});
    socket.receive({
      id: socket.sent[0]!.id,
      world_snapshot_chunk: { index: 0, total: 1, data: "{}" },
    });
    await expect(snapshot).rejects.toThrow("timeout");
    expect(signal?.aborted).toBe(true);
    held.resolve({ connections: [] });
    const input = bridge
      .connection("beta", 3)
      .call("terminal.input", { terminal_id: "same", data: "eA==" });
    socket.receive({
      id: socket.sent[1]!.id,
      connection_id: "beta",
      connection_generation: 3,
      result: { ok: true },
    });
    expect(await input).toEqual({ ok: true });
  });

  test.each([
    { world_snapshot_chunk: { index: 0, total: 1, data: "{}" } },
    { result: { connections: [] } },
    { error: { message: "late failure" } },
    { world_snapshot_chunk: null },
  ])(
    "a conflicting reply during decode retires the original job: %j",
    async (conflict) => {
      const held = Promise.withResolvers<unknown>();
      let signal: AbortSignal | undefined;
      let jobs = 0;
      const { bridge, socket } = setup((_parts, captured) => {
        signal = captured;
        jobs++;
        return held.promise;
      });
      let published = false;
      const snapshot = bridge.call("world.snapshot", {}).then((value) => {
        published = true;
        return value;
      });
      void snapshot.catch(() => {});
      const id = socket.sent[0]!.id;
      socket.receive({
        id,
        world_snapshot_chunk: { index: 0, total: 1, data: "{}" },
      });
      socket.receive({ id, ...conflict });
      await expect(snapshot).rejects.toThrow();
      expect(jobs).toBe(1);
      expect(signal?.aborted).toBe(true);
      held.resolve({ connections: [] });
      await Promise.resolve();
      expect(published).toBe(false);
      const ping = bridge.call("bridge.ping");
      socket.receive({ id: socket.sent[1]!.id, result: { ok: true } });
      expect(await ping).toEqual({ ok: true });
    },
  );

  test("bounded aggregate chunks allow sibling acknowledgements before admission", async () => {
    const { bridge, socket } = setup();
    let admitted = false;
    const snapshot = bridge.call("world.snapshot", {}).then((value) => {
      admitted = true;
      return value;
    });
    void snapshot.catch(() => {});
    const id = socket.sent[0]!.id;
    const wire = JSON.stringify({ revision: 1, connections: [] });
    const middle = Math.floor(wire.length / 2);
    socket.receive({
      id,
      world_snapshot_chunk: { index: 0, total: 2, data: wire.slice(0, middle) },
    });
    const input = bridge
      .connection("beta", 3)
      .call("terminal.input", { terminal_id: "same", data: "eA==" });
    socket.receive({
      id: socket.sent[1]!.id,
      connection_id: "beta",
      connection_generation: 3,
      result: { ok: true },
    });
    expect(await input).toEqual({ ok: true });
    expect(admitted).toBe(false);
    socket.receive({
      id,
      world_snapshot_chunk: { index: 1, total: 2, data: wire.slice(middle) },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(admitted).toBe(true);
    expect(await snapshot).toEqual({ revision: 1, connections: [] });
  });

  test.each([
    { index: 1, total: 2, data: "{}" },
    { index: 0, total: 4097, data: "{}" },
    { index: 0, total: 1, data: "x".repeat(65537) },
    { index: 0, total: 1, data: "invalid-json" },
  ])("malformed aggregate chunks fail closed", async (chunk) => {
    const { bridge, socket } = setup();
    const snapshot = bridge.call("world.snapshot", {});
    socket.receive({ id: socket.sent[0]!.id, world_snapshot_chunk: chunk });
    await expect(snapshot).rejects.toThrow();
    expect(bridge.connection("beta", 3).isCurrent()).toBe(true);
  });

  test("disconnect retires partially assembled aggregate and suppresses its final chunk", async () => {
    const { bridge, socket } = setup();
    let published = false;
    const snapshot = bridge.call("world.snapshot", {}).then((value) => {
      published = true;
      return value;
    });
    const id = socket.sent[0]!.id;
    socket.receive({
      id,
      world_snapshot_chunk: { index: 0, total: 2, data: '{"revision":' },
    });
    bridge.disconnect();
    await expect(snapshot).rejects.toThrow("paused");
    socket.receive({
      id,
      world_snapshot_chunk: { index: 1, total: 2, data: "1}" },
    });
    expect(published).toBe(false);
  });

  test("authentication loss retires all explicit clients without downstream dispatch", async () => {
    const { bridge, socket, currentSocket } = setup();
    const alpha = bridge.connection("alpha", 7);
    const beta = bridge.connection("beta", 3);
    const pending = Promise.allSettled([
      alpha.call("pane.read", { pane_id: "same" }),
      beta.call("pane.read", { pane_id: "same" }),
    ]);
    Object.assign(location, { replace() {} });
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(null, { status: 204 }),
      )) as unknown as typeof fetch;
    socket.onclose?.({ code: 4001 });
    expect((await pending).map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(alpha.isCurrent()).toBe(false);
    expect(beta.isCurrent()).toBe(false);
    expect(currentSocket()).toBe(socket);
    await expect(beta.call("pane.read", { pane_id: "same" })).rejects.toThrow();
    expect(socket.sent).toHaveLength(2);
  });

  test("two explicit clients dispatch colliding pane IDs and admit reversed replies over one transport", async () => {
    const { bridge, socket } = setup();
    const alpha = bridge.connection("alpha", 7);
    const beta = bridge.connection("beta", 3);
    const results = Promise.allSettled([
      alpha.call("pane.read", { pane_id: "same" }),
      beta.call("pane.read", { pane_id: "same" }),
    ]);
    expect(socket.sent).toHaveLength(2);
    expect(
      socket.sent.map(({ connection_id, connection_generation, params }) => ({
        connection_id,
        connection_generation,
        params,
      })),
    ).toEqual([
      {
        connection_id: "alpha",
        connection_generation: 7,
        params: { pane_id: "same" },
      },
      {
        connection_id: "beta",
        connection_generation: 3,
        params: { pane_id: "same" },
      },
    ]);
    bridge.setActiveConnection("beta");
    for (const request of [...socket.sent].reverse()) {
      socket.receive({
        ...request,
        method: undefined,
        params: undefined,
        result: { owner: request.connection_id },
      });
    }
    expect(await results).toEqual([
      { status: "fulfilled", value: { owner: "alpha" } },
      { status: "fulfilled", value: { owner: "beta" } },
    ]);
  });

  test("runtime-owned listeners reject sibling and retired streams and release their subscriptions", () => {
    const { bridge, socket } = setup();
    const alpha = bridge.connection("alpha", 7);
    const received: string[] = [];
    const releases = [
      bridge.onEvent(() => received.push("event"), alpha),
      bridge.onTerminal(() => received.push("terminal"), alpha),
      bridge.onTerminalClipboard(() => received.push("clipboard"), alpha),
      bridge.onPopup(() => received.push("popup"), alpha),
      bridge.onTerminalClosed(() => received.push("closed"), alpha),
    ];
    const push = (connection_id: string, connection_generation: number) => {
      for (const payload of [
        { event: "pane.updated", data: { pane_id: "same" } },
        {
          terminal: {
            terminal_id: "same",
            width: 80,
            height: 24,
            full: true,
            bytes: "",
          },
        },
        { terminal_clipboard: { terminal_id: "same", data: "YQ==" } },
        { popup: null },
        { terminal_closed: { terminal_id: "same" } },
      ])
        socket.receive({ connection_id, connection_generation, ...payload });
    };
    push("beta", 3);
    expect(received).toEqual([]);
    bridge.setActiveConnection("beta");
    push("alpha", 7);
    expect(received).toEqual([
      "event",
      "terminal",
      "clipboard",
      "popup",
      "closed",
    ]);
    bridge.setConnectionRuntimeGenerations([
      { id: "alpha", generation: 8 },
      { id: "beta", generation: 3 },
    ]);
    push("alpha", 8);
    expect(received).toHaveLength(5);
    releases.forEach((release) => release());
    expect(alpha.acceptsServerGeneration(7)).toBe(false);
  });

  test("qualified HTTP decoding checks both response identity and delayed body admission", async () => {
    const { bridge } = setup();
    const alpha = bridge.connection("alpha", 7);
    const body = Promise.withResolvers<string>();
    const decoding = Promise.withResolvers<void>();
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (path: string, init?: RequestInit) => {
      requests.push({ path, init });
      return new Response("synthetic", {
        headers: {
          "X-Herdr-Connection-Id": "alpha",
          "X-Herdr-Connection-Generation": "7",
        },
      });
    }) as unknown as typeof fetch;
    const pending = connectionHttpResource(
      alpha,
      "/file/download?workspace_id=same",
      async () => {
        decoding.resolve();
        return body.promise;
      },
    );
    await decoding.promise;
    expect(requests[0].path).toBe(
      "/api/connections/alpha/file/download?workspace_id=same&connection_generation=7",
    );
    expect(requests[0].init).toMatchObject({
      credentials: "same-origin",
      redirect: "error",
    });
    bridge.setActiveConnection("beta");
    bridge.setConnectionRuntimeGenerations([{ id: "beta", generation: 3 }]);
    body.resolve("retired file");
    await expect(pending).rejects.toThrow(
      "connection runtime generation is unavailable",
    );
    await expect(
      connectionHttpResource(alpha, "/file/download", (response) =>
        response.text(),
      ),
    ).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });

  test("same-generation catalogue on a new transport cannot revive an old explicit client", async () => {
    const { bridge, currentSocket } = setup();
    const alpha = bridge.connection("alpha", 7);
    bridge.disconnect();
    bridge.connect();
    currentSocket().receive({
      hello: true,
      bridge_protocol_version: 2,
      default_connection_id: "alpha",
      capabilities: { connection_runtime_generation: true },
    });
    bridge.setConnectionRuntimeGenerations([{ id: "alpha", generation: 7 }]);
    expect(alpha.isCurrent()).toBe(false);
    expect(bridge.connection("alpha", 7).isCurrent()).toBe(true);
    await expect(
      alpha.call("terminal.input", { terminal_id: "same", data: "x" }),
    ).rejects.toThrow();
    expect(currentSocket().sent).toEqual([]);
  });

  test("retiring alpha rejects its pending work immediately while beta remains admitted", async () => {
    const { bridge, socket } = setup();
    const alpha = bridge.connection("alpha", 7);
    const pending = alpha.call("pane.read", { pane_id: "same" });
    const outcome = pending.then(
      () => "published",
      () => "retired",
    );
    bridge.setConnectionRuntimeGenerations([
      { id: "alpha", generation: 8 },
      { id: "beta", generation: 3 },
    ]);
    // Drain promise reactions without waiting for the RPC timeout.
    await Promise.resolve();
    expect(
      await Promise.race([outcome, Promise.resolve("still pending")]),
    ).toBe("retired");
    const request = socket.sent[0];
    socket.receive({
      id: request.id,
      connection_id: "alpha",
      connection_generation: 7,
      result: { obsolete: true },
    });
    expect(await outcome).toBe("retired");
    expect(alpha.isCurrent()).toBe(false);
    expect(bridge.connection("beta", 3).isCurrent()).toBe(true);
  });

  test("an unavailable catalogue entry retires only its own requests even without a generation change", async () => {
    const { bridge, socket } = setup();
    const alpha = bridge.connection("alpha", 7);
    const beta = bridge.connection("beta", 3);
    const alphaOutcome = alpha
      .call("pane.read", { pane_id: "same" })
      .catch((error) => error);
    const betaOutcome = beta.call("pane.read", { pane_id: "same" });
    bridge.setConnectionRuntimeGenerations([
      { id: "alpha", generation: 7, state: "error" },
      { id: "beta", generation: 3, state: "ready" },
    ]);
    expect(alpha.isCurrent()).toBe(false);
    expect(beta.isCurrent()).toBe(true);
    const request = socket.sent[1];
    socket.receive({
      id: request.id,
      connection_id: "beta",
      connection_generation: 3,
      result: "beta",
    });
    expect(await alphaOutcome).toBeInstanceOf(Error);
    expect(await betaOutcome).toBe("beta");
  });

  test("lost input acknowledgement reports uncertainty and never sends another request", async () => {
    const { bridge, socket } = setup();
    const outcome = bridge
      .connection("alpha", 7)
      .call("terminal.input", { terminal_id: "same", data: "x" })
      .catch((error) => error);
    bridge.disconnect();
    expect((await outcome).message).toContain("outcome is uncertain");
    expect(socket.sent).toHaveLength(1);
  });

  test("restoring readiness with the same server generation cannot revive a retired lease", async () => {
    const { bridge, socket } = setup();
    const alpha = bridge.connection("alpha", 7);
    bridge.setConnectionRuntimeGenerations([{ id: "beta", generation: 3 }]);
    bridge.setConnectionRuntimeGenerations([
      { id: "alpha", generation: 7 },
      { id: "beta", generation: 3 },
    ]);
    expect(alpha.isCurrent()).toBe(false);
    await expect(
      alpha.call("terminal.input", { terminal_id: "same", data: "x" }),
    ).rejects.toThrow();
    expect(bridge.connection("alpha", 7).isCurrent()).toBe(true);
    expect(socket.sent).toEqual([]);
  });

  test("HTTP response retirement cancels its body before decoding", async () => {
    const { bridge } = setup();
    const response = Promise.withResolvers<Response>();
    let cancelled = false;
    let decoded = false;
    globalThis.fetch = (() => response.promise) as unknown as typeof fetch;
    const pending = connectionHttpResource(
      bridge.connection("alpha", 7),
      "/file/download",
      async () => {
        decoded = true;
        return "file";
      },
    );
    bridge.setConnectionRuntimeGenerations([{ id: "beta", generation: 3 }]);
    response.resolve(
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      ),
    );
    await expect(pending).rejects.toThrow(
      "connection runtime generation is unavailable",
    );
    expect(decoded).toBe(false);
    expect(cancelled).toBe(true);
  });

  test("HTTP body decoding remains on its owning host after another host gains focus", async () => {
    const { bridge } = setup();
    const body = Promise.withResolvers<string>();
    const decoding = Promise.withResolvers<void>();
    globalThis.fetch = (async () =>
      new Response("file", {
        headers: {
          "X-Herdr-Connection-Id": "alpha",
          "X-Herdr-Connection-Generation": "7",
        },
      })) as unknown as typeof fetch;
    const pending = connectionHttpResource(
      bridge.connection("alpha", 7),
      "/file/download",
      async () => {
        decoding.resolve();
        return body.promise;
      },
    );
    await decoding.promise;
    bridge.setActiveConnection("beta");
    body.resolve("alpha file");
    expect(await pending).toBe("alpha file");
  });

  test("HTTP replies with missing or sibling identity cannot enter a qualified decoder", async () => {
    const { bridge } = setup();
    const responseHeaders: Array<Record<string, string>> = [
      {},
      { "X-Herdr-Connection-Id": "beta", "X-Herdr-Connection-Generation": "7" },
      {
        "X-Herdr-Connection-Id": "alpha",
        "X-Herdr-Connection-Generation": "8",
      },
    ];
    for (const headers of responseHeaders) {
      let decoded = false;
      let cancelled = false;
      globalThis.fetch = (async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { headers },
        )) as unknown as typeof fetch;
      await expect(
        connectionHttpResource(
          bridge.connection("alpha", 7),
          "/file/download",
          async () => {
            decoded = true;
            return "file";
          },
        ),
      ).rejects.toThrow("response connection identity mismatch");
      expect(decoded).toBe(false);
      expect(cancelled).toBe(true);
    }
  });

  test("uncatalogued, missing-generation and obsolete explicit clients never dispatch or default-route", async () => {
    const { bridge, socket } = setup();
    for (const client of [
      bridge.connection("unknown", 7),
      bridge.connection("alpha"),
      bridge.connection("alpha", 6),
    ]) {
      expect(client.isCurrent()).toBe(false);
      await expect(
        client.call("terminal.input", { terminal_id: "same", data: "x" }),
      ).rejects.toThrow();
    }
    expect(socket.sent).toEqual([]);
  });

  test("HTTP mutation acknowledgement loss reports uncertainty without replay", async () => {
    const { bridge } = setup();
    const paths: string[] = [];
    globalThis.fetch = (async (path: string) => {
      paths.push(path);
      throw new Error("synthetic transport loss");
    }) as unknown as typeof fetch;
    await expect(
      connectionHttpResource(
        bridge.connection("beta", 3),
        "/file/delete",
        (response) => response.json(),
        { method: "POST" },
      ),
    ).rejects.toThrow("outcome is uncertain");
    expect(paths).toEqual([
      "/api/connections/beta/file/delete?connection_generation=3",
    ]);
  });

  test("a delayed HTTP body stays usable across focus changes and retires only with its host", async () => {
    const { bridge } = setup();
    const alpha = bridge.connection("alpha", 7);
    const body = Promise.withResolvers<string>();
    const published: string[] = [];
    const response = body.promise.then((text) => {
      if (alpha.isCurrent()) published.push(text);
    });
    expect(connectionHttpPath("alpha", "/file-download", 7)).toBe(
      "/api/connections/alpha/file-download?connection_generation=7",
    );
    bridge.setActiveConnection("beta");
    body.resolve("alpha file");
    await response;
    expect(published).toEqual(["alpha file"]);
    bridge.setConnectionRuntimeGenerations([{ id: "beta", generation: 3 }]);
    expect(alpha.isCurrent()).toBe(false);
  });

  test("an old-generation reply cannot publish after catalogue replacement", async () => {
    const { bridge, socket } = setup();
    const outcome = bridge
      .connection("alpha", 7)
      .call("pane.read", { pane_id: "same" })
      .then(
        () => "published",
        () => "retired",
      );
    const request = socket.sent[0];
    bridge.setConnectionRuntimeGenerations([
      { id: "alpha", generation: 8 },
      { id: "beta", generation: 3 },
    ]);
    socket.receive({
      id: request.id,
      connection_id: "alpha",
      connection_generation: 7,
      result: { text: "obsolete" },
    });
    expect(await outcome).toBe("retired");
  });

  test("qualified pushes drop retired alpha streams and preserve beta streams with equal IDs", () => {
    const { bridge, socket } = setup();
    const received: string[] = [];
    bridge.onEvent((msg) => received.push(`event:${msg.connection_id}`));
    bridge.onTerminal((msg) => received.push(`terminal:${msg.connection_id}`));
    bridge.onTerminalClipboard((msg) =>
      received.push(`clipboard:${msg.connection_id}`),
    );
    bridge.onPopup((msg) => received.push(`popup:${msg.connection_id}`));
    bridge.onTerminalClosed((msg) =>
      received.push(`closed:${msg.connection_id}`),
    );
    bridge.setConnectionRuntimeGenerations([
      { id: "alpha", generation: 8 },
      { id: "beta", generation: 3 },
    ]);
    for (const [connection_id, connection_generation] of [
      ["alpha", 7],
      ["beta", 3],
    ] as const) {
      for (const payload of [
        { event: "pane.updated", data: { pane_id: "same" } },
        {
          terminal: {
            terminal_id: "same",
            width: 80,
            height: 24,
            full: true,
            bytes: "",
          },
        },
        { terminal_clipboard: { terminal_id: "same", data: "YQ==" } },
        {
          popup: {
            terminal_id: "same",
            title: "Synthetic",
            width: null,
            height: null,
          },
        },
        { terminal_closed: { terminal_id: "same" } },
      ])
        socket.receive({ connection_id, connection_generation, ...payload });
    }
    expect(received).toEqual([
      "event:beta",
      "terminal:beta",
      "clipboard:beta",
      "popup:beta",
      "closed:beta",
    ]);
  });

  test("lost mutation acknowledgements invalidate clients without replay on a new transport", async () => {
    const { bridge, socket, currentSocket } = setup();
    const alpha = bridge.connection("alpha", 7);
    const outcome = alpha
      .call("terminal.input", { terminal_id: "same", data: "x" })
      .then(
        () => "acknowledged",
        () => "uncertain",
      );
    bridge.disconnect();
    expect(await outcome).toBe("uncertain");
    bridge.connect();
    const replacement = currentSocket();
    expect(replacement).not.toBe(socket);
    sendHello(replacement, "alpha");
    expect(replacement.sent).toEqual([]);
    expect(
      socket.sent.filter((request) => request.method === "terminal.input"),
    ).toHaveLength(1);
    expect(alpha.isCurrent()).toBe(false);
  });
});

class HangingWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = HangingWebSocket.CONNECTING;
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event?: Pick<CloseEvent, "code">) => void) | null = null;

  close() {
    this.readyState = HangingWebSocket.CLOSED;
    this.onclose?.();
  }

  send() {}
}

function installBrowserGlobals(webSocket: typeof WebSocket) {
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { protocol: "http:", host: "localhost:5173" },
  });
  globalThis.WebSocket = webSocket;
}

function createTestBridge(connectTimeoutMs = 5, reconnectDelayMs = 1000) {
  const bridge = new Bridge(connectTimeoutMs, reconnectDelayMs);
  testBridges.push(bridge);
  return bridge;
}

function sendHello(
  socket: HangingWebSocket,
  defaultConnectionId = "startup-default",
) {
  socket.onmessage?.({
    data: JSON.stringify({
      hello: true,
      bridge_protocol_version: 2,
      default_connection_id: defaultConnectionId,
      capabilities: { connection_id: true, connection_scoped_http: true },
    }),
  } as MessageEvent);
}

afterEach(() => {
  testBridges.splice(0).forEach((bridge) => bridge.disconnect());
  globalThis.WebSocket = originalWebSocket;
  globalThis.fetch = originalFetch;
  if (originalLocation) {
    Object.defineProperty(globalThis, "location", originalLocation);
  } else {
    Reflect.deleteProperty(globalThis, "location");
  }
});

describe("browser logout", () => {
  test.each([204, 500])(
    "only redirects after cookie removal succeeds (%s)",
    async (status) => {
      let destination = "";
      Object.defineProperty(globalThis, "location", {
        configurable: true,
        value: {
          replace(value: string) {
            destination = value;
          },
        },
      });
      const response = Promise.withResolvers<Response>();
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: (url: string, init: RequestInit) => {
          expect(url).toBe("/api/logout");
          expect(init).toMatchObject({
            method: "POST",
            credentials: "same-origin",
            headers: { "x-herdr-world-logout": "1", "x-roamgate-logout": "1" },
          });
          return response.promise;
        },
      });
      const logout = logoutBrowserSession();
      expect(destination).toBe("");
      response.resolve(new Response(null, { status }));
      if (status === 204) {
        await logout;
        expect(destination).toBe("/login");
      } else {
        await expect(logout).rejects.toThrow("Could not log out");
        expect(destination).toBe("");
      }
    },
  );

  test("a logout close stops reconnection and clears the cookie before leaving another tab", async () => {
    class LogoutSocket extends HangingWebSocket {
      static instance: LogoutSocket;
      constructor() {
        super();
        LogoutSocket.instance = this;
      }
    }
    installBrowserGlobals(LogoutSocket as unknown as typeof WebSocket);
    const navigated = Promise.withResolvers<string>();
    Object.assign(location, { replace: navigated.resolve });
    const response = Promise.withResolvers<Response>();
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: () => response.promise,
    });
    const bridge = createTestBridge(1000);
    bridge.connect();
    const socket = LogoutSocket.instance;
    socket.readyState = WebSocket.OPEN;
    sendHello(socket);
    socket.readyState = WebSocket.CLOSED;
    socket.onclose?.({ code: 4001 });
    expect(bridge.status).toBe("disconnected");
    expect(
      (bridge as unknown as { reconnectEnabled: boolean }).reconnectEnabled,
    ).toBe(false);
    response.resolve(new Response(null, { status: 204 }));
    expect(await navigated.promise).toBe("/login");
  });
});

describe("bridge connection lifecycle", () => {
  test("marks the bridge connected only after a valid hello", async () => {
    class OpeningWebSocket extends HangingWebSocket {
      static instance: OpeningWebSocket;

      constructor() {
        super();
        OpeningWebSocket.instance = this;
        queueMicrotask(() => {
          this.readyState = OpeningWebSocket.OPEN;
          this.onopen?.();
        });
      }
    }
    installBrowserGlobals(OpeningWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge(50);

    bridge.connect();
    await Bun.sleep(1);
    expect(bridge.status).toBe("connecting");

    sendHello(OpeningWebSocket.instance);
    expect(bridge.status).toBe("connected");
    await Bun.sleep(60);
    expect(bridge.status).toBe("connected");
  });

  test("rejects an open socket that never sends a valid hello", async () => {
    class SilentWebSocket extends HangingWebSocket {
      constructor() {
        super();
        queueMicrotask(() => {
          this.readyState = SilentWebSocket.OPEN;
          this.onopen?.();
        });
      }
    }
    installBrowserGlobals(SilentWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge(5, 1000);

    bridge.connect();
    await Bun.sleep(15);

    expect(bridge.status).toBe("disconnected");
  });

  test("ignores a hello with malformed known capabilities", async () => {
    class ManualWebSocket extends HangingWebSocket {
      static instance: ManualWebSocket;

      constructor() {
        super();
        ManualWebSocket.instance = this;
        queueMicrotask(() => {
          this.readyState = ManualWebSocket.OPEN;
          this.onopen?.();
        });
      }
    }
    installBrowserGlobals(ManualWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge(50);
    bridge.connect();
    await Bun.sleep(1);

    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({
        hello: true,
        bridge_protocol_version: 2,
        default_connection_id: "alpha",
        capabilities: { connection_id: "yes" },
      }),
    } as MessageEvent);
    expect(bridge.status).toBe("connecting");

    sendHello(ManualWebSocket.instance, "alpha");
    expect(bridge.status).toBe("connected");
  });

  test("leaves connecting state when the WebSocket handshake hangs", async () => {
    installBrowserGlobals(HangingWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge();
    const statuses: ConnectionStatus[] = [];
    bridge.onStatus((status) => statuses.push(status));

    bridge.connect();
    await Bun.sleep(15);

    expect(statuses).toEqual(["disconnected", "connecting", "disconnected"]);
    expect(bridge.status).toBe("disconnected");
  });

  test("retries after a timed-out WebSocket handshake", async () => {
    class RecoveringWebSocket extends HangingWebSocket {
      static instances = 0;

      constructor() {
        super();
        RecoveringWebSocket.instances += 1;
        if (RecoveringWebSocket.instances === 2) {
          queueMicrotask(() => {
            this.readyState = RecoveringWebSocket.OPEN;
            this.onopen?.();
            sendHello(this);
          });
        }
      }
    }
    installBrowserGlobals(RecoveringWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge(5, 1);
    const connected = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("timed out waiting for reconnect")),
        100,
      );
      bridge.onStatus((status) => {
        if (status !== "connected") return;
        clearTimeout(timer);
        resolve();
      });
    });

    bridge.connect();
    await connected;

    expect(RecoveringWebSocket.instances).toBe(2);
    expect(bridge.status).toBe("connected");
  });

  test("recovers when opening the WebSocket throws synchronously", () => {
    class ThrowingWebSocket {
      constructor() {
        throw new Error("blocked");
      }
    }
    installBrowserGlobals(ThrowingWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge();
    const statuses: ConnectionStatus[] = [];
    bridge.onStatus((status) => statuses.push(status));

    bridge.connect();

    expect(statuses).toEqual(["disconnected", "connecting", "disconnected"]);
    expect(bridge.status).toBe("disconnected");
  });

  test("allows a long-running RPC to rely on connection lifetime", async () => {
    class ManualWebSocket extends HangingWebSocket {
      static instance: ManualWebSocket;
      sent: string[] = [];

      constructor() {
        super();
        ManualWebSocket.instance = this;
        queueMicrotask(() => {
          this.readyState = ManualWebSocket.OPEN;
          this.onopen?.();
        });
      }

      send(raw = "") {
        this.sent.push(raw);
      }
    }
    installBrowserGlobals(ManualWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge();
    bridge.connect();
    await Bun.sleep(1);
    sendHello(ManualWebSocket.instance);

    const response = bridge.call(
      "worktree.remove",
      { workspace_id: "w1" },
      null,
    );
    const request = JSON.parse(ManualWebSocket.instance.sent[0]);
    await Bun.sleep(5);
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({
        connection_id: "startup-default",
        id: request.id,
        result: { ok: true },
      }),
    } as MessageEvent);

    await expect(response).resolves.toEqual({ ok: true });
  });

  test("dispatches terminal clipboard pushes and removes listeners", async () => {
    class ManualWebSocket extends HangingWebSocket {
      static instance: ManualWebSocket;

      constructor() {
        super();
        ManualWebSocket.instance = this;
        queueMicrotask(() => {
          this.readyState = ManualWebSocket.OPEN;
          this.onopen?.();
        });
      }
    }
    installBrowserGlobals(ManualWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge();
    const received: Array<{
      connection_id: string;
      terminal_id: string;
      data: string;
    }> = [];
    const remove = bridge.onTerminalClipboard((clipboard) =>
      received.push(clipboard),
    );
    bridge.connect();
    await Bun.sleep(1);
    sendHello(ManualWebSocket.instance);

    const push = { terminal_id: "term_1", data: "Y29weQ==" };
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({
        connection_id: "startup-default",
        terminal_clipboard: push,
      }),
    } as MessageEvent);
    remove();
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({
        connection_id: "startup-default",
        terminal_clipboard: push,
      }),
    } as MessageEvent);

    expect(received).toEqual([{ connection_id: "startup-default", ...push }]);
  });

  test("dispatches agent status events that omit data.type", async () => {
    class ManualWebSocket extends HangingWebSocket {
      static instance: ManualWebSocket;

      constructor() {
        super();
        ManualWebSocket.instance = this;
        queueMicrotask(() => {
          this.readyState = ManualWebSocket.OPEN;
          this.onopen?.();
        });
      }
    }
    installBrowserGlobals(ManualWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge();
    const events: unknown[] = [];
    bridge.onEvent((event) => events.push(event));
    bridge.connect();
    await Bun.sleep(1);
    sendHello(ManualWebSocket.instance);

    const statusEvent = {
      event: "pane.agent_status_changed",
      data: {
        pane_id: "w1:p1",
        workspace_id: "w1",
        agent_status: "working",
        agent: "pi",
      },
    };
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({
        connection_id: "startup-default",
        ...statusEvent,
      }),
    } as MessageEvent);

    expect(events).toEqual([
      { connection_id: "startup-default", ...statusEvent },
    ]);
  });

  test("routes terminal_closed pushes to closed listeners", async () => {
    class ManualWebSocket extends HangingWebSocket {
      static instance: ManualWebSocket;

      constructor() {
        super();
        ManualWebSocket.instance = this;
        queueMicrotask(() => {
          this.readyState = ManualWebSocket.OPEN;
          this.onopen?.();
        });
      }
    }
    installBrowserGlobals(ManualWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge();
    const closed: unknown[] = [];
    const terminals: unknown[] = [];
    bridge.onTerminalClosed((push) => closed.push(push));
    bridge.onTerminal((terminal) => terminals.push(terminal));
    bridge.connect();
    await Bun.sleep(1);
    sendHello(ManualWebSocket.instance);

    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({
        connection_id: "startup-default",
        terminal_closed: { terminal_id: "term_1", reason: "stream_closed" },
      }),
    } as MessageEvent);

    expect(closed).toEqual([
      {
        connection_id: "startup-default",
        terminal_id: "term_1",
        reason: "stream_closed",
      },
    ]);
    expect(terminals).toEqual([]);
  });

  test("keeps event and terminal listeners compatible with scoped pushes", async () => {
    class ManualWebSocket extends HangingWebSocket {
      static instance: ManualWebSocket;

      constructor() {
        super();
        ManualWebSocket.instance = this;
        queueMicrotask(() => {
          this.readyState = ManualWebSocket.OPEN;
          this.onopen?.();
        });
      }
    }
    installBrowserGlobals(ManualWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge();
    const events: unknown[] = [];
    const terminals: unknown[] = [];
    bridge.onEvent((event) => events.push(event));
    bridge.onTerminal((terminal) => terminals.push(terminal));
    bridge.connect();
    await Bun.sleep(1);
    sendHello(ManualWebSocket.instance);

    const event = {
      event: "workspace.updated",
      data: { type: "workspace", workspace_id: "same" },
    };
    const terminal = {
      terminal_id: "same",
      width: 80,
      height: 24,
      full: true,
      bytes: "",
    };
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({ connection_id: "startup-default", ...event }),
    } as MessageEvent);
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({ connection_id: "startup-default", terminal }),
    } as MessageEvent);

    expect(events).toEqual([
      {
        connection_id: "startup-default",
        ...event,
      },
    ]);
    expect(terminals).toEqual([
      { connection_id: "startup-default", ...terminal },
    ]);
  });

  test("sends explicit identity for downstream calls and none for global calls", async () => {
    class ManualWebSocket extends HangingWebSocket {
      static instance: ManualWebSocket;
      sent: string[] = [];

      constructor() {
        super();
        ManualWebSocket.instance = this;
        queueMicrotask(() => {
          this.readyState = ManualWebSocket.OPEN;
          this.onopen?.();
        });
      }

      send(raw = "") {
        this.sent.push(raw);
      }
    }
    installBrowserGlobals(ManualWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge();
    bridge.connect();
    await Bun.sleep(1);
    sendHello(ManualWebSocket.instance);
    bridge.setActiveConnection("alpha");

    const downstream = bridge.call("workspace.list");
    const global = bridge.call("connections.list");
    const [downstreamRequest, globalRequest] =
      ManualWebSocket.instance.sent.map((raw) => JSON.parse(raw));

    expect(downstreamRequest.connection_id).toBe("alpha");
    expect(globalRequest).not.toHaveProperty("connection_id");
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({
        id: downstreamRequest.id,
        connection_id: "alpha",
        result: { workspaces: [] },
      }),
    } as MessageEvent);
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({
        id: globalRequest.id,
        result: { connections: [] },
      }),
    } as MessageEvent);

    await expect(downstream).resolves.toEqual({ workspaces: [] });
    await expect(global).resolves.toEqual({ connections: [] });
  });

  test("binds scoped clients, replies, and pushes to server runtime generation", async () => {
    class ManualWebSocket extends HangingWebSocket {
      static instance: ManualWebSocket;
      sent: string[] = [];

      constructor() {
        super();
        ManualWebSocket.instance = this;
        queueMicrotask(() => {
          this.readyState = ManualWebSocket.OPEN;
          this.onopen?.();
        });
      }

      send(raw = "") {
        this.sent.push(raw);
      }
    }
    installBrowserGlobals(ManualWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge();
    const events: unknown[] = [];
    const terminals: unknown[] = [];
    const clipboards: unknown[] = [];
    bridge.onEvent((event) => events.push(event));
    bridge.onTerminal((terminal) => terminals.push(terminal));
    bridge.onTerminalClipboard((clipboard) => clipboards.push(clipboard));
    bridge.connect();
    await Bun.sleep(1);
    bridge.setActiveConnection("alpha");
    const clientCreatedBeforeHello = bridge.connection("alpha", 7);
    await expect(
      clientCreatedBeforeHello.call("workspace.list"),
    ).rejects.toThrow("bridge hello is unavailable");
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({
        connection_id: "alpha",
        event: "workspace.updated",
        data: { type: "workspace" },
      }),
    } as MessageEvent);
    expect(events).toEqual([]);
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({
        hello: true,
        bridge_protocol_version: 2,
        default_connection_id: "alpha",
        capabilities: { connection_runtime_generation: true },
      }),
    } as MessageEvent);

    await expect(
      clientCreatedBeforeHello.call("workspace.list"),
    ).rejects.toThrow("connection runtime generation is unavailable");
    const uncataloged = bridge.connection("alpha", 7);
    await expect(uncataloged.call("workspace.list")).rejects.toThrow(
      "connection runtime generation is unavailable",
    );
    expect(ManualWebSocket.instance.sent).toEqual([]);
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({
        connection_id: "alpha",
        connection_generation: 7,
        event: "workspace.updated",
        data: { type: "workspace" },
      }),
    } as MessageEvent);
    expect(events).toEqual([]);
    bridge.setConnectionRuntimeGenerations([{ id: "alpha", generation: 7 }]);
    const client = bridge.connection("alpha", 7);
    const response = client.call("workspace.list");
    const request = JSON.parse(ManualWebSocket.instance.sent[0]);
    expect(request).toMatchObject({
      connection_id: "alpha",
      connection_generation: 7,
    });
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({
        id: request.id,
        connection_id: "alpha",
        connection_generation: 8,
        result: { workspaces: [] },
      }),
    } as MessageEvent);
    await expect(response).rejects.toThrow(
      "response connection_generation mismatch",
    );

    const compatibilityResponse = bridge.call("workspace.list");
    const compatibilityRequest = JSON.parse(ManualWebSocket.instance.sent[1]);
    expect(compatibilityRequest).toMatchObject({
      connection_id: "alpha",
      connection_generation: 7,
    });
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({
        id: compatibilityRequest.id,
        connection_id: "alpha",
        connection_generation: 7,
        result: { workspaces: [] },
      }),
    } as MessageEvent);
    await expect(compatibilityResponse).resolves.toEqual({ workspaces: [] });

    const push = (connectionGeneration: number | undefined) => {
      const identity = {
        connection_id: "alpha",
        ...(connectionGeneration === undefined
          ? {}
          : { connection_generation: connectionGeneration }),
      };
      ManualWebSocket.instance.onmessage?.({
        data: JSON.stringify({
          ...identity,
          event: "workspace.updated",
          data: { type: "workspace" },
        }),
      } as MessageEvent);
      ManualWebSocket.instance.onmessage?.({
        data: JSON.stringify({
          ...identity,
          terminal: {
            terminal_id: "same",
            width: 80,
            height: 24,
            full: true,
            bytes: "",
          },
        }),
      } as MessageEvent);
      ManualWebSocket.instance.onmessage?.({
        data: JSON.stringify({
          ...identity,
          terminal_clipboard: { terminal_id: "same", data: "YQ==" },
        }),
      } as MessageEvent);
    };
    push(undefined);
    push(6);
    push(7);
    expect(events).toEqual([
      expect.objectContaining({
        connection_id: "alpha",
        connection_generation: 7,
      }),
    ]);
    expect(terminals).toEqual([
      expect.objectContaining({
        connection_id: "alpha",
        connection_generation: 7,
        terminal_id: "same",
      }),
    ]);
    expect(clipboards).toEqual([
      expect.objectContaining({
        connection_id: "alpha",
        connection_generation: 7,
        terminal_id: "same",
      }),
    ]);
    expect(client.acceptsServerGeneration(6)).toBe(false);
    expect(client.acceptsServerGeneration(7)).toBe(true);
  });

  test("rejects mismatched scoped replies", async () => {
    class ManualWebSocket extends HangingWebSocket {
      static instance: ManualWebSocket;
      sent: string[] = [];

      constructor() {
        super();
        ManualWebSocket.instance = this;
        queueMicrotask(() => {
          this.readyState = ManualWebSocket.OPEN;
          this.onopen?.();
        });
      }

      send(raw = "") {
        this.sent.push(raw);
      }
    }
    installBrowserGlobals(ManualWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge();
    bridge.connect();
    await Bun.sleep(1);
    sendHello(ManualWebSocket.instance);
    bridge.setActiveConnection("alpha");

    const response = bridge.call("workspace.list");
    const request = JSON.parse(ManualWebSocket.instance.sent[0]);
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({
        id: request.id,
        connection_id: "beta",
        result: { workspaces: [] },
      }),
    } as MessageEvent);

    await expect(response).rejects.toThrow("response connection_id mismatch");
  });

  test("invalidates pending legacy active clients across an active switch", async () => {
    class ManualWebSocket extends HangingWebSocket {
      static instance: ManualWebSocket;
      sent: string[] = [];

      constructor() {
        super();
        ManualWebSocket.instance = this;
        queueMicrotask(() => {
          this.readyState = ManualWebSocket.OPEN;
          this.onopen?.();
        });
      }

      send(raw = "") {
        this.sent.push(raw);
      }
    }
    installBrowserGlobals(ManualWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge();
    bridge.connect();
    await Bun.sleep(1);
    sendHello(ManualWebSocket.instance);
    bridge.setActiveConnection("alpha");
    const alpha = bridge.connection();

    const pending = alpha.call("workspace.list");
    bridge.setActiveConnection("beta");

    await expect(pending).rejects.toThrow("connection changed during request");
    await expect(alpha.call("workspace.list")).rejects.toThrow(
      "connection changed during request",
    );
  });

  test("invalidates legacy active work across a same-ID client generation change", async () => {
    class ManualWebSocket extends HangingWebSocket {
      static instance: ManualWebSocket;
      sent: string[] = [];

      constructor() {
        super();
        ManualWebSocket.instance = this;
        queueMicrotask(() => {
          this.readyState = ManualWebSocket.OPEN;
          this.onopen?.();
        });
      }

      send(raw = "") {
        this.sent.push(raw);
      }
    }
    installBrowserGlobals(ManualWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge();
    bridge.connect();
    await Bun.sleep(1);
    sendHello(ManualWebSocket.instance);
    bridge.setActiveConnection("alpha");
    const alpha = bridge.connection();

    const pending = alpha.call("workspace.list");
    bridge.advanceActiveConnectionGeneration();

    await expect(pending).rejects.toThrow("connection changed during request");
    expect(alpha.isCurrent()).toBe(false);
  });

  test("exposes hello metadata and preserves identities on all scoped pushes", async () => {
    class ManualWebSocket extends HangingWebSocket {
      static instance: ManualWebSocket;

      constructor() {
        super();
        ManualWebSocket.instance = this;
        queueMicrotask(() => {
          this.readyState = ManualWebSocket.OPEN;
          this.onopen?.();
        });
      }
    }
    installBrowserGlobals(ManualWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge();
    const hellos: unknown[] = [];
    const events: unknown[] = [];
    const terminals: unknown[] = [];
    const clipboards: unknown[] = [];
    bridge.onHello((hello) => hellos.push(hello));
    bridge.onEvent((event) => events.push(event));
    bridge.onTerminal((terminal) => terminals.push(terminal));
    bridge.onTerminalClipboard((clipboard) => clipboards.push(clipboard));
    bridge.connect();
    await Bun.sleep(1);

    const hello = {
      hello: true,
      bridge_protocol_version: 2,
      default_connection_id: "alpha",
      capabilities: { connection_id: true, connection_scoped_http: true },
    };
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify(hello),
    } as MessageEvent);
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({
        connection_id: "beta",
        event: "workspace.updated",
        data: { type: "workspace" },
      }),
    } as MessageEvent);
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({
        connection_id: "beta",
        terminal: {
          terminal_id: "same",
          width: 80,
          height: 24,
          full: true,
          bytes: "",
        },
      }),
    } as MessageEvent);
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({
        connection_id: "beta",
        terminal_clipboard: { terminal_id: "same", data: "YQ==" },
      }),
    } as MessageEvent);
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({
        connection_id: "beta",
        terminal: { width: 80, height: 24, full: true, bytes: "ignored" },
        terminal_clipboard: { data: "aWdub3JlZA==" },
      }),
    } as MessageEvent);
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({
        connection_id: "beta",
        event: "workspace.updated",
        data: null,
      }),
    } as MessageEvent);
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({
        connection_id: "beta",
        terminal: {
          terminal_id: "same",
          width: "80",
          height: 24,
          full: true,
          bytes: 7,
        },
      }),
    } as MessageEvent);
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({
        connection_id: "beta",
        terminal_clipboard: { terminal_id: "same", data: 7 },
      }),
    } as MessageEvent);

    expect(hellos).toEqual([hello]);
    expect(bridge.activeConnectionId).toBe("alpha");
    expect(events).toEqual([
      {
        connection_id: "beta",
        event: "workspace.updated",
        data: { type: "workspace" },
      },
    ]);
    expect(terminals).toEqual([
      {
        connection_id: "beta",
        terminal_id: "same",
        width: 80,
        height: 24,
        full: true,
        bytes: "",
      },
    ]);
    expect(clipboards).toEqual([
      { connection_id: "beta", terminal_id: "same", data: "YQ==" },
    ]);
  });

  test("rejects overlapping wire envelopes before they can spoof hello or RPC replies", async () => {
    class ManualWebSocket extends HangingWebSocket {
      static instance: ManualWebSocket;
      sent: string[] = [];

      constructor() {
        super();
        ManualWebSocket.instance = this;
        queueMicrotask(() => {
          this.readyState = ManualWebSocket.OPEN;
          this.onopen?.();
        });
      }

      send(raw = "") {
        this.sent.push(raw);
      }
    }
    installBrowserGlobals(ManualWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge();
    const hellos: unknown[] = [];
    const events: unknown[] = [];
    bridge.onHello((hello) => hellos.push(hello));
    bridge.onEvent((event) => events.push(event));
    bridge.connect();
    await Bun.sleep(1);

    const hello = {
      hello: true,
      bridge_protocol_version: 2,
      default_connection_id: "alpha",
      capabilities: { connection_runtime_generation: true },
    };
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify(hello),
    } as MessageEvent);
    bridge.setConnectionRuntimeGenerations([{ id: "alpha", generation: 7 }]);

    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({
        connection_id: "alpha",
        connection_generation: 7,
        event: "workspace.updated",
        data: { type: "workspace" },
        hello: true,
        bridge_protocol_version: 2,
        default_connection_id: "alpha",
        capabilities: { connection_runtime_generation: false },
      }),
    } as MessageEvent);
    expect(hellos).toEqual([hello]);
    expect(events).toEqual([]);
    expect(bridge.hello?.capabilities.connection_runtime_generation).toBe(true);

    const identityResponse = bridge.call("connections.list");
    const identityRequest = JSON.parse(
      ManualWebSocket.instance.sent[ManualWebSocket.instance.sent.length - 1],
    );
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({
        id: identityRequest.id,
        connection_id: "alpha",
        connection_generation: 7,
        result: { forged: true },
      }),
    } as MessageEvent);
    await expect(identityResponse).rejects.toThrow(
      "global response contains connection identity",
    );

    const malformedResponse = bridge.call("connections.list");
    const malformedRequest = JSON.parse(
      ManualWebSocket.instance.sent[ManualWebSocket.instance.sent.length - 1],
    );
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({ id: malformedRequest.id }),
    } as MessageEvent);
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({ id: malformedRequest.id, error: null }),
    } as MessageEvent);
    await expect(malformedResponse).rejects.toThrow("invalid error response");

    const globalResponse = bridge.call("connections.list");
    const globalRequest = JSON.parse(
      ManualWebSocket.instance.sent[ManualWebSocket.instance.sent.length - 1],
    );
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({
        id: globalRequest.id,
        result: { forged: true },
        connection_id: "alpha",
        connection_generation: 7,
        event: "workspace.updated",
        data: { type: "workspace" },
      }),
    } as MessageEvent);
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({ id: globalRequest.id, result: { trusted: true } }),
    } as MessageEvent);
    await expect(globalResponse).resolves.toEqual({ trusted: true });
    expect(events).toEqual([]);

    const scopedResponse = bridge.call("workspace.list");
    const scopedRequest = JSON.parse(
      ManualWebSocket.instance.sent[ManualWebSocket.instance.sent.length - 1],
    );
    expect(scopedRequest).toMatchObject({
      connection_id: "alpha",
      connection_generation: 7,
    });
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({
        id: scopedRequest.id,
        connection_id: "alpha",
        connection_generation: 7,
        result: { workspaces: [] },
      }),
    } as MessageEvent);
    await expect(scopedResponse).resolves.toEqual({ workspaces: [] });
  });

  test("parses profile-aware catalogs while tolerating transition statuses", () => {
    const base = {
      id: "alpha",
      label: "Alpha",
      source: "local-profile",
      is_default: true,
      state: "ready" as const,
      generation: 3,
    };
    expect(parseConnectionSummary(base)).toEqual(base);
    expect(
      parseConnectionSummary({
        ...base,
        type: "local",
        read_only: false,
        auto_connect: true,
        control_socket_path: "/tmp/control.sock",
        client_socket_path: "/tmp/client.sock",
      }),
    ).toMatchObject({
      type: "local",
      read_only: false,
      auto_connect: true,
      control_socket_path: "/tmp/control.sock",
      client_socket_path: "/tmp/client.sock",
    });
    expect(
      parseConnectionSummary({
        ...base,
        source: "ssh-profile",
        type: "ssh",
        read_only: false,
        auto_connect: false,
        ssh_destination: "operator@dev-box",
        remote_control_socket_path: "/remote/herdr.sock",
        remote_client_socket_path: "/remote/herdr-client.sock",
      }),
    ).toMatchObject({
      type: "ssh",
      ssh_destination: "operator@dev-box",
      remote_control_socket_path: "/remote/herdr.sock",
      remote_client_socket_path: "/remote/herdr-client.sock",
    });
    expect(
      parseConnectionSummary({
        ...base,
        source: "ssh-profile",
        type: "ssh",
        read_only: false,
        auto_connect: false,
        ssh_destination: "operator@dev-box",
        remote_control_socket_path: "",
        remote_client_socket_path: "",
      }),
    ).toMatchObject({
      type: "ssh",
      remote_control_socket_path: "",
      remote_client_socket_path: "",
    });
    for (const invalidSsh of [
      {
        type: "ssh",
        ssh_destination: "operator@dev-box",
      },
      {
        type: "ssh",
        read_only: false,
        auto_connect: false,
        ssh_destination: "@dev-box",
        remote_control_socket_path: "/remote/herdr.sock",
        remote_client_socket_path: "/remote/herdr-client.sock",
      },
      {
        type: "ssh",
        read_only: false,
        auto_connect: false,
        ssh_destination: "operator@dev-box",
        remote_control_socket_path: "/remote/herdr.sock",
        remote_client_socket_path: "/remote/herdr.sock",
      },
      {
        type: "ssh",
        read_only: false,
        auto_connect: false,
        ssh_destination: "operator@dev-box",
        remote_control_socket_path: "/remote/herdr.sock",
        remote_client_socket_path: "/remote/herdr-client.sock",
        control_socket_path: "/tmp/forged.sock",
      },
    ]) {
      expect(parseConnectionSummary({ ...base, ...invalidSsh })).toBeNull();
    }
    expect(parseConnectionSummary({ ...base, type: "unknown" })).toBeNull();
    expect(parseConnectionSummary({ ...base, state: "bogus" })).toBeNull();
  });

  test("probeConnectionNow is a no-op while disconnected", () => {
    installBrowserGlobals(HangingWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge();
    expect(() => bridge.probeConnectionNow()).not.toThrow();
    expect(bridge.status).toBe("disconnected");
  });

  test("probeConnectionNow drops a socket that closed without a close event", async () => {
    class FrozenWebSocket extends HangingWebSocket {
      static instances: FrozenWebSocket[] = [];

      constructor() {
        super();
        FrozenWebSocket.instances.push(this);
        queueMicrotask(() => {
          this.readyState = FrozenWebSocket.OPEN;
          this.onopen?.();
        });
      }

      // Simulates the OS killing the socket while the page was frozen: the
      // readyState moves on but no close event is ever delivered.
      closeSilently() {
        this.readyState = FrozenWebSocket.CLOSED;
      }
    }
    installBrowserGlobals(FrozenWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge(50, 1);
    bridge.connect();
    await Bun.sleep(1);
    sendHello(FrozenWebSocket.instances[0]);
    expect(bridge.status).toBe("connected");

    FrozenWebSocket.instances[0].closeSilently();
    bridge.probeConnectionNow();
    expect(bridge.status).toBe("disconnected");

    await Bun.sleep(10);
    expect(FrozenWebSocket.instances.length).toBe(2);
  });

  test("does not advance the client generation twice when a probe rejects during teardown", async () => {
    class ProbedWebSocket extends HangingWebSocket {
      static instance: ProbedWebSocket;
      sent: string[] = [];

      constructor() {
        super();
        ProbedWebSocket.instance = this;
        queueMicrotask(() => {
          this.readyState = ProbedWebSocket.OPEN;
          this.onopen?.();
        });
      }

      send(raw = "") {
        this.sent.push(raw);
      }
    }
    installBrowserGlobals(ProbedWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge(50);
    bridge.connect();
    await Bun.sleep(1);
    sendHello(ProbedWebSocket.instance);
    const generation = bridge.clientGeneration;

    // Simulate the frozen-page resume burst: a heartbeat probe goes out on
    // the zombie socket, then the delayed close event arrives. rejectPending
    // rejects the probe, whose handler must not force a second teardown.
    bridge.probeConnectionNow();
    expect(ProbedWebSocket.instance.sent.length).toBe(1);
    ProbedWebSocket.instance.onclose?.();
    await Bun.sleep(1);

    expect(bridge.clientGeneration).toBe(generation + 1);
  });

  test("handleDisconnect stays idempotent once the socket is fully torn down", async () => {
    class OpeningWebSocket extends HangingWebSocket {
      static instance: OpeningWebSocket;

      constructor() {
        super();
        OpeningWebSocket.instance = this;
        queueMicrotask(() => {
          this.readyState = OpeningWebSocket.OPEN;
          this.onopen?.();
        });
      }
    }
    installBrowserGlobals(OpeningWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge(50);
    bridge.connect();
    await Bun.sleep(1);
    sendHello(OpeningWebSocket.instance);
    const generation = bridge.clientGeneration;

    OpeningWebSocket.instance.onclose?.();
    expect(bridge.clientGeneration).toBe(generation + 1);

    // A repeated teardown with no live socket must not advance the client
    // generation again: status handlers only fire on transitions, so
    // generation-scoped clients captured the first advance and would never
    // learn a second one.
    const internals = bridge as unknown as {
      handleDisconnect(ws: WebSocket | null, reason: string): void;
    };
    internals.handleDisconnect(null, "stale repeated teardown");
    expect(bridge.clientGeneration).toBe(generation + 1);
  });

  test("probeConnectionNow pings an open socket and stays connected on reply", async () => {
    class ProbedWebSocket extends HangingWebSocket {
      static instance: ProbedWebSocket;
      sent: string[] = [];

      constructor() {
        super();
        ProbedWebSocket.instance = this;
        queueMicrotask(() => {
          this.readyState = ProbedWebSocket.OPEN;
          this.onopen?.();
        });
      }

      send(raw = "") {
        this.sent.push(raw);
      }
    }
    installBrowserGlobals(ProbedWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge(50);
    bridge.connect();
    await Bun.sleep(1);
    sendHello(ProbedWebSocket.instance);

    bridge.probeConnectionNow();
    expect(ProbedWebSocket.instance.sent.length).toBe(1);
    const ping = JSON.parse(ProbedWebSocket.instance.sent[0]);
    expect(ping.method).toBe("bridge.ping");

    ProbedWebSocket.instance.onmessage?.({
      data: JSON.stringify({ id: ping.id, result: { ok: true } }),
    } as MessageEvent);
    await Bun.sleep(5);
    expect(bridge.status).toBe("connected");
  });
});
