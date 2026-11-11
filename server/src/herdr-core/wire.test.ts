import { describe, expect, test } from "bun:test";
import {
  CoreProtocolError,
  encodeFrame,
  FrameDecoder,
  FrameKind,
  LineAssembler,
  MAX_FRAME_PAYLOAD,
} from "./wire";

const text = (value: string) => new TextEncoder().encode(value);

describe("framed mode codec", () => {
  test("decodes frames split at every byte, including inside headers", () => {
    const frames = [
      encodeFrame(0, FrameKind.DATA, text('{"id":1}')),
      encodeFrame(7, FrameKind.CREDIT, new Uint8Array([1, 0, 0, 0])),
      encodeFrame(3, FrameKind.CLOSE),
    ];
    const bytes = Buffer.concat(frames);
    for (let size = 1; size <= bytes.byteLength; size++) {
      const decoder = new FrameDecoder();
      const out = [];
      for (let at = 0; at < bytes.byteLength; at += size)
        out.push(...decoder.push(bytes.subarray(at, at + size)));
      expect(out.map((f) => [f.channel, f.kind, f.payload.byteLength])).toEqual(
        [
          [0, FrameKind.DATA, 8],
          [7, FrameKind.CREDIT, 4],
          [3, FrameKind.CLOSE, 0],
        ],
      );
      expect(decoder.pending()).toBe(0);
    }
  });

  test("refuses a frame longer than core's 16 MiB cap before buffering it", () => {
    const header = new Uint8Array(9);
    new DataView(header.buffer).setUint32(5, MAX_FRAME_PAYLOAD + 1, true);
    expect(() => new FrameDecoder().push(header)).toThrow(CoreProtocolError);
  });
});

describe("event line assembly", () => {
  test("a character split across reads is decoded once, not replaced", () => {
    const line = text('{"labels":{"note":"café ü✓ 漢字 😀"}}\n');
    for (let at = 1; at < line.byteLength; at++) {
      const lines = new LineAssembler(1 << 20);
      const out = [
        ...lines.push(line.subarray(0, at)),
        ...lines.push(line.subarray(at)),
      ];
      expect(out).toEqual(['{"labels":{"note":"café ü✓ 漢字 😀"}}']);
    }
  });

  test("invalid UTF-8 and over-long lines are protocol failures", () => {
    expect(() =>
      new LineAssembler(100).push(new Uint8Array([0xc3, 0x0a])),
    ).toThrow("not valid UTF-8");
    const lines = new LineAssembler(10);
    expect(() => lines.push(text("0123456789A"))).toThrow("exceeds 10 bytes");
  });

  test("several lines in one read, and a line spread over many", () => {
    const lines = new LineAssembler(1 << 10);
    expect(lines.push(text("a\nb\nc"))).toEqual(["a", "b"]);
    expect(lines.push(text("d"))).toEqual([]);
    expect(lines.push(text("e\n"))).toEqual(["cde"]);
    expect(lines.pending()).toBe(0);
  });
});
