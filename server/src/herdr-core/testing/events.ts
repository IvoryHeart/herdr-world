const changes = new EventTarget();
/** Synthetic core status/read-model events, with task-turn fallback for native I/O that has no fixture notification. */
export const notifyCoreFixtureChange = () =>
  changes.dispatchEvent(new Event("change"));

export function until(
  predicate: () => boolean | Promise<boolean>,
  ms = 3_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let turn: ReturnType<typeof setImmediate> | undefined;
    let reading = false,
      dirty = false,
      finished = false;
    const finish = (error?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      clearImmediate(turn);
      changes.removeEventListener("change", read);
      if (error) reject(error);
      else resolve();
    };
    const read = async () => {
      dirty = true;
      if (reading || finished) return;
      reading = true;
      try {
        while (dirty && !finished) {
          dirty = false;
          if (await predicate()) finish();
        }
      } catch (error) {
        finish(error);
      } finally {
        reading = false;
        // Some callers own separate connections: their native replies do not
        // emit this fixture signal. Recheck on an I/O task turn, without a dwell.
        if (!finished) {
          clearImmediate(turn);
          turn = setImmediate(() => void read());
        }
      }
    };
    const deadline = setTimeout(
      () => finish(new Error("condition not reached")),
      ms,
    );
    changes.addEventListener("change", read);
    void read();
  });
}
