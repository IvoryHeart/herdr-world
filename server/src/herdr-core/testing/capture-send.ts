import { CoreClient } from "../client";
import { resolveLocalCoreEndpoint } from "../endpoint";
import { connectUnixStream } from "../stream";
import { encodeFrame, FrameDecoder, FrameKind } from "../wire";
import { ScratchCore } from "./scratch-core";

/** Record the official release's native send frames under scratch XDG directories. */
export async function captureSend(bin: string) {
  const core = new ScratchCore(bin);
  let client: CoreClient | undefined;
  try {
    await core.start();
    await core.hc("run", "--bg", "--name", "answer", "--", "/bin/sh");
    let sendId: number | undefined,
      sent: string | undefined,
      received: string | undefined;
    const outbound = new FrameDecoder(),
      inbound = new FrameDecoder();
    let hello = true;
    client = await CoreClient.open(
      await connectUnixStream(resolveLocalCoreEndpoint(core.stateDir)),
      {
        onOutbound(bytes) {
          if (bytes[0] === 123) return; // Plain hello; framed traffic follows it.
          for (const frame of outbound.push(bytes)) {
            if (frame.channel !== 0 || frame.kind !== FrameKind.DATA) continue;
            const call = JSON.parse(new TextDecoder().decode(frame.payload));
            if (call.method === "terminal.send") {
              sendId = call.id;
              sent = Buffer.from(
                encodeFrame(0, FrameKind.DATA, frame.payload),
              ).toString("base64");
            }
          }
        },
        onInbound(bytes) {
          if (hello) {
            const newline = bytes.indexOf(10);
            if (newline < 0)
              throw new Error("Unexpected split hello in capture");
            bytes = bytes.subarray(newline + 1);
            hello = false;
          }
          for (const frame of inbound.push(bytes)) {
            if (frame.channel !== 0 || frame.kind !== FrameKind.DATA) continue;
            const reply = JSON.parse(new TextDecoder().decode(frame.payload));
            if (reply.id === sendId)
              received = Buffer.from(
                encodeFrame(0, FrameKind.DATA, frame.payload),
              ).toString("base64");
          }
        },
      },
    );
    const result = await client.sendText("t1", "printf example_answer");
    if (!sent || !received)
      throw new Error("Native send traffic was not captured");
    return {
      core_version: client.hello.version,
      scenario:
        "Native paste and Enter into a disposable shell; no caller or force",
      request: sent,
      reply: received,
      result,
    };
  } finally {
    client?.close();
    await core.dispose();
  }
}
if (import.meta.main) {
  const [bin, destination] = process.argv.slice(2);
  if (!bin || !destination)
    throw new Error("Usage: capture-send <official-binary> <destination>");
  await Bun.write(
    destination,
    JSON.stringify(await captureSend(bin), null, 2) + "\n",
  );
}
