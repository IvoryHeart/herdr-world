import { useEffect, useRef } from "react";
import { useLayoutPreferences } from "./layoutPreferences";

/**
 * Lets the phone's Back gesture or button close an open mobile layer (menu,
 * sheet, Composer, Inspector) before it leaves the page. Each open layer adds
 * one history entry at the current URL; Back pops the newest one and closes
 * only that layer. Closing a layer with its on-screen control removes its
 * entry again, so visible controls and system Back stay in step.
 */
export function useSystemBack(open: boolean, close: () => void) {
  const { mobile } = useLayoutPreferences();
  const closeRef = useRef(close);
  closeRef.current = close;
  const active = mobile && open;

  useEffect(() => {
    if (!active) return;
    const token = `herdr-back-${Math.random().toString(36).slice(2)}`;
    pushEntry(token);
    let popped = false;
    const onPopState = (event: PopStateEvent) => {
      if (popped || ownBacks.has(event)) return;
      const state = event.state as { herdrBack?: string } | null;
      // Back landed on this layer's own entry: a layer above it closed.
      if (state?.herdrBack === token) return;
      if (!entryStack.includes(token)) return;
      // Back landed on a newer layer's entry (forward history): not ours.
      if (
        entryStack.indexOf(token) < entryStack.indexOf(state?.herdrBack ?? "")
      )
        return;
      popped = true;
      removeEntry(token);
      closeRef.current();
    };
    entryStack.push(token);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (popped) return;
      const top = entryStack[entryStack.length - 1] === token;
      removeEntry(token);
      // Closed on screen: drop the entry it added if it is still the newest,
      // or a closed layer's entry that a racing open left current.
      const current = (window.history.state as { herdrBack?: string } | null)
        ?.herdrBack;
      if (top && current && !entryStack.includes(current)) {
        pendingBacks++;
        window.history.back();
      }
    };
  }, [active]);
}

const entryStack: string[] = [];

// history.back() is asynchronous: a layer opened before it lands, such as a
// terminal chosen from the tab sheet, must not read it as the user's Back.
let pendingBacks = 0;
const ownBacks = new WeakSet<Event>();
if (typeof window !== "undefined")
  window.addEventListener("popstate", (event) => {
    if (pendingBacks === 0) return;
    pendingBacks--;
    ownBacks.add(event);
    // A layer that opened while the Back was pending pushed its entry first,
    // and the Back went past it; give the newest open layer its entry again.
    const top = entryStack[entryStack.length - 1];
    const current = (event.state as { herdrBack?: string } | null)?.herdrBack;
    if (pendingBacks === 0 && top && current !== top) pushEntry(top);
  });

function pushEntry(token: string) {
  const base: unknown = window.history.state;
  window.history.pushState(
    { ...(typeof base === "object" && base ? base : {}), herdrBack: token },
    "",
  );
}

function removeEntry(token: string) {
  const index = entryStack.indexOf(token);
  if (index >= 0) entryStack.splice(index, 1);
}
