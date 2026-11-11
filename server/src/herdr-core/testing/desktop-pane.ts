import { resolveLocalCoreEndpoint } from "../endpoint";
import { connectUnixStream } from "../stream";
import { encodeFrame, FrameDecoder, FrameKind } from "../wire";
import type { ScratchCore } from "./scratch-core";

/**
 * An interactive viewer, as Herdr's desktop app attaches a pane: plain
 * framed client code, not World's. It credits what it reads.
 */
export async function desktopPane(core: ScratchCore) {
  const stream = await connectUnixStream(
    resolveLocalCoreEndpoint(core.stateDir),
  );
  const decoder = new FrameDecoder();
  let plain = "";
  let framed = false;
  let channel = 0;
  const replies: Array<(result: { channel: number }) => void> = [];
  stream.onData((bytes) => {
    if (!framed) {
      plain += new TextDecoder().decode(bytes);
      return;
    }
    for (const frame of decoder.push(bytes)) {
      if (frame.channel === 0)
        replies.shift()?.(
          JSON.parse(new TextDecoder().decode(frame.payload)).result,
        );
      else if (frame.kind === FrameKind.DATA) {
        const credit = new Uint8Array(4);
        new DataView(credit.buffer).setUint32(0, frame.payload.length, true);
        stream.write(encodeFrame(frame.channel, FrameKind.CREDIT, credit));
      }
    }
  });
  stream.write(
    new TextEncoder().encode(
      `${JSON.stringify({ jsonrpc: "2.0", id: 0, method: "hello", params: { framed: true, generation: 1 } })}\n`,
    ),
  );
  while (!plain.includes("\n")) await Bun.sleep(5);
  framed = true;
  const size = (cols: number, rows: number) => {
    const bytes = new Uint8Array(4);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, cols, true);
    view.setUint16(2, rows, true);
    return bytes;
  };
  return {
    attach: (address: string, cols: number, rows: number) =>
      new Promise<void>((resolve) => {
        replies.push((result) => {
          channel = result.channel;
          resolve();
        });
        stream.write(
          encodeFrame(
            0,
            FrameKind.DATA,
            new TextEncoder().encode(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "terminal.attach",
                params: { terminal: address, cols, rows },
              }),
            ),
          ),
        );
      }),
    resize: (cols: number, rows: number) =>
      stream.write(encodeFrame(channel, FrameKind.RESIZE, size(cols, rows))),
    detach: () => stream.write(encodeFrame(channel, FrameKind.CLOSE)),
    close: () => stream.close(),
  };
}
