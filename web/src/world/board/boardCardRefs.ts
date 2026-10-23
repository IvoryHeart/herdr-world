/** Keep a mounted card's observer registration across status-only renders. */
export function createBoardCardRefs(
  elements: Map<string, HTMLElement>,
  observer: () => Pick<ResizeObserver, "observe" | "unobserve"> | null,
) {
  const mounted = new Map<string, (element: HTMLElement | null) => void>();
  return (key: string) => {
    const existing = mounted.get(key);
    if (existing) return existing;
    const ref = (element: HTMLElement | null) => {
      const previous = elements.get(key);
      if (previous === element) return;
      if (previous) observer()?.unobserve(previous);
      if (element) {
        elements.set(key, element);
        mounted.set(key, ref);
        observer()?.observe(element);
      } else {
        elements.delete(key);
        mounted.delete(key);
      }
    };
    // Do not retain callbacks created by a render that never commits.
    return ref;
  };
}
