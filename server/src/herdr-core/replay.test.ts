import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CoreClient } from "./client";
import { CoreMirror } from "./mirror";
import { memoryStreamPair } from "./stream";
import type { CoreRecording } from "./testing/capture-core";
import { FakeCore } from "./testing/fake-core";
import { FrameDecoder, FrameKind } from "./wire";

const recording: CoreRecording = JSON.parse(
  readFileSync(
    join(import.meta.dir, "testing/recorded/core-0.1.20.json"),
    "utf8",
  ),
);

/** Byte offset after which reply `id` is complete, for each call id. */
function replyGates(bytes: Uint8Array): Map<number, number> {
  const gates = new Map<number, number>();
  const start = bytes.indexOf(0x0a) + 1;
  gates.set(0, start);
  const decoder = new FrameDecoder();
  for (let at = start; at < bytes.byteLength; at++) {
    for (const frame of decoder.push(bytes.subarray(at, at + 1))) {
      if (frame.channel !== 0 || frame.kind !== FrameKind.DATA) continue;
      const id = JSON.parse(new TextDecoder().decode(frame.payload)).id;
      gates.set(id, at + 1);
    }
  }
  return gates;
}

type Split = "recorded" | number | "random";

/**
 * Plays one recorded connection to a real CoreClient: inbound bytes are
 * released up to each reply as World sends the matching call, then the rest,
 * then EOF if the core died. Chunking follows `split`.
 */
async function replay(index: number, split: Split, seed = 1) {
  const connection = recording.connections[index]!;
  const chunks = connection.inbound.map(
    (b) => new Uint8Array(Buffer.from(b, "base64")),
  );
  const bytes = new Uint8Array(Buffer.concat(chunks));
  const gates = replyGates(bytes);
  const [core, world] = memoryStreamPair();
  let released = 0;
  let random = seed;
  const piece = (limit: number) => {
    if (split === "random") {
      random = (random * 1103515245 + 12345) % 2 ** 31;
      return 1 + (random % 97);
    }
    return typeof split === "number" ? split : limit;
  };
  const boundaries: number[] = [];
  let edge = 0;
  for (const chunk of chunks) boundaries.push((edge += chunk.byteLength));
  const release = (until: number) => {
    while (released < until) {
      const next =
        split === "recorded"
          ? Math.min(until, boundaries.find((b) => b > released)!)
          : Math.min(until, released + piece(until - released));
      core.write(bytes.subarray(released, next));
      released = next;
    }
  };
  let calls = 0;
  const credits = new Map<number, number>();
  const decoder = new FrameDecoder();
  let sawHello = false;
  core.onData((out) => {
    if (!sawHello) {
      sawHello = true;
      release(gates.get(0)!);
      return;
    }
    for (const frame of decoder.push(out)) {
      if (frame.kind === FrameKind.CREDIT) {
        const n = new DataView(
          frame.payload.buffer,
          frame.payload.byteOffset,
          4,
        ).getUint32(0, true);
        credits.set(frame.channel, (credits.get(frame.channel) ?? 0) + n);
      } else if (frame.channel === 0) {
        calls += 1;
        release(gates.get(calls)!);
      }
    }
  });
  const client = await CoreClient.open(world);
  const mirror = new CoreMirror();
  const outcomes: string[] = [];
  let eventBytes = 0;
  await client.status();
  const { channel } = await client.subscribe({
    baseline: (seq, terminals) => {
      mirror.baseline(seq, terminals);
    },
    line: (line) => {
      eventBytes += new TextEncoder().encode(
        `${JSON.stringify(line)}\n`,
      ).byteLength;
      outcomes.push(`${line.method}:${mirror.apply(line)}`);
    },
    end: () => {},
  });
  if (connection.calls.includes("terminal.read t1"))
    expect(await client.readScreen("t1")).toEqual({
      complete: true,
      how: "screen",
      text: "$",
    });
  release(bytes.byteLength);
  if (index === 0) core.close();
  await Bun.sleep(5);
  return {
    client,
    mirror,
    outcomes,
    credits: credits.get(channel) ?? 0,
    eventBytes,
    calls,
  };
}

