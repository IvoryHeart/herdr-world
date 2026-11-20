// Needed when CLI consumers are typechecked from the scripts-only TS project.
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="./text-imports.d.ts" />
import {
  MEMORY_LIMITS,
  MemoryError,
  type MemoryFailure,
} from "../../../shared/memory";
import { sshCommandArgv, sshReadCommandArgv } from "../bridge/ssh-command";
import { shQuote } from "../utils/process-utils";
import { runProcessWithInputTimeout } from "../workspace/process";
import worker from "./worker.py" with { type: "text" };

export type MemoryHost = {
  execute<T>(request: Record<string, unknown>): Promise<T>;
};

/** Uses only this runtime's bound process runner. Mutation commands cannot retry. */
export function createMemoryHost(args: {
  sshHost(): string | undefined;
  remotePlatform?: "windows";
  run?: typeof runProcessWithInputTimeout;
}): MemoryHost {
  return {
    async execute<T>(request: Record<string, unknown>): Promise<T> {
      if (
        args.remotePlatform === "windows" ||
        (!args.sshHost() && process.platform === "win32")
      )
        throw new MemoryError(
          "refused",
          "Memory access requires a Unix host with Python 3",
        );
      const mutation = ["create", "update", "delete"].includes(
        String(request.action),
      );
      const destination = args.sshHost();
      const argv = destination
        ? (mutation ? sshCommandArgv : sshReadCommandArgv)(
            destination,
            `python3 -c ${shQuote(worker)}`,
            [],
            "memory",
          )
        : ["python3", "-c", worker];
      let stdout: string;
      try {
        const result = await (args.run ?? runProcessWithInputTimeout)(
          argv,
          JSON.stringify({ ...request, limits: MEMORY_LIMITS }),
          MEMORY_LIMITS.timeout_ms,
        );
        if (result.code !== 0) throw new Error("worker failed");
        stdout = result.stdout;
      } catch {
        throw new MemoryError(
          mutation ? "uncertain" : "unavailable",
          mutation
            ? "Memory write outcome is unknown; read the entry before any retry"
            : "Memory host is unavailable; Unix and Python 3 are required",
        );
      }
      let reply: { ok: boolean; result: T; code: MemoryFailure; error: string };
      try {
        reply = JSON.parse(stdout);
      } catch {
        throw new MemoryError(
          mutation ? "uncertain" : "unavailable",
          "Memory host returned no valid receipt; read again before retrying",
        );
      }
      if (!reply.ok) throw new MemoryError(reply.code, reply.error);
      return reply.result;
    },
  };
}
