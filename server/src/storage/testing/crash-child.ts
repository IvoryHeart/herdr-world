import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import type { CrashChild } from "./crash-harness";

/** Process exit alone does not mean Windows has released its stdio handles. */
export function spawnCrashChild(
  command: string[],
  cwd: string,
  createProcess = spawn,
): CrashChild {
  const child = createProcess(command[0]!, command.slice(1), {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    // Node's and Bun's declarations name the same runtime Web Stream API.
    stdout: Readable.toWeb(child.stdout!) as unknown as CrashChild["stdout"],
    stderr: Readable.toWeb(child.stderr!) as unknown as CrashChild["stderr"],
    kill: (signal) => {
      child.kill(signal);
    },
    // close follows exit AND closure of the child's stdio. Bun's exited promise
    // can resolve before that boundary, racing removal of the standalone tree.
    exited: new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    }),
  };
}