describe("recorded herdr-core 0.1.20 traffic", () => {
  test("the recording is synthetic: no real host, user or path", () => {
    const text = JSON.stringify(
      recording.connections.map((c) =>
        c.inbound.map((b) => Buffer.from(b, "base64").toString("utf8")),
      ),
    );
    expect(text).toContain("example-host");
    expect(text).not.toMatch(/\/home\/|\/Users\//);
    expect(recording.core_version).toBe("0.1.20");
  });

  for (const split of ["recorded", 1, 2, 3, 7, "random"] as const) {
    test(`replays to the same mirror with ${split}-byte reads`, async () => {
      const first = await replay(0, split);
      expect(
        first.outcomes.every(
          (o) => o.endsWith(":applied") || o.endsWith(":alive"),
        ),
      ).toBe(true);
      expect(
        first.outcomes.filter((o) => o.startsWith("heartbeat")).length,
      ).toBeGreaterThan(0);
      expect(first.mirror.cursor).toBe(7);
      expect(first.mirror.terminal("t1")).toMatchObject({
        name: "agent",
        keep: true,
        labels: { note: "café ü✓ 漢字" },
        reported: true,
        status: null,
        turn: 1,
        foreground: { name: "sh" },
      });
      // Every consumed event byte was credited back to core.
      expect(first.credits).toBeGreaterThan(0);
      expect(first.client.closed).toBe(true);

      const second = await replay(1, split);
      expect(second.mirror.cursor).toBe(1);
      const before = first.mirror.terminal("t1")!;
      const after = second.mirror.terminal("t1")!;
      // kill -9 of core: the same terminal at the same address, same program.
      expect(after.address).toBe(before.address);
      expect(after.pid).toBe(before.pid);
      expect(after.screen).toBe("inexact");
      expect(second.mirror.actionable).toBe(true);
    });
  }
});

describe("the fake core matches the recorded core", () => {
  const project = (mirror: CoreMirror) =>
    mirror.terminals().map((t) => ({
      address: t.address,
      name: t.name,
      keep: t.keep,
      labels: t.labels,
      reported: t.reported,
      status: t.status,
      turn: t.turn,
      state: t.state,
      foreground: (t.foreground as { name?: string } | undefined)?.name,
    }));

  test("the same scenario yields the same mirror", async () => {
    const real = await replay(0, "recorded");
    const fake = new FakeCore({ splitWritesAt: 5 });
    fake.revive();
    const [server, world] = memoryStreamPair();
    fake.accept(server);
    const client = await CoreClient.open(world);
    const mirror = new CoreMirror();
    await client.subscribe({
      baseline: (seq, terminals) => {
        mirror.baseline(seq, terminals);
      },
      line: (line) => {
        mirror.apply(line);
      },
      end: () => {},
    });
    const t1 = fake.create({
      name: "agent",
      keep: true,
      argv: ["sh", "-c", "agent"],
      reported: false,
    });
    fake.status(t1, "working");
    fake.status(t1, "done");
    fake.terminal(t1)!.turn = 1;
    // Core's own order: done, the turn, cleared status, the shell foreground.
    (
      fake as unknown as {
        emit(type: string, address: string, data: unknown): void;
      }
    ).emit("turn", t1, { turn: 1, state: "done" });
    fake.status(t1, null);
    (
      fake as unknown as {
        emit(type: string, address: string, data: unknown): void;
      }
    ).emit("foreground", t1, {
      pid: 1,
      name: "sh",
      argv: ["sh"],
      cwd: "/tmp/example",
    });
    fake.label(t1, { note: "café ü✓ 漢字" });
    fake.heartbeatNow();
    await Bun.sleep(10);
    expect(mirror.cursor).toBe(real.mirror.cursor);
    expect(project(mirror)).toEqual(project(real.mirror));
    client.close();
  });
});
