/** Exercise the real bar around its content-dependent collapse boundary. */
export async function inspectorHeaderResizeAcceptance(
  head: HTMLElement,
  check: (condition: boolean, message: string) => void,
) {
  const frame = head.closest<HTMLElement>(".world-managed-window")!;
  const originalWidth = frame.style.width;
  const layout = () =>
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  try {
    // Re-enter the inline layout before each narrow resize. Include fractional
    // CSS widths: integer offsetWidth rounding can hide an undersized name.
    for (const width of [549, 548.5, 550, 560, 540]) {
      frame.style.width = "760px";
      await layout();
      frame.style.width = `${width}px`;
      await layout();
      const identity = head.querySelector<HTMLElement>(
        ".workspace-inspector-agent-identity",
      )!;
      const nameWidth = identity.getBoundingClientRect().width;
      const bounds = frame.getBoundingClientRect();
      const outside = [...head.querySelectorAll("button")].some((button) => {
        const rect = button.getBoundingClientRect();
        return (
          rect.width > 0 &&
          (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)
        );
      });
      check(
        !outside &&
          (nameWidth >= 120 || head.hasAttribute("data-views-in-menu")),
        `Inspector resize to ${width}px squeezed its name: ${JSON.stringify({ nameWidth, outside })}`,
      );
    }
    // A font/style arriving after layout can grow a control without resizing
    // the window. Keep the name's reserve when the handoff control changes.
    frame.style.width = "760px";
    await layout();
    frame.style.width = "600px";
    await layout();
    const identity = head.querySelector<HTMLElement>(
      ".workspace-inspector-agent-identity",
    )!;
    const trigger = head.querySelector<HTMLElement>(".desktop-ide-trigger")!;
    check(!!trigger, "A roomy Inspector must keep its IDE handoff in the bar");
    if (trigger) {
      frame.style.width = `${frame.getBoundingClientRect().width + 121 - identity.getBoundingClientRect().width}px`;
      await layout();
      check(
        trigger.isConnected && !head.hasAttribute("data-views-in-menu"),
        "Late-growth coverage must begin with an inline IDE handoff",
      );
      const originalPadding = trigger.style.paddingInline;
      trigger.style.paddingInline = `${parseFloat(getComputedStyle(trigger).paddingLeft) + 8}px`;
      await layout();
      check(
        identity.getBoundingClientRect().width >= 120 ||
          head.hasAttribute("data-views-in-menu"),
        "A late-growing IDE handoff must move into the menu before squeezing the name",
      );
      trigger.style.paddingInline = originalPadding;
    }
  } finally {
    frame.style.width = originalWidth;
    await layout();
  }
}
