// Which herdr-core Terminal tab a key typed in World goes to. Shared by the
// watch and by the tab's stand-in while the watch (and xterm) still loads, so
// a key typed before the chunk arrives reaches the same terminal, once.

/** Keys a person types to a terminal, as xterm sends them. */
export function typedKey(event: KeyboardEvent): string | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing)
    return null;
  if (event.key === "Enter") return "\r";
  if (event.key === "Backspace") return "\x7f";
  return event.key.length === 1 ? event.key : null;
}

/**
 * The core terminal a key typed on the bare page goes to: the one shown or
 * touched last, so two open Inspectors never both take it.
 */
let pageKeyOwner: Element | null = null;

/** `section` takes keys typed on the bare page from now on. */
export function claimPageKeys(section: Element | null) {
  pageKeyOwner = section;
}

/** `section` is going: it no longer takes the page's keys. */
export function releasePageKeys(section: Element | null) {
  if (pageKeyOwner === section) pageKeyOwner = null;
}

/** A control that takes typing itself: a key there is never the terminal's. */
function takesTyping(element: Element): boolean {
  return Boolean(
    element.closest(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="tab"], [role="menu"], [role="dialog"]',
    ),
  );
}

/**
 * The key `event` types into the terminal drawn in `section`, when it was
 * typed elsewhere in that terminal's Inspector while nothing there takes
 * typing (its frame, its title bar, the page itself); otherwise null. Keys
 * typed inside `section` are its own to handle.
 */
export function inspectorKey(
  event: KeyboardEvent,
  section: HTMLElement,
): string | null {
  const key = typedKey(event);
  if (key === null || section.offsetParent === null) return null;
  const target = event.target instanceof Element ? event.target : null;
  if (target && section.contains(target)) return null;
  const page = !target || target === document.body;
  if (page) return pageKeyOwner === section ? key : null;
  if (!section.closest(".workspace-inspector")?.contains(target)) return null;
  if (takesTyping(target!)) return null;
  // A button's own keys (Enter, Space) stay the button's.
  if (target!.closest("button, a") && (key === "\r" || key === " "))
    return null;
  return key;
}

/**
 * Opening the tab by a click moves focus to its terminal, so the next key
 * goes there; keyboard navigation between tabs keeps its focus.
 */
export function focusMovesToTerminal(): boolean {
  const focused = document.activeElement;
  return (
    !focused ||
    focused === document.body ||
    Boolean(
      focused.closest('[role="tab"]') && !focused.matches(":focus-visible"),
    )
  );
}
