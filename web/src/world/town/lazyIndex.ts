/** A keyed index of a list, built the first time it is read. */
export function lazyIndex<T>(items: readonly T[], keyOf: (item: T) => string) {
  let index: Map<string, T> | null = null;
  const read = () =>
    (index ??= new Map(items.map((item) => [keyOf(item), item])));
  return {
    get: (key: string) => read().get(key),
    has: (key: string) => read().has(key),
  };
}
