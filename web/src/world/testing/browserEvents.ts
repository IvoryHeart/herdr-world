/** A page condition changes through DOM work or a rendered frame, not a sleep. */
export function observeCondition(
  check: () => boolean,
  message = "Browser condition",
  deadlineMs = 20_000,
): Promise<void> {
  const native = globalThis as unknown as {
    __herdrTestWait?: () => () => void;
    __herdrTestFrame?: typeof requestAnimationFrame;
    __herdrTestCancelFrame?: typeof cancelAnimationFrame;
    __herdrTestDeadline?: typeof setTimeout;
    __herdrTestClearDeadline?: typeof clearTimeout;
  };
  const completed = native.__herdrTestWait?.();
  const nextFrame = native.__herdrTestFrame ?? requestAnimationFrame;
  const cancelFrame = native.__herdrTestCancelFrame ?? cancelAnimationFrame;
  const bound = native.__herdrTestDeadline ?? setTimeout;
  const clear = native.__herdrTestClearDeadline ?? clearTimeout;
  return new Promise((resolve, reject) => {
    let frame = 0;
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      observer.disconnect();
      cancelFrame(frame);
      clear(deadline);
      completed?.();
      if (error) reject(error);
      else resolve();
    };
    const read = () => {
      if (finished) return true;
      try {
        if (check()) {
          finish();
          return true;
        }
      } catch (error) {
        finish(error as Error);
        return true;
      }
      return false;
    };
    const observer = new MutationObserver(() => {
      read();
    });
    const deadline = bound(() => finish(new Error(message)), deadlineMs);
    observer.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    let driving = false;
    const drawn = async () => {
      if (read()) return;
      const step = (
        globalThis as unknown as { __herdrTestStep?: () => Promise<void> }
      ).__herdrTestStep;
      if (step && !driving) {
        driving = true;
        try {
          await step();
        } catch (error) {
          finish(error as Error);
          return;
        } finally {
          driving = false;
        }
      }
      if (!finished) frame = nextFrame(drawn);
    };
    drawn();
  });
}

/** Wait inside the owning page; one CDP command replaces repeated round trips. */
export async function waitForPage(
  command: (method: string, params?: Record<string, unknown>) => Promise<any>,
  expression: string,
  message = expression,
  deadlineMs = 20_000,
) {
  const result = await command("Runtime.evaluate", {
    expression: `(${observeCondition.toString()})(() => (${expression}), ${JSON.stringify(message)}, ${deadlineMs})`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw new Error(`${message}: ${JSON.stringify(result.exceptionDetails)}`);
}
