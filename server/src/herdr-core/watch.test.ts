import { describe, expect, test } from "bun:test";
import {
  acceptWatchReply,
  CoreClient,
  CoreWatchRefusedError,
  watchAttachParams,
} from "./client";
import { memoryStreamPair } from "./stream";
import { FakeCore, type FakeCoreOptions } from "./testing/fake-core";
import { FrameDecoder, FrameKind, STREAM_WINDOW } from "./wire";

type Seen = { grid: [number, number] } | { data: string } | { closed: string };

/** A World client watching a fake core, with every outbound frame decoded. */
async function watching(options: FakeCoreOptions = {}) {
  const fake = new FakeCore({ heartbeatMs: 60_000, ...options });
  fake.revive();
  const [server, world] = memoryStreamPair();
  fake.accept(server);
  const outbound: Array<{ channel: number; kind: number }> = [];
  const decoder = new FrameDecoder();
  let framed = false;
  const client = await CoreClient.open(world, {
    onOutbound: (bytes) => {
      // The hello line is plain; everything after it is framed.
      if (!framed) {
        framed = true;
        return;
      }
      for (const f of decoder.push(bytes))
        outbound.push({ channel: f.channel, kind: f.kind });
    },
  });
  return { fake, client, outbound };
}

function recorder() {
  const seen: Seen[] = [];
  const text = new TextDecoder();
  return {
    seen,
    sink: {
      resize: (cols: number, rows: number) => seen.push({ grid: [cols, rows] }),
      data: (bytes: Uint8Array) =>
        seen.push({ data: text.decode(bytes, { stream: true }) }),
      close: (reason: string) => seen.push({ closed: reason }),
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("watching a core terminal", () => {
  test("adopts the desktop pane's grid before the first paint and never sizes it", async () => {
    const { fake, client, outbound } = await watching();
    const t = fake.create({ name: "agent" });
    fake.output(t, "hello € world\r\n");
    fake.desktopAttach(t, 120, 40);
    const { seen, sink } = recorder();
    const watch = await client.watch(t, { cols: 120, rows: 40 }, sink);
    await settle();
    expect(watch.terminal).toMatchObject({ cols: 120, rows: 40 });
    expect(seen[0]).toEqual({ grid: [120, 40] });
    const paint = seen[1] as { data: string };
    expect(paint.data.startsWith("\x18")).toBe(true);
    expect(paint.data).toContain("hello € world");
    // The desktop pane resizes: the new grid arrives before its repaint.
    fake.desktopResize(t, 90, 25);
    fake.output(t, "after\r\n");
    await settle();
    const tail = seen.slice(2);
    expect(tail[0]).toEqual({ grid: [90, 25] });
    expect((tail[1] as { data: string }).data.startsWith("\x18")).toBe(true);
    expect(tail[2]).toEqual({ data: "after\r\n" });
    expect(fake.terminal(t)).toMatchObject({ cols: 90, rows: 25 });
    watch.credit(4096);
    watch.detach();
    await settle();
    // World sent core nothing on this stream but CREDIT and CLOSE.
    const own = outbound.filter((f) => f.channel === watch.channel);
    expect(new Set(own.map((f) => f.kind))).toEqual(
      new Set([FrameKind.CREDIT, FrameKind.CLOSE]),
    );
    expect(fake.viewerFrames.map((f) => f.kind)).toEqual([FrameKind.CLOSE]);
    expect(fake.viewersOf(t)).toEqual([]);
    // Leaving changed nothing for the desktop pane either.
    expect(fake.terminal(t)).toMatchObject({ cols: 90, rows: 25 });
    expect(
      fake.calls
        .filter((c) => c.method === "terminal.attach")
        .map((c) => c.params),
    ).toEqual([
      {
        terminal: t,
        observe: true,
        resize_notifications: true,
        cols: 120,
        rows: 40,
        history: 500,
      },
    ]);
    expect(watchAttachParams(t, { cols: 1, rows: 1 })).not.toHaveProperty(
      "caller",
    );
  });

  test("an observer alone moves an unviewed terminal to core's headless grid (documented exception)", async () => {
    const { fake, client } = await watching();
    const t = fake.create({ name: "quiet", cols: 100, rows: 30 });
    const { seen, sink } = recorder();
    const watch = await client.watch(t, { cols: 100, rows: 30 }, sink);
    await settle();
    expect(watch.terminal).toMatchObject({ cols: 200, rows: 120 });
    expect(seen[0]).toEqual({ grid: [200, 120] });
    // A desktop pane opening later takes the size; the watch follows it.
    fake.desktopAttach(t, 80, 24);
    await settle();
    expect(seen.at(-2)).toEqual({ grid: [80, 24] });
    // And closing it goes headless again, announced first.
    fake.desktopDetach(t);
    await settle();
    expect(seen.at(-2)).toEqual({ grid: [200, 120] });
    watch.detach();
  });

  test("a path that cannot confirm resize notifications is refused and closed", async () => {
    const { fake, client, outbound } = await watching({
      denyResizeNotifications: true,
    });
    const t = fake.create({ name: "agent" });
    fake.desktopAttach(t, 120, 40);
    const { seen, sink } = recorder();
    await expect(
      client.watch(t, { cols: 120, rows: 40 }, sink),
    ).rejects.toBeInstanceOf(CoreWatchRefusedError);
    await settle();
    expect(seen).toEqual([]);
    expect(fake.viewersOf(t)).toEqual([]);
    expect(
      outbound.some((f) => f.channel === 1 && f.kind === FrameKind.CLOSE),
    ).toBe(true);
    expect(() => acceptWatchReply({ channel: 3, terminal: {} })).toThrow(
      CoreWatchRefusedError,
    );
  });

  test("frames that overtake the reply are held and delivered in core's order", async () => {
    const { fake, client } = await watching({ attachFramesFirst: true });
    const t = fake.create({ name: "agent" });
    fake.output(t, "screen");
    fake.desktopAttach(t, 70, 20);
    const { seen, sink } = recorder();
    await client.watch(t, { cols: 70, rows: 20 }, sink);
    await settle();
    expect(seen[0]).toEqual({ grid: [70, 20] });
    expect((seen[1] as { data: string }).data).toContain("screen");
  });

  test("a stalled stream holds its new grid until credit, then repaints instead of the backlog", async () => {
    const { fake, client } = await watching();
    const t = fake.create({ name: "agent" });
    fake.desktopAttach(t, 120, 40);
    const { seen, sink } = recorder();
    const watch = await client.watch(t, { cols: 120, rows: 40 }, sink);
    await settle();
    // No credit is paid: core stops at the 256 KiB window.
    const line = `${"x".repeat(1023)}\n`;
    for (let i = 0; i < 400; i++) fake.output(t, line);
    await settle();
    const received = () =>
      seen.reduce(
        (n, s) =>
          n + ("data" in s ? new TextEncoder().encode(s.data).length : 0),
        0,
      );
    expect(received()).toBeLessThanOrEqual(STREAM_WINDOW);
    fake.desktopResize(t, 100, 30);
    await settle();
    // Stalled: the RESIZE waits for credit with its paint.
    expect(seen.some((s) => "grid" in s && s.grid[0] === 100)).toBe(false);
    const before = seen.length;
    watch.credit(received());
    await settle();
    const after = seen.slice(before);
    expect(after[0]).toEqual({ grid: [100, 30] });
    expect((after[1] as { data: string }).data.startsWith("\x18")).toBe(true);
    // The superseded backlog never arrives: only the repaint of the screen.
    const repaint = after
      .slice(1)
      .reduce((n, s) => n + ("data" in s ? s.data.length : 0), 0);
    expect(repaint).toBeLessThan(20_000);
    watch.detach();
  });

  test("loss of the program ends the stream with core's reason; EOF ends it too", async () => {
    const { fake, client } = await watching();
    const t = fake.create({ name: "agent", keep: true });
    const { seen, sink } = recorder();
    await client.watch(t, { cols: 200, rows: 120 }, sink);
    fake.replaceWithShell(t);
    await settle();
    expect(seen.at(-1)).toEqual({
      closed: '{"reason":"signaled","exit_code":null}',
    });

    const second = recorder();
    await client.watch(t, { cols: 200, rows: 120 }, second.sink);
    fake.kill();
    await settle();
    expect(client.closed).toBe(true);
    expect(second.seen.at(-1)).toMatchObject({ closed: expect.any(String) });
  });

  test("after a detach, frames still in flight are dropped and never pile up", async () => {
    const { fake, client } = await watching();
    const t = fake.create({ name: "agent" });
    const { seen, sink } = recorder();
    const watch = await client.watch(t, { cols: 200, rows: 120 }, sink);
    await settle();
    const count = seen.length;
    watch.detach();
    // Output written before core processes the CLOSE.
    fake.output(t, "late");
    await settle();
    expect(seen.length).toBe(count);
    expect(client.closed).toBe(false);
    // The connection stays healthy for the next watch.
    const again = recorder();
    await client.watch(t, { cols: 200, rows: 120 }, again.sink);
    await settle();
    expect(again.seen[0]).toEqual({ grid: [200, 120] });
  });

  test("a core without attach is refused before anything is sent", async () => {
    const [server, world] = memoryStreamPair();
    const fake = new FakeCore();
    fake.revive();
    fake.accept(server);
    const client = await CoreClient.open(world);
    Object.assign(client.hello, {
      features: client.hello.features.filter(
        (f) => f !== "resize_notifications",
      ),
    });
    await expect(
      client.watch("t1", { cols: 80, rows: 24 }, recorder().sink),
    ).rejects.toThrow("lacks resize_notifications");
    expect(fake.calls.some((c) => c.method === "terminal.attach")).toBe(false);
  });
});
