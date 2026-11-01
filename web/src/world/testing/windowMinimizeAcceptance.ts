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
  openComposer,
}: {
  frame: HTMLElement;
  calls: readonly { method: string }[];
  until(predicate: () => unknown, message: string): Promise<void>;
  check(condition: boolean, message: string): void;
  openComposer?(): void;
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
  let switcher = document.querySelector<HTMLButtonElement>(
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
  if (compact) {
    const visibleInspector = () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          ".world-managed-window.is-compact .workspace-inspector",
        ),
      ].find(
        (el) =>
          el.getBoundingClientRect().width > 0 &&
          el.getBoundingClientRect().height > 0,
      );
    await until(() => visibleInspector(), "remaining compact Inspector");
    const inspector = visibleInspector()!;
    if (inspector.dataset.view !== "terminal") {
      inspector
        .querySelector<HTMLButtonElement>('[aria-label^="Inspector view:"]')!
        .click();
      await until(
        () => document.querySelector('[aria-label="Inspector views"]'),
        "remaining Inspector view menu",
      );
      document
        .querySelector<HTMLButtonElement>(
          '[aria-label="Inspector views"] [data-view="terminal"]',
        )!
        .click();
    }
    const terminal = inspector.querySelector<HTMLElement>(".xterm")!;
    for (const type of ["pointerdown", "pointerup"])
      terminal.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 998,
          pointerType: "touch",
          isPrimary: true,
          button: 0,
          buttons: type === "pointerdown" ? 1 : 0,
        }),
      );
    openComposer?.();
    await until(
      () => inspector.querySelector("textarea.terminal-composer-input"),
      "remaining Inspector terminal composer",
    );
    const input = inspector.querySelector<HTMLTextAreaElement>(
      "textarea.terminal-composer-input",
    )!;
    input.focus({ preventScroll: true });
    input.click();
    await until(
      () =>
        inspector
          .querySelector<HTMLElement>(".terminal-composer-toolbar")!
          .getBoundingClientRect().height > 0,
      "remaining Inspector composer accessories",
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    switcher = document.querySelector<HTMLButtonElement>(
      ".world-managed-window.is-compact.is-active .world-window-switcher-trigger, .world-window-switcher-trigger.is-floating",
    )!;
    const bounds = switcher.getBoundingClientRect();
    check(
      inspector
        .querySelector(".workspace-inspector-head")
        ?.contains(switcher) === true,
      "Open windows is not in the visible Inspector header",
    );
    for (const control of [
      input,
      ...inspector.querySelectorAll<HTMLElement>(
        ".terminal-composer-toolbar button",
      ),
    ]) {
      const rect = control.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      check(
        bounds.right <= rect.left ||
          bounds.left >= rect.right ||
          bounds.bottom <= rect.top ||
          bounds.top >= rect.bottom,
        "Open windows covers the composer input or toolbar",
      );
      check(
        document
          .elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
          ?.closest("button,textarea") === control,
        "Composer input or toolbar cannot receive a tap",
      );
    }
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
  const windowCount = Number(switcher.querySelector("span")?.textContent);
  restore.click();
  await until(
    () =>
      currentFrame()?.classList.contains("is-active") &&
      currentFrame()!.getBoundingClientRect().width > 0,
    "Open windows restored the same Inspector",
  );
  if (compact) {
    const originalLabel = restore.textContent?.trim();
    const count = windowCount;
    for (let i = 0; i < count; i++) {
      const button = [
        ...document.querySelectorAll<HTMLButtonElement>(
          '.world-managed-window.is-compact [aria-label="Minimize Inspector window"]',
        ),
      ].find((button) => {
        const bounds = button
          .closest<HTMLElement>(".world-managed-window")!
          .getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0;
      });
      if (!button)
        throw new Error("Expected another visible Inspector to minimize");
      const owner = button.closest<HTMLElement>(".world-managed-window")!;
      button.click();
      await until(
        () => owner.getBoundingClientRect().width === 0,
        "all Inspector headers minimized",
      );
    }
    await until(
      () =>
        document.querySelector(".world-window-switcher-trigger.is-floating"),
      "stage restore fallback after all Inspectors minimize",
    );
    const floating = document.querySelector<HTMLButtonElement>(
      ".world-window-switcher-trigger.is-floating",
    )!;
    const bounds = floating.getBoundingClientRect();
    check(
      document
        .elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
        )
        ?.closest("button") === floating,
      "Stage restore fallback cannot receive a tap",
    );
    // The production fixed backdrop must cover the viewport-level fallback.
    const backdrop = document.createElement("button");
    backdrop.className = "mobile-more-backdrop";
    backdrop.setAttribute("aria-label", "Dismiss mobile menu backdrop");
    document.body.appendChild(backdrop);
    try {
      check(
        document.elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
        ) === backdrop,
        "Stage restore fallback intercepts the mobile more backdrop",
      );
    } finally {
      backdrop.remove();
    }
    for (let i = 0; i < count; i++) {
      await until(
        () =>
          document.querySelector(
            ".world-window-switcher-trigger.is-floating, .world-managed-window.is-compact.is-active .world-window-switcher-trigger",
          ),
        "restore control follows visible Inspector",
      );
      document
        .querySelector<HTMLButtonElement>(
          ".world-window-switcher-trigger.is-floating, .world-managed-window.is-compact.is-active .world-window-switcher-trigger",
        )!
        .click();
      await until(
        () => document.querySelector(".world-window-switcher-menu"),
        "restore all original Inspectors",
      );
      const items = [
        ...document.querySelectorAll<HTMLButtonElement>(
          ".world-window-switcher-menu button",
        ),
      ].filter((item) => item.querySelector('[aria-label="Minimized"]'));
      const chosen = items.find((item) =>
        i === count - 1
          ? item.textContent?.trim() === originalLabel
          : item.textContent?.trim() !== originalLabel,
      );
      if (!chosen) throw new Error("Original minimized Inspector disappeared");
      chosen.click();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    }
    await until(
      () =>
        currentFrame()?.classList.contains("is-active") &&
        currentFrame()!.getBoundingClientRect().width > 0,
      "original Inspector active after stage fallback",
    );
    // Return the terminal input owner after exercising the other window.
    const terminal = currentFrame()!.querySelector<HTMLElement>(".xterm")!;
    for (const type of ["pointerdown", "pointerup"])
      terminal.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 999,
          pointerType: "touch",
          isPrimary: true,
          button: 0,
          buttons: type === "pointerdown" ? 1 : 0,
        }),
      );
  }
  check(
    sessionEndCalls() === before,
    "Minimizing/restoring stopped an agent or closed a session",
  );
  return currentFrame()!;
}
