const nextFrames = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
const tappable = (element: Element) => {
  const bounds = element.getBoundingClientRect();
  return (
    bounds.left >= 0 &&
    bounds.top >= 0 &&
    bounds.right <= innerWidth &&
    bounds.bottom <= innerHeight &&
    document
      .elementFromPoint(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      )
      ?.closest("button") === element
  );
};
const visibleCompactWindow = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      ".world-managed-window.is-compact",
    ),
  ].find((frame) => {
    const bounds = frame.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0;
  });

/**
 * A phone shows one window at a time. A minimized window always has a chip
 * that restores it in one tap: at the bottom of the view with every window
 * minimized, or in a strip at the bottom of the open window, below its
 * content.
 */
async function phoneDockRestore(
  id: string,
  name: string,
  currentFrame: () => HTMLElement | null,
  until: (predicate: () => unknown, message: string) => Promise<void>,
  check: (condition: boolean, message: string) => void,
) {
  const dockButton = (windowId: string) =>
    document.querySelector<HTMLButtonElement>(
      `.world-minimized-dock [data-restore-window-id="${CSS.escape(windowId)}"]`,
    );
  const checkChip = (windowId: string) => {
    const button = dockButton(windowId);
    if (!button) throw new Error("Minimized dock lacks a window");
    const bounds = button.getBoundingClientRect();
    check(
      bounds.width >= 44 && bounds.height >= 44,
      "Minimized dock chip lacks a 44px touch target",
    );
    check(tappable(button), "Minimized dock chip cannot receive a tap");
  };
  // An open window carries the strip under its content, never over it.
  const checkDockInside = (open: HTMLElement) => {
    const dock = document.querySelector<HTMLElement>(".world-minimized-dock");
    if (!dock) return;
    check(open.contains(dock), "Minimized dock covers an open phone window");
    const strip = dock.getBoundingClientRect();
    const frame = open.getBoundingClientRect();
    check(
      strip.bottom <= frame.bottom + 1 && strip.top >= frame.top,
      "Minimized strip overflows the open phone window",
    );
    // The window's content (its composer included) ends above the strip.
    for (const child of open.children) {
      if (child === dock || !child.getClientRects().length) continue;
      check(
        child.getBoundingClientRect().bottom <= strip.top + 1,
        "Minimized strip covers the open window's content",
      );
    }
  };
  const others: string[] = [];
  const minimized = [id];
  for (let open = visibleCompactWindow(); open; open = visibleCompactWindow()) {
    // While another window stays open, every minimized one is one tap away.
    await until(
      () => open.contains(dockButton(id)),
      "open phone window lists the minimized window",
    );
    await nextFrames();
    checkDockInside(open);
    for (const windowId of minimized) checkChip(windowId);
    others.push(open.dataset.windowId!);
    minimized.push(open.dataset.windowId!);
    open
      .querySelector<HTMLButtonElement>(
        '.world-window-controls [aria-label^="Minimize "]',
      )!
      .click();
    await until(
      () => open.getBoundingClientRect().width === 0,
      "every phone window minimized",
    );
  }
  await until(() => dockButton(id), "minimized dock lists the window");
  await nextFrames();
  for (const windowId of minimized) checkChip(windowId);
  // The mobile menu backdrop (z-index 79) must cover the dock.
  const chip = dockButton(id)!.getBoundingClientRect();
  const backdrop = document.createElement("button");
  backdrop.className = "mobile-more-backdrop";
  backdrop.setAttribute("aria-label", "Dismiss mobile menu backdrop");
  document.body.appendChild(backdrop);
  try {
    check(
      document.elementFromPoint(
        chip.x + chip.width / 2,
        chip.y + chip.height / 2,
      ) === backdrop,
      "Minimized dock intercepts the mobile more backdrop",
    );
  } finally {
    backdrop.remove();
  }
  const currentWindow = (windowId: string) =>
    windowId === id
      ? currentFrame()
      : document.querySelector<HTMLElement>(
          `.world-managed-window[data-window-id="${CSS.escape(windowId)}"]`,
        );
  // One tap on a chip restores each window, also while another one is open,
  // ending with the original window in front.
  for (const windowId of [...others.reverse(), id]) {
    await nextFrames();
    checkChip(windowId);
    dockButton(windowId)!.click();
    await until(
      () =>
        currentWindow(windowId)?.classList.contains("is-active") &&
        currentWindow(windowId)!.getBoundingClientRect().width > 0,
      `phone window ${name} restored in one tap`,
    );
    await nextFrames();
    checkDockInside(currentWindow(windowId)!);
  }
  check(
    !document.querySelector(".world-minimized-dock"),
    "Minimized dock stays with nothing minimized",
  );
}

/** Exercises production Inspector controls while the underlying sessions keep running. */
export async function windowMinimizeAcceptance({
  frame,
  calls,
  until,
  check,
}: {
  frame: HTMLElement;
  calls: readonly { method: string }[];
  until(predicate: () => unknown, message: string): Promise<void>;
  check(condition: boolean, message: string): void;
}) {
  const id = frame.dataset.windowId!;
  const currentFrame = () =>
    document.querySelector<HTMLElement>(`[data-window-id="${CSS.escape(id)}"]`);
  const sessionEndCalls = () =>
    calls.filter(({ method }) =>
      [
        "tab.close",
        "pane.close",
        "workspace.close",
        "terminal.close",
        "agent.stop",
      ].includes(method),
    ).length;
  const before = sessionEndCalls();
  const compact = frame.classList.contains("is-compact");
  const minimize = frame.querySelector<HTMLButtonElement>(
    '[aria-label="Minimize Inspector window"]',
  );
  if (!minimize) throw new Error("Inspector lacks a visible minimize button");
  check(
    minimize.getBoundingClientRect().width > 0,
    "Inspector minimize button is hidden",
  );
  if (compact) {
    for (const control of [
      minimize,
      frame.querySelector<HTMLElement>(
        '[aria-label="Close Inspector window"]',
      )!,
    ]) {
      const bounds = control.getBoundingClientRect();
      check(
        bounds.width >= 44 && bounds.height >= 44,
        "Mobile window control lacks a 44px touch target",
      );
    }
  }
  minimize.click();
  await until(
    () =>
      !currentFrame() || currentFrame()!.getBoundingClientRect().width === 0,
    "Inspector minimized through its header button",
  );
  if (compact)
    await phoneDockRestore(
      id,
      frame.getAttribute("aria-label")!,
      currentFrame,
      until,
      check,
    );
  else {
    const switcher = document.querySelector<HTMLButtonElement>(
      'button[aria-label^="Open windows ("]',
    );
    if (!switcher) throw new Error("Minimized Inspector lacks an open control");
    switcher.click();
    await until(
      () => document.querySelector(".world-window-switcher-menu"),
      "Open windows menu",
    );
    const restore = document
      .querySelector<HTMLElement>(
        '.world-window-switcher-menu [aria-label="Minimized"]',
      )
      ?.closest("button");
    if (!restore)
      throw new Error("Minimized Inspector is missing from Open windows");
    restore.click();
    await until(
      () =>
        currentFrame()?.classList.contains("is-active") &&
        currentFrame()!.getBoundingClientRect().width > 0,
      "Open windows restored the same Inspector",
    );
  }
  check(
    sessionEndCalls() === before,
    "Minimizing/restoring stopped an agent or closed a session",
  );
  return currentFrame()!;
}
