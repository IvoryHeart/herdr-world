/** Returns false while the target is unmounted; otherwise consumes the request. */
export function focusIfUnchanged(
  target: HTMLElement | null,
  source: Element | null,
): boolean {
  if (!target) return false;
  const document = target.ownerDocument;
  if (
    document.activeElement === source ||
    (source && !source.isConnected && document.activeElement === document.body)
  ) {
    target.focus({ preventScroll: true });
  }
  return true;
}

export function focusDialogElement(
  element: HTMLElement | null,
  options: { select?: boolean } = {},
) {
  const timers: number[] = [];
  const frames: number[] = [];

  const focus = () => {
    if (!element?.isConnected) return;
    element.focus({ preventScroll: true });
    if (options.select && element instanceof HTMLInputElement) {
      element.select();
    }
  };

  focus();
  frames.push(
    window.requestAnimationFrame(() => {
      focus();
      frames.push(window.requestAnimationFrame(focus));
    }),
  );
  timers.push(window.setTimeout(focus, 0));
  timers.push(window.setTimeout(focus, 50));
  timers.push(window.setTimeout(focus, 150));

  return () => {
    for (const frame of frames) window.cancelAnimationFrame(frame);
    for (const timer of timers) window.clearTimeout(timer);
  };
}

const DIALOG_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function isActuallyTabbable(element: HTMLElement) {
  if (
    element.tabIndex < 0 ||
    element.matches(":disabled") ||
    element.getAttribute("aria-disabled") === "true" ||
    element.hasAttribute("data-radix-focus-guard") ||
    element.closest('[hidden], [aria-hidden="true"], [inert]')
  ) {
    return false;
  }
  const style = window.getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.visibility !== "collapse" &&
    element.getClientRects().length > 0
  );
}

export function tabbableElements(root: ParentNode) {
  return Array.from(
    root.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR),
  )
    .map((element, documentOrder) => ({ element, documentOrder }))
    .filter(({ element }) => isActuallyTabbable(element))
    .sort((left, right) => {
      const leftPositive = left.element.tabIndex > 0;
      const rightPositive = right.element.tabIndex > 0;
      if (leftPositive && rightPositive) {
        return (
          left.element.tabIndex - right.element.tabIndex ||
          left.documentOrder - right.documentOrder
        );
      }
      if (leftPositive) return -1;
      if (rightPositive) return 1;
      return left.documentOrder - right.documentOrder;
    })
    .map(({ element }) => element);
}

export function trapDialogTab(
  event: KeyboardEvent,
  dialog: HTMLElement | null,
) {
  if (event.key !== "Tab" || !dialog) return;
  const focusable = tabbableElements(dialog);
  if (focusable.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !dialog.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}
