/**
 * Controls that stay on a view, opened from Settings or the command box
 * (#1035). A registry entry for Board's settings menu or Town's lenses calls
 * `openViewControl`: World switches to the view, and the view opens the
 * control once it is on screen. The view owns the control and its value; it
 * only answers the request with `useViewControlRequest`.
 */

import { useEffect, useRef } from "react";
import { pushRoute } from "../systemBack";
import { WORLD_VIEW_PATHS, type WorldView } from "../world/worldViewRouting";

export type ViewControl =
  /** Board's settings menu: surface, status colours, status pulses. */
  | "board.settings"
  /** Board's Status colours dialog. */
  | "board.colours"
  /** Town's lens chooser. */
  | "town.lenses"
  /** Manage connections, from the Hosts button (phone: the view menu) on any view. */
  | "connections.manage";

const VIEW_CONTROL_EVENT = "herdr-world:view-control";
/** A request the view has not answered expires, so a later visit stays plain. */
const REQUEST_LIFETIME_MS = 5000;

let pending: { control: ViewControl; at: number } | null = null;

/** Shows `view` (or stays on the current one) and asks it to open `control`. */
export function openViewControl(view: WorldView | null, control: ViewControl) {
  pending = { control, at: Date.now() };
  if (view === null) {
    window.dispatchEvent(new CustomEvent(VIEW_CONTROL_EVENT));
    return;
  }
  const path = WORLD_VIEW_PATHS[view];
  if (window.location.pathname !== path) {
    const url = new URL(window.location.href);
    url.pathname = path;
    pushRoute({ herdrFrom: window.location.pathname }, url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
  window.dispatchEvent(new CustomEvent(VIEW_CONTROL_EVENT));
}

/** Takes a request for `control`, if one is waiting, once. */
function take(control: ViewControl) {
  if (!pending || pending.control !== control) return false;
  const fresh = Date.now() - pending.at <= REQUEST_LIFETIME_MS;
  pending = null;
  return fresh;
}

/** A view answers requests for its control: now, or when it mounts. */
export function useViewControlRequest(control: ViewControl, open: () => void) {
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    const answer = () => {
      if (take(control)) latest.current();
    };
    answer();
    window.addEventListener(VIEW_CONTROL_EVENT, answer);
    return () => window.removeEventListener(VIEW_CONTROL_EVENT, answer);
  }, [control]);
}
