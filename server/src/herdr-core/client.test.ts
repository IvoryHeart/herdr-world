import { describe, expect, test } from "bun:test";
import {
  CoreClient,
  CoreIncompatibleError,
  type CoreEventLine,
  localAddress,
} from "./client";
import { CoreMirror } from "./mirror";
import { memoryStreamPair } from "./stream";
import { FakeCore } from "./testing/fake-core";
import { encodeFrame, FrameDecoder, FrameKind } from "./wire";

const json = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
const helloResult = (overrides: Record<string, unknown> = {}) => ({
  generation: 1,
  version: "0.1.20",
  core: { id: "c0ffee0000000001", name: "example-host" },
  framed: true,
  methods: [
    "server.status",
    "terminal.list",
    "terminal.get",
    "terminal.read",
    "events.subscribe",
  ],
  features: ["framed", "events"],
  ...overrides,
});

async function connected(splitWritesAt?: number) {
  const fake = new FakeCore({ splitWritesAt, heartbeatMs: 60_000 });
  fake.revive();
  const [server, world] = memoryStreamPair();
  fake.accept(server);
  const client = await CoreClient.open(world);
  const mirror = new CoreMirror();
  const lines: CoreEventLine[] = [];
  let ended: Error | null = null;
  await client.subscribe({
    baseline: (seq, terminals) => {
      mirror.baseline(seq, terminals);
    },
    line: (line) => {
      lines.push(line);
      mirror.apply(line);
    },
    end: (error) => {
      ended = error;
    },
  });
  return { fake, client, mirror, lines, ended: () => ended };
}

