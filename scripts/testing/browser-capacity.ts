/** Event-driven admission; a context retains its slot until disposal. */
export function browserCapacity(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Invalid browser capacity");
  let active = 0,
    closed = false;
  const waiting: { resolve(): void; reject(error: Error): void }[] = [];
  return {
    async acquire() {
      if (closed) throw new Error("Browser closed");
      if (active === limit)
        await new Promise<void>((resolve, reject) =>
          waiting.push({ resolve, reject }),
        );
      else active++;
      if (closed) {
        active--;
        throw new Error("Browser closed");
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const next = waiting.shift();
        if (next) next.resolve();
        else active--;
      };
    },
    close() {
      closed = true;
      for (const pending of waiting.splice(0))
        pending.reject(new Error("Browser closed"));
    },
  };
}
