const changes = new EventTarget();
/** Synthetic core status/read-model events, never an elapsed-time poll. */
export const notifyCoreFixtureChange = () =>
  changes.dispatchEvent(new Event("change"));

export function until(
  predicate: () => boolean | Promise<boolean>,
  ms = 3_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let reading = false,
      dirty = false,
      finished = false;
    const finish = (error?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
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
