/**
 * The command box is World's one search (world/worldFinder.ts): its key
 * (Cmd+K on a Mac, Ctrl+K elsewhere), the view search keys (`/`, Ctrl+F;
 * world/viewSearchShortcut.ts), a view's search button and the phone's Find
 * or act all open it.
 *
 * When the command box's key opens it.
 * Where text is typed (a terminal, the Chat composer, any text field) Ctrl+K
 * and Cmd+K are shell and editor keys, so there only a binding with Alt opens
 * the box: Cmd+Option+K on a Mac, Ctrl+Alt+K elsewhere. Inside the box, its
 * key closes it.
 */

import { shortcutFromEvent, shortcutLeavesTyping } from "./shortcutBindings";
import { shortcutMatches } from "./shortcutPreferences";
import { keyBelongsToTarget } from "./world/viewSearchShortcut";

/** Asks the command box to open, such as from the phone's view menu. */
export const COMMAND_BOX_OPEN_EVENT = "herdr:command-box-open";

/**
 * Open the command box. `resume` opens it with the search the current view
 * still shows (a view's search chip); otherwise it opens empty.
 */
export function openCommandBox(options?: { resume?: boolean }) {
  window.dispatchEvent(
    new CustomEvent(COMMAND_BOX_OPEN_EVENT, {
      detail: { resume: options?.resume === true },
    }),
  );
}

/** Whether this key press opens or closes the command box. */
export function commandBoxKey(event: KeyboardEvent) {
  if (event.repeat || !shortcutMatches(event, "command.menu")) return false;
  const target = event.target instanceof Element ? event.target : null;
  if (!target || target.closest(".command-popover")) return true;
  return (
    !keyBelongsToTarget(target) ||
    shortcutLeavesTyping(shortcutFromEvent(event) ?? "")
  );
}
