import { writeFileSync } from "node:fs";
import { CoreClient, CoreRpcError } from "../client";
import { resolveLocalCoreEndpoint } from "../endpoint";
import { connectUnixStream } from "../stream";
import { ScratchCore, scratchCoreBinary } from "./scratch-core";

export type DeliveryRecording = {
  version: string;
  hello: string;
  steps: {
    method: string;
    request: string;
    response: string[];
    outcome: unknown;
  }[];
};

/** Native send/keys bytes only: no terminal records, paths or process data. */
export async function captureDelivery(bin: string): Promise<DeliveryRecording> {
  const core = new ScratchCore(bin);
  let client: CoreClient | undefined;
  try {
    core.env.HC_STARTED_MS = "100";
    await core.start();
    await core.hc(
      "run",
      "--bg",
      "--name",
      "probe",
      "--",
      "/bin/sh",
      "-c",
      "printf '\\033]7501;state=blocked:app=probe\\033\\'; while IFS= read -r line; do printf '%s\\n' \"$line\"; done",
    );
    const inbound: Uint8Array[] = [],
      outbound: Uint8Array[] = [];
    client = await CoreClient.open(
      await connectUnixStream(resolveLocalCoreEndpoint(core.stateDir)),
      {
        onInbound: (bytes) => inbound.push(bytes.slice()),
        onOutbound: (bytes) => outbound.push(bytes.slice()),
      },
    );
    const hello = JSON.parse(Buffer.concat(inbound).toString("utf8"));
    if (hello.result.login_session)
      hello.result.login_session = { id: 1, user: 1000 };
    const steps: DeliveryRecording["steps"] = [];
    for (const method of ["message", "answer", "keys"]) {
      inbound.length = 0;
      outbound.length = 0;
      let outcome: unknown;
      try {
        outcome =
          method === "keys"
            ? await client.keys("t1", ["enter"])
            : await client.sendText("t1", "café ✓", {
                force: method === "answer",
              });
      } catch (error) {
        if (!(error instanceof CoreRpcError)) throw error;
        outcome = { refused: error.kind };
      }
      steps.push({
        method,
        request: Buffer.concat(outbound).toString("base64"),
        response: inbound.map((bytes) => Buffer.from(bytes).toString("base64")),
        outcome,
      });
    }
    return {
      version: client.hello.version,
      hello: Buffer.from(`${JSON.stringify(hello)}\n`).toString("base64"),
      steps,
    };
  } finally {
    client?.close();
    await core.dispose();
  }
}
if (import.meta.main) {
  const bin = scratchCoreBinary(),
    destination = process.argv[2];
  if (!bin || !destination)
    throw new Error("Set HERDR_CORE_BIN and name the output JSON file");
  writeFileSync(
    destination,
    `${JSON.stringify(await captureDelivery(bin), null, 2)}\n`,
  );
}
