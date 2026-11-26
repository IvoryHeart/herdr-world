import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { withPrivateChecker } from "./verification-checker";
import execution from "../tools/quint/execution.json";

/** One owned checker per control worker; each command uses its async context.
 * Ownership, cancellation/drain and command deadlines stay with the runner. */
export function createCheckerSessions(root: string, output: string) {
  const session = new AsyncLocalStorage<{
    port: number;
    signal: AbortSignal;
  }>();

  async function withWorker<T>(
    work: (signal: AbortSignal) => Promise<T>,
    signal: AbortSignal,
  ) {
    const temporary = resolve(output, `checker-session-${randomUUID()}`);
    await mkdir(temporary, { recursive: true });
    let log = "";
    try {
      return await withPrivateChecker(
        temporary,
        signal,
        (port, ownedSignal) =>
          session.run({ port, signal: ownedSignal }, () => work(ownedSignal)),
        (text) => {
          log += text.replaceAll(root, "<checkout>");
        },
        { sessionTimeoutMs: execution.workerTimeoutMs },
      );
    } finally {
      await writeFile(`${temporary}.log`, log);
      await rm(temporary, { recursive: true, force: true });
    }
  }

  return { current: () => session.getStore(), withWorker };
}
