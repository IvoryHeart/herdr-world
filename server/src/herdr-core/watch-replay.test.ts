import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type CoreTerminalPush,
  CoreWatchScreen,
} from "../../../web/src/coreWatch";
import { CoreClient } from "./client";
import { memoryStreamPair } from "./stream";
import type { CoreRecording } from "./testing/capture-core";
import { FrameDecoder, FrameKind } from "./wire";

/**
 * Replays bytes a real herdr-core 0.1.20 sent while World watched an agent
 * whose desktop pane attached at 120x40, resized to 90x25 and closed, with a
 * 4-byte character split across writes and a kill -9 of core at the end.
 * World's production client and page model consume it in any chunking.
 */
const recording: CoreRecording = JSON.parse(
  readFileSync(
    join(import.meta.dir, "testing/recorded/core-0.1.20-watch.json"),
    "utf8",
  ),
);
const inbound = recording.connections[0]!.inbound.map(
  (b) => new Uint8Array(Buffer.from(b, "base64")),
);
const bytes = new Uint8Array(Buffer.concat(inbound));
const helloEnd = bytes.indexOf(0x0a) + 1;

type Split = "recorded" | number | "random";

async function replay(split: Split, seed = 7) {
  const [core, world] = memoryStreamPair();
  const sent: Uint8Array[] = [];
  let random = seed;
  const piece = (limit: number) => {
    if (split === "random") {
      random = (random * 1103515245 + 12345) % 2 ** 31;
      return 1 + (random % 61);
    }
    return typeof split === "number" ? split : limit;
  };
  const release = (from: number, to: number) => {
    if (split === "recorded") {
      // The slices exactly as read from the socket.
      let at = 0;
      for (const chunk of inbound) {
        const end = at + chunk.byteLength;
        const lo = Math.max(at, from);
        const hi = Math.min(end, to);
        if (lo < hi) core.write(bytes.subarray(lo, hi));
        at = end;
      }
      return;
    }
    for (let at = from; at < to; ) {
      const next = Math.min(to, at + piece(to - at));
      core.write(bytes.subarray(at, next));
      at = next;
    }
  };
  let calls = 0;
  core.onData((data) => {
    sent.push(data.slice());
    calls++;
    // Hello first; everything else once World asks to watch.
    if (calls === 1) release(0, helloEnd);
    if (calls === 2) {
      release(helloEnd, bytes.byteLength);
      queueMicrotask(() => setTimeout(() => core.close(), 5));
    }
  });
  const client = await CoreClient.open(world);
  const pushes: CoreTerminalPush[] = [];
  const surface: Array<{ grid: [number, number] } | { text: Uint8Array }> = [];
  const screen = new CoreWatchScreen({
    resize: (cols, rows) => surface.push({ grid: [cols, rows] }),
    write: (b) => surface.push({ text: b }),
  });
  const push = (p: CoreTerminalPush) => {
    pushes.push(p);
    screen.apply(p);
  };
  const ended = new Promise<string>((resolve) => {
    void client
      .watch(
        "t1",
        { cols: 120, rows: 40 },
        {
          resize: (cols, rows) => push({ stream: "s", grid: { cols, rows } }),
          data: (b) =>
            push({ stream: "s", bytes: Buffer.from(b).toString("base64") }),
          close: (reason) => {
            push({ stream: "s", closed: reason });
            resolve(reason);
          },
        },
      )
      .catch((error: Error) => resolve(`refused: ${error.message}`));
  });
  await ended;
  return { pushes, surface, sent, client };
}

const text = (
  surface: Array<{ grid: [number, number] } | { text: Uint8Array }>,
) =>
  new TextDecoder().decode(
    Buffer.concat(
      surface.flatMap((s) => ("text" in s ? [Buffer.from(s.text)] : [])),
    ),
  );

describe("replay of a real core watch", () => {
  test("the recording really splits a 4-byte character across DATA frames", () => {
    const decoder = new FrameDecoder();
    const payloads = decoder
      .push(bytes.subarray(helloEnd))
      .filter((f) => f.channel !== 0 && f.kind === FrameKind.DATA)
      .map((f) => Buffer.from(f.payload));
    const at = payloads.findIndex((p) => p.includes(Buffer.from([0xf0, 0x9f])));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(payloads[at]!.includes(Buffer.from([0xf0, 0x9f, 0x98, 0x80]))).toBe(
      false,
    );
    expect(payloads[at + 1]!.subarray(0, 2)).toEqual(Buffer.from([0x98, 0x80]));
  });

  for (const split of ["recorded", 1, 7, "random"] as const)
    test(`grids precede their paints and text survives (${split} chunks)`, async () => {
      const { pushes, surface, sent, client } = await replay(split);
      // World adopts exactly the grids core announced, in order.
      expect(
        surface.flatMap((s) => ("grid" in s ? [s.grid.join("x")] : [])),
      ).toEqual(["120x40", "90x25", "200x120"]);
      expect("grid" in surface[0]!).toBe(true);
      // Every grid is followed by core's repaint (it starts with CAN).
      surface.forEach((s, i) => {
        if ("grid" in s && i + 1 < surface.length) {
          const next = surface[i + 1]!;
          expect("text" in next && next.text[0] === 0x18).toBe(true);
        }
      });
      const shown = text(surface);
      expect(shown).toContain("ready ✓");
      expect(shown).toContain("split 😀 done");
      expect(shown).not.toContain("�");
      // kill -9: the stream ends and the connection is over.
      expect(pushes.at(-1)).toMatchObject({ closed: expect.any(String) });
      expect(client.closed).toBe(true);
      // World sent a hello and one observe attach: nothing that types or sizes.
      const decoder = new FrameDecoder();
      const framed = decoder.push(new Uint8Array(Buffer.concat(sent.slice(1))));
      expect(framed.map((f) => [f.channel, f.kind])).toEqual([
        [0, FrameKind.DATA],
      ]);
      expect(
        JSON.parse(new TextDecoder().decode(framed[0]!.payload)),
      ).toMatchObject({
        method: "terminal.attach",
        params: {
          terminal: "t1",
          observe: true,
          resize_notifications: true,
        },
      });
    });
});
