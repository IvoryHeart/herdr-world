/** Isolated store state for behavior tests; disk persistence has separate coverage. */
export function memoryBacking<T>(initial: T) {
  let saved = structuredClone(initial);
  return {
    read: () => structuredClone(saved),
    commit(document: T) {
      saved = structuredClone(document);
    },
  };
}
