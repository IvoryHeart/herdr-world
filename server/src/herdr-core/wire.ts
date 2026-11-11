/**
 * herdr-core framed mode: `[channel u32 LE][kind u8][len u32 LE][payload]`.
 * Frames may arrive split anywhere, including inside the header.
 */
export const FRAME_HEADER_BYTES = 9;
/** Core refuses larger frames on decode; World refuses them too. */
export const MAX_FRAME_PAYLOAD = 16 << 20;
/** A stream (attach or events) starts with this much credit. */
export const STREAM_WINDOW = 256 * 1024;

export const FrameKind = {
  DATA: 0,
  CREDIT: 1,
  CLOSE: 2,
  RESIZE: 3,
  FOCUS: 4,
  FACTS: 5,
  AUTOMATIC_INPUT: 6,
} as const;

export type Frame = { channel: number; kind: number; payload: Uint8Array };

export class CoreProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoreProtocolError";
  }
}

export function encodeFrame(
  channel: number,
  kind: number,
  payload: Uint8Array = new Uint8Array(0),
): Uint8Array {
  if (payload.byteLength > MAX_FRAME_PAYLOAD)
    throw new CoreProtocolError("frame payload exceeds 16 MiB");
  const out = new Uint8Array(FRAME_HEADER_BYTES + payload.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, channel >>> 0, true);
  view.setUint8(4, kind);
  view.setUint32(5, payload.byteLength, true);
  out.set(payload, FRAME_HEADER_BYTES);
  return out;
}

export function creditFrame(channel: number, bytes: number): Uint8Array {
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setUint32(0, bytes >>> 0, true);
  return encodeFrame(channel, FrameKind.CREDIT, payload);
}

/** Incremental decoder: push arbitrary byte slices, receive whole frames. */
export class FrameDecoder {
  private chunks: Uint8Array[] = [];
  private buffered = 0;

  push(bytes: Uint8Array): Frame[] {
    if (bytes.byteLength === 0) return [];
    this.chunks.push(bytes);
    this.buffered += bytes.byteLength;
    const frames: Frame[] = [];
    for (;;) {
      if (this.buffered < FRAME_HEADER_BYTES) return frames;
      const header = this.peek(FRAME_HEADER_BYTES);
      const view = new DataView(
        header.buffer,
        header.byteOffset,
        header.byteLength,
      );
      const length = view.getUint32(5, true);
      if (length > MAX_FRAME_PAYLOAD)
        throw new CoreProtocolError(
          `frame of ${length} bytes exceeds ${MAX_FRAME_PAYLOAD}`,
        );
      if (this.buffered < FRAME_HEADER_BYTES + length) return frames;
      const whole = this.take(FRAME_HEADER_BYTES + length);
      frames.push({
        channel: view.getUint32(0, true),
        kind: view.getUint8(4),
        payload: whole.subarray(FRAME_HEADER_BYTES),
      });
    }
  }

  /** Bytes held for an unfinished frame (zero at a clean frame boundary). */
  pending(): number {
    return this.buffered;
  }

  private peek(count: number): Uint8Array {
    const first = this.chunks[0]!;
    if (first.byteLength >= count) return first.subarray(0, count);
    return this.flatten().subarray(0, count);
  }

  private take(count: number): Uint8Array {
    const first = this.chunks[0]!;
    let out: Uint8Array;
    if (first.byteLength >= count) {
      out = first.subarray(0, count);
      if (first.byteLength === count) this.chunks.shift();
      else this.chunks[0] = first.subarray(count);
    } else {
      const flat = this.flatten();
      out = flat.subarray(0, count);
      this.chunks = flat.byteLength > count ? [flat.subarray(count)] : [];
    }
    this.buffered -= count;
    return out;
  }

  private flatten(): Uint8Array {
    if (this.chunks.length === 1) return this.chunks[0]!;
    const flat = new Uint8Array(this.buffered);
    let at = 0;
    for (const chunk of this.chunks) {
      flat.set(chunk, at);
      at += chunk.byteLength;
    }
    this.chunks = [flat];
    return flat;
  }
}

/**
 * Turns one channel's byte stream into whole UTF-8 lines. A character split
 * across frames is decoded once both halves arrive; a line beyond the limit
 * is a protocol failure, never a truncated admission.
 */
export class LineAssembler {
  private decoder = new TextDecoder("utf-8", { fatal: true });
  private partial = "";
  private partialBytes = 0;

  constructor(private readonly maxLineBytes: number) {}

  push(bytes: Uint8Array): string[] {
    const lines: string[] = [];
    let start = 0;
    for (;;) {
      const newline = bytes.indexOf(0x0a, start);
      const end = newline === -1 ? bytes.byteLength : newline;
      const piece = bytes.subarray(start, end);
      this.partialBytes += piece.byteLength;
      if (this.partialBytes > this.maxLineBytes)
        throw new CoreProtocolError(
          `event line exceeds ${this.maxLineBytes} bytes`,
        );
      try {
        this.partial += this.decoder.decode(piece, {
          stream: newline === -1,
        });
      } catch {
        throw new CoreProtocolError("event line is not valid UTF-8");
      }
      if (newline === -1) return lines;
      lines.push(this.partial);
      this.partial = "";
      this.partialBytes = 0;
      start = newline + 1;
      if (start >= bytes.byteLength) return lines;
    }
  }

  pending(): number {
    return this.partialBytes;
  }
}
