/** Event-driven admission; a context retains its slot until disposal. */
export function browserCapacity(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Invalid browser capacity");
  let active = 0,
    closed = false;
  const waiting: {
    size: number;
    resolve(): void;
    reject(error: Error): void;
  }[] = [];
  const drain = () => {
    while (!closed && waiting.length && active + waiting[0]!.size <= limit) {
      const next = waiting.shift()!;
      active += next.size;
      next.resolve();
    }
  };
  return {
    async acquire(exclusive = false) {
      if (closed) throw new Error("Browser closed");
      const size = exclusive ? limit : 1;
      await new Promise<void>((resolve, reject) => {
        waiting.push({ size, resolve, reject });
        drain();
      });
      if (closed) {
        active -= size;
        throw new Error("Browser closed");
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= size;
        drain();
      };
    },
    close() {
      closed = true;
      for (const pending of waiting.splice(0))
        pending.reject(new Error("Browser closed"));
    },
  };
}
