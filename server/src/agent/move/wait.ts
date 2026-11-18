/** Event-driven bounded observation: no timer-based status loop. */
export function observeUntil<T>(
  subscribe: (changed: () => void) => () => void,
  check: () => Promise<T | null>,
  timeoutMs = 30_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false,
      reading = false,
      dirty = false;
    let unsubscribe = () => {};
    const finish = (value: T | null, error?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      if (error) reject(error);
      else resolve(value!);
    };
    const changed = () => {
      if (done) return;
      if (reading) {
        dirty = true;
        return;
      }
      reading = true;
      void check().then(
        (value) => {
          reading = false;
          if (value !== null) finish(value);
          else if (dirty) {
            dirty = false;
            changed();
          }
        },
        (error) => finish(null, error),
      );
    };
    const timer = setTimeout(
      () =>
        finish(
          null,
          new Error("The terminal did not confirm readiness in time."),
        ),
      timeoutMs,
    );
    unsubscribe = subscribe(changed);
    changed();
  });
}
