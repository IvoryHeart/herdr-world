/**
 * Town's Next: N moves the camera to the next thing that needs you, in
 * Needs you's order, and Shift+N goes back, as strategy games step through
 * their units. Pure: the canvas keeps the cursor and moves the camera.
 */

/** The item Next showed last, and where it stood in the list then. */
export type TownNextCursor = { key: string; index: number } | null;

/**
 * The next (1) or previous (-1) item after the cursor, wrapping at the
 * ends; null when nothing waits. When the item shown last has left the list
 * (answered or reviewed), Next goes on from where it stood: the item that
 * followed it now stands at its place.
 */
export function townNextStep(
  keys: readonly string[],
  cursor: TownNextCursor,
  direction: 1 | -1,
): { key: string; index: number } | null {
  const n = keys.length;
  if (!n) return null;
  let index: number;
  if (!cursor) index = direction === 1 ? 0 : n - 1;
  else {
    const at = keys.indexOf(cursor.key);
    index =
      at >= 0
        ? at + direction
        : direction === 1
          ? cursor.index
          : cursor.index - 1;
  }
  index = ((index % n) + n) % n;
  return { key: keys[index]!, index };
}

/** "2 of 7 · N next", or without the hint when Next has no key. */
export function townNextLabel(index: number, total: number, key: string) {
  return key
    ? `${index + 1} of ${total} · ${key} next`
    : `${index + 1} of ${total}`;
}

type KeyTarget = {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
};

/**
 * Where Town's keys stay silent: typing in a field or the composer, a
 * terminal, or a menu or dialog that takes its own keys.
 */
export function townKeyIgnored(target: unknown) {
  if (!target || typeof target !== "object") return false;
  const element = target as KeyTarget;
  if (element.isContentEditable) return true;
  if (
    element.tagName &&
    ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)
  )
    return true;
  return Boolean(
    element.closest?.(
      '.xterm, [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"]',
    ),
  );
}
