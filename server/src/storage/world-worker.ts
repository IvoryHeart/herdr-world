import { parentPort } from "node:worker_threads";
import { openWorldWriter } from "./world-writer";
import type { WorkerReply, WorkerRequest } from "./world-protocol";

if (!parentPort) throw new Error("world storage must run inside its worker");
const port = parentPort;
const reply = (value: WorkerReply) => port.postMessage(value);
let writer: ReturnType<typeof openWorldWriter> | undefined;
port.on("message", (request: WorkerRequest) => {
  try {
    if (request.type === "open") {
      if (writer) throw new Error("world storage is already open");
      writer = openWorldWriter(
        request.path,
        request.legacy,
        request.at,
        request.incarnation,
        undefined,
        request.legacyProfiles,
        undefined,
        request.legacySettings !== undefined
          ? { path: request.legacySettings }
          : undefined,
        undefined,
        request.legacyBoard !== undefined
          ? { path: request.legacyBoard }
          : undefined,
      );
      reply({ type: "ready", snapshot: writer.read() });
    } else if (request.type === "batch") {
      if (!writer) throw new Error("world storage is not open");
      reply({
        type: "results",
        results: writer.batch(request.requests, request.at),
      });
    } else {
      writer?.close();
      writer = undefined;
      reply({ type: "closed" });
      port.close();
    }
  } catch (error) {
    writer?.close();
    writer = undefined;
    reply({ type: "fatal", error: (error as Error).message });
    port.close();
  }
});
