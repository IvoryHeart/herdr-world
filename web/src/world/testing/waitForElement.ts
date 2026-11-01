/**
 * Resolve with the element `find` returns once the DOM under `root` holds it:
 * checked at once, then on each mutation, never on a polling timer. The timer
 * only rejects a hang; nothing waits for it to pass.
 */
export function waitForElement<T extends Element>(
  root: Node,
  find: () => T | null | undefined,
  message: string,
  timeoutMs = 20_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const present = find();
    if (present) {
      resolve(present);
      return;
    }
    const observer = new MutationObserver(() => {
      const element = find();
      if (!element) return;
      finish();
      resolve(element);
    });
    const timer = setTimeout(() => {
      finish();
      reject(new Error(message));
    }, timeoutMs);
    const finish = () => {
      observer.disconnect();
      clearTimeout(timer);
    };
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
}
