import type { Writable } from "node:stream";

/** A receipt may follow only the write callback, never console buffering. */
export function writeCliOutput(
  message: string,
  output: Writable = process.stdout,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const failed = (error: Error) => reject(error);
    output.once("error", failed);
    try {
      output.write(`${message}\n`, (error) => {
        // Node emits error after the failing callback; consume that event too.
        if (error) {
          reject(error);
          return;
        }
        output.removeListener("error", failed);
        resolve();
      });
    } catch (error) {
      output.removeListener("error", failed);
      reject(error);
    }
  });
}
