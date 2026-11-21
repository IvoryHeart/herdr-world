/**
 * Try (help panel, Town Master): find a help entry's control on screen and
 * spotlight it. A control inside a closed menu is found through the button
 * that opens it, marked `data-help-opens="<control> …"`.
 */

function visible(element: Element) {
  if (!element.isConnected || !element.getClientRects().length) return false;
  const style = getComputedStyle(element);
  return style.visibility !== "hidden" && style.display !== "none";
}

export function findHelpTarget(
  control: string,
  root: ParentNode = document,
): HTMLElement | null {
  const direct = Array.from(
    root.querySelectorAll<HTMLElement>(`[data-help="${control}"]`),
  ).find(visible);
  if (direct) return direct;
  return (
    Array.from(root.querySelectorAll<HTMLElement>("[data-help-opens]")).find(
      (element) =>
        element.dataset.helpOpens?.split(/\s+/).includes(control) &&
        visible(element),
    ) ?? null
  );
}

/** Waits for the control to appear, as a view switch renders it. */
export function waitForHelpTarget(
  control: string,
  timeoutMs = 1500,
): Promise<HTMLElement | null> {
  const found = findHelpTarget(control);
  if (found) return Promise.resolve(found);
  return new Promise((resolve) => {
    let done = false;
    const finish = (element: HTMLElement | null) => {
      if (done) return;
      done = true;
      observer.disconnect();
      window.clearTimeout(timer);
      window.clearInterval(poll);
      resolve(element);
    };
    const check = () => {
      const element = findHelpTarget(control);
      if (element) finish(element);
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    // Layout alone (a resize, a transition) does not mutate the DOM.
    const poll = window.setInterval(check, 100);
    const timer = window.setTimeout(() => finish(null), timeoutMs);
  });
}

export const HELP_SPOTLIGHT_MS = 2400;

/**
 * Asked of the control's view before Try scrolls: a view that moves its own
 * camera (Town) brings the control into view and cancels the event, since
 * scrolling its clipped container would tear the controls from the scene.
 */
export const HELP_REVEAL_EVENT = "herdr-world:help-reveal";

/** Rings the control for a moment, brings it into view and focuses it. */
export function spotlightHelpTarget(element: HTMLElement) {
  element.setAttribute("data-help-spotlight", "");
  const reveal = new Event(HELP_REVEAL_EVENT, {
    bubbles: true,
    cancelable: true,
  });
  if (element.dispatchEvent(reveal))
    element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  if (element.matches("button, a[href], input, textarea, select, [tabindex]"))
    element.focus({ preventScroll: true });
  window.setTimeout(
    () => element.removeAttribute("data-help-spotlight"),
    HELP_SPOTLIGHT_MS,
  );
}
