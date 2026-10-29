import { updateLayoutPreferences } from "../../layoutPreferences";
const captureControls = new URLSearchParams(location.search).has(
  "window-control-captures",
);

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
  if (compact && captureControls) {
    const stage = document.querySelector<HTMLElement>(".world-view-layout")!;
    const { width, height } = stage.style;
    try {
      stage.style.width = stage.style.height = "";
      updateLayoutPreferences({ mode: "auto" });
      if (!(await fetch("/capture/window-controls")).ok)
        throw new Error("Window controls capture failed");
    } finally {
      stage.style.width = width;
      stage.style.height = height;
      updateLayoutPreferences({ mode: "mobile" });
    }
    await until(
      () => document.documentElement.dataset.layout === "mobile",
      "mobile layout after captures",
    );
  }
  const switcher = document.querySelector<HTMLButtonElement>(
    'button[aria-label^="Open windows ("]',
  );
  if (!switcher) throw new Error("Minimized Inspector lacks an open control");
  if (compact) {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    await Promise.all(
      (document.querySelector(".topbar")?.getAnimations() ?? []).map(
        (animation) => animation.finished.catch(() => {}),
      ),
    );
    const visibleBounds = switcher.getBoundingClientRect();
    check(
      visibleBounds.left >= 0 &&
        visibleBounds.top >= 0 &&
        visibleBounds.right <= innerWidth &&
        visibleBounds.bottom <= innerHeight,
      "Open windows is outside the settled viewport",
    );
    check(
      document
        .elementFromPoint(
          visibleBounds.x + visibleBounds.width / 2,
          visibleBounds.y + visibleBounds.height / 2,
        )
        ?.closest("button") === switcher,
      "Open windows cannot receive a tap",
    );
  }
  check(switcher.getBoundingClientRect().width > 0, "Open windows is hidden");
  if (compact) {
    const bounds = switcher.getBoundingClientRect();
    check(
      bounds.width >= 44 && bounds.height >= 44,
      "Mobile Open windows lacks a 44px touch target",
    );
  }
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
  if (compact) {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const bounds = restore.getBoundingClientRect();
    check(
      document
        .elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
        )
        ?.closest("button") === restore,
      "Minimized window menu entry cannot receive a tap",
    );
  }
  restore.click();
  await until(
    () =>
      currentFrame()?.classList.contains("is-active") &&
      currentFrame()!.getBoundingClientRect().width > 0,
    "Open windows restored the same Inspector",
  );
  check(
    sessionEndCalls() === before,
    "Minimizing/restoring stopped an agent or closed a session",
  );
  return currentFrame()!;
}