describe("core client", () => {
  test("holds stream frames that overtake the subscribe reply, then applies them after the snapshot", async () => {
    const [core, world] = memoryStreamPair();
    const decoder = new FrameDecoder();
    let hello = false;
    core.onData((bytes) => {
      if (!hello) {
        hello = true;
        core.write(json({ jsonrpc: "2.0", id: 0, result: helloResult() }));
        core.write(new Uint8Array([0x0a]));
        return;
      }
      for (const frame of decoder.push(bytes)) {
        if (frame.channel !== 0) continue;
        const request = JSON.parse(new TextDecoder().decode(frame.payload));
        // Core registers the subscriber, an event lands on its channel, and
        // only then is the reply written.
        core.write(
          encodeFrame(
            1,
            FrameKind.DATA,
            json({
              jsonrpc: "2.0",
              method: "event",
              params: {
                seq: 4,
                type: "title",
                terminal: "t1",
                data: { title: "after" },
              },
            }),
          ),
        );
        core.write(encodeFrame(1, FrameKind.DATA, new Uint8Array([0x0a])));
        core.write(
          encodeFrame(
            0,
            FrameKind.DATA,
            json({
              jsonrpc: "2.0",
              id: request.id,
              result: {
                seq: 3,
                channel: 1,
                terminals: [
                  {
                    address: "t1",
                    labels: {},
                    argv: [],
                    state: "live",
                    title: "snap",
                  },
                ],
              },
            }),
          ),
        );
      }
    });
    const client = await CoreClient.open(world);
    const mirror = new CoreMirror();
    await client.subscribe({
      baseline: (seq, terminals) => {
        mirror.baseline(seq, terminals);
      },
      line: (line) => {
        expect(mirror.apply(line)).toBe("applied");
      },
      end: () => {},
    });
    expect(mirror.terminal("t1")?.title).toBe("after");
    expect(mirror.cursor).toBe(4);
  });

  test("refuses another protocol generation, unframed hello and missing methods", async () => {
    for (const result of [
      helloResult({ generation: 2 }),
      helloResult({ framed: false }),
      helloResult({ methods: ["server.status"] }),
    ]) {
      const [core, world] = memoryStreamPair();
      core.onData(() => {
        core.write(json({ jsonrpc: "2.0", id: 0, result }));
        core.write(new Uint8Array([0x0a]));
      });
      await expect(CoreClient.open(world)).rejects.toBeInstanceOf(
        CoreIncompatibleError,
      );
    }
  });

  test("EOF mid-call rejects the call and ends the event stream", async () => {
    const { fake, client, ended } = await connected();
    const pending = client.readScreen(fake.create());
    fake.kill();
    await expect(pending).rejects.toThrow();
    await Bun.sleep(1);
    expect(client.closed).toBe(true);
    expect(ended()?.message).toContain("event stream closed");
  });

  test("a garbled line (a backlog tail dropped by core) ends the connection", async () => {
    const { fake, client } = await connected();
    fake.injectEventBytes(
      new TextEncoder().encode('{"jsonrpc":"2.0","method":"ev'),
    );
    fake.create();
    await Bun.sleep(5);
    expect(client.closed).toBe(true);
    expect((await client.whenClosed()).message).toContain("lost line framing");
  });

  test("credits keep a stream flowing past the 256 KiB window", async () => {
    const { fake, mirror, lines } = await connected(4096);
    const t1 = fake.create();
    for (let i = 0; i < 400; i++)
      fake.label(t1, { [`k${i % 4}`]: "x".repeat(900) + i });
    await Bun.sleep(50);
    expect(lines.length).toBe(401);
    expect(mirror.cursor).toBe(401);
    expect(mirror.actionable).toBe(true);
  });

  test("without credit the stream stalls at the window (the control for the test above)", async () => {
    const fake = new FakeCore();
    fake.revive();
    const [server, raw] = memoryStreamPair();
    fake.accept(server);
    let received = 0;
    const decoder = new FrameDecoder();
    let framed = false;
    raw.onData((bytes) => {
      if (!framed) {
        framed = true;
        return;
      }
      for (const frame of decoder.push(bytes))
        if (frame.channel === 1) received += frame.payload.byteLength;
    });
    raw.write(
      new TextEncoder().encode(
        '{"jsonrpc":"2.0","id":0,"method":"hello","params":{"framed":true}}\n',
      ),
    );
    await Bun.sleep(1);
    raw.write(
      encodeFrame(
        0,
        FrameKind.DATA,
        json({ jsonrpc: "2.0", id: 1, method: "events.subscribe", params: {} }),
      ),
    );
    await Bun.sleep(1);
    const t1 = fake.create();
    for (let i = 0; i < 400; i++) fake.label(t1, { k: "x".repeat(900) + i });
    await Bun.sleep(20);
    expect(received).toBe(256 * 1024);
  });

  test("an oversized missed is dropped silently; the next heartbeat exposes it", async () => {
    const { fake, mirror } = await connected();
    const t1 = fake.create();
    await Bun.sleep(1);
    fake.label(t1, { huge: "x".repeat(5 << 20) });
    fake.heartbeatNow();
    await Bun.sleep(20);
    expect(mirror.terminal(t1)?.labels).toEqual({});
    expect(mirror.actionable).toBe(false);
    expect(mirror.retired).toBe("heartbeat-jump");
  });

  test("direct connections address only local terminals", () => {
    expect(localAddress("t12")).toBe("t12");
    for (const bad of ["rohan/t7", "t0", "t1/x", "..", "t1 ", "@t1"])
      expect(() => localAddress(bad)).toThrow("not a local terminal address");
  });

  test("background reads ask for the screen only (lines: 0) and never send caller", async () => {
    const { fake, client } = await connected();
    const t1 = fake.create();
    await client.readScreen(t1);
    await client.status();
    const sent = fake.calls.filter((c) => c.method !== "hello");
    expect(sent.find((c) => c.method === "terminal.read")?.params).toEqual({
      terminal: t1,
      lines: 0,
    });
    for (const call of sent)
      expect(JSON.stringify(call.params)).not.toContain("caller");
    expect(sent.map((c) => c.method).sort()).toEqual([
      "events.subscribe",
      "server.status",
      "terminal.read",
    ]);
  });

  test("attach: frames core writes after World leaves are dropped uncredited, never held as unclaimed", async () => {
    const [core, world] = memoryStreamPair();
    const decoder = new FrameDecoder();
    const credits: number[] = [];
    let hello = false;
    core.onData((bytes) => {
      if (!hello) {
        hello = true;
        core.write(
          json({
            jsonrpc: "2.0",
            id: 0,
            result: helloResult({
              methods: [...helloResult().methods, "terminal.attach"],
              features: ["framed", "events", "attach"],
            }),
          }),
        );
        core.write(new Uint8Array([0x0a]));
        return;
      }
      for (const frame of decoder.push(bytes)) {
        if (frame.kind === FrameKind.CREDIT)
          credits.push(
            new DataView(
              frame.payload.buffer,
              frame.payload.byteOffset,
            ).getUint32(0, true),
          );
        if (frame.channel === 7 && frame.kind === FrameKind.CLOSE) {
          // Output already in flight when core reads World's CLOSE: more
          // than the unclaimed limit, then core's own CLOSE.
          for (let i = 0; i < 10; i++)
            core.write(encodeFrame(7, FrameKind.DATA, new Uint8Array(1 << 20)));
          core.write(encodeFrame(7, FrameKind.CLOSE));
        }
        if (frame.channel !== 0) continue;
        const request = JSON.parse(new TextDecoder().decode(frame.payload));
        core.write(
          encodeFrame(
            0,
            FrameKind.DATA,
            json({
              jsonrpc: "2.0",
              id: request.id,
              result: {
                channel: 7,
                terminal: {
                  address: "t3",
                  labels: {},
                  argv: [],
                  state: "live",
                },
                resize_notifications: false,
                automatic_input: true,
              },
            }),
          ),
        );
        core.write(
          encodeFrame(7, FrameKind.DATA, new TextEncoder().encode("$ ")),
        );
      }
    });
    const client = await CoreClient.open(world);
    expect(client.offersFloatShells).toBe(false);
    const seen: string[] = [];
    const ends: string[] = [];
    const attachment = await client.attach(
      "t3",
      { cols: 80, rows: 24 },
      {
        data: (bytes) => seen.push(new TextDecoder().decode(bytes)),
        end: (reason) => ends.push(reason),
      },
    );
    await Bun.sleep(5);
    expect(seen).toEqual(["$ "]);
    // Nothing is credited until the consumer says it delivered the bytes.
    expect(credits).toEqual([]);
    attachment.credit(2);
    attachment.detach();
    attachment.detach();
    await Bun.sleep(20);
    expect(ends).toEqual(["detached"]);
    expect(seen).toEqual(["$ "]);
    expect(credits).toEqual([2]);
    expect(client.closed).toBe(false);
    client.close();
  });

  test("attach: a connection that ends mid-stream ends the viewer once", async () => {
    const { fake, client } = await connected();
    const address = fake.create({ name: "shell" });
    const ends: string[] = [];
    await client.attach(
      address,
      { cols: 80, rows: 24 },
      {
        data: () => {},
        end: (reason) => ends.push(reason),
      },
    );
    fake.kill();
    await Bun.sleep(10);
    expect(ends.length).toBe(1);
    expect(client.closed).toBe(true);
  });
});
