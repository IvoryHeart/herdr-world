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

/** Keys a focused terminal sends as escape sequences: `[final, CSI number]`. */
const SEQUENCES: Record<string, [string, number?]> = {
  ArrowUp: ["A"],
  ArrowDown: ["B"],
  ArrowRight: ["C"],
  ArrowLeft: ["D"],
  Home: ["H"],
  End: ["F"],
  Insert: ["~", 2],
  Delete: ["~", 3],
  PageUp: ["~", 5],
  PageDown: ["~", 6],
};

/** Ctrl with these characters sends the control code xterm sends. */
const CONTROL_CHARACTERS: Record<string, string> = {
  " ": "\x00",
  "@": "\x00",
  "2": "\x00",
  "[": "\x1b",
  "\\": "\x1c",
  "]": "\x1d",
  "6": "\x1e",
  "^": "\x1e",
  "-": "\x1f",
  _: "\x1f",
};

const macKeyboard = () =>
  typeof navigator !== "undefined" &&
  /Mac|iP(hone|ad|od)/.test(navigator.platform);

/**
 * What a focused terminal sends for `event`, as xterm does by default
 * (normal cursor mode): text, Enter, editing and cursor keys, Ctrl codes
 * (Ctrl+C is "\x03") and Alt as an Escape prefix. Keys the browser keeps
 * (Cmd, Ctrl+V and Ctrl+Shift shortcuts, function keys) give null. The stand-in
 * that holds keys while the watch loads uses it, so a command cancelled or
 * edited before the terminal arrives stays cancelled or edited.
 */
export function terminalKey(event: KeyboardEvent): string | null {
  const { key, ctrlKey: ctrl, altKey: alt, shiftKey: shift } = event;
  if (event.metaKey || event.isComposing) return null;
  // AltGr types its character with Ctrl and Alt both held.
  if (ctrl && alt) return key.length === 1 ? key : null;
  const sequence = SEQUENCES[key];
  if (sequence) {
    const [final, number] = sequence;
    const modifier = 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0);
    if (modifier === 1) return number ? `\x1b[${number}~` : `\x1b[${final}`;
    return `\x1b[${number ?? 1};${modifier}${final}`;
  }
  const prefix = alt && !macKeyboard() ? "\x1b" : "";
  if (key === "Enter") return `${prefix}\r`;
  if (key === "Backspace") return `${prefix}${ctrl ? "\x08" : "\x7f"}`;
  if (key === "Escape") return "\x1b";
  if (key === "Tab") return ctrl || alt ? null : shift ? "\x1b[Z" : "\t";
  if (key.length !== 1) return null;
  if (!ctrl) return `${prefix}${key}`;
  if (shift && /^[a-z]$/i.test(key)) return null;
  if (/^[a-z]$/i.test(key))
    return key.toLowerCase() === "v"
      ? null
      : String.fromCharCode(key.toLowerCase().charCodeAt(0) - 96);
  return CONTROL_CHARACTERS[key] ?? null;
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
