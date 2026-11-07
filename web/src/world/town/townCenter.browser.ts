import { WORLD_AGENT_LAUNCH_EVENT } from "../agentProfiles";

/**
 * The town center in a real renderer: its plaque is in the home view, a tap
 * on the building opens the ring around it, every action fits on screen,
 * Escape and a press outside close it, and New agent opens the launcher.
 */
export async function checkTownCenter(
  host: HTMLElement,
  check: (condition: boolean, message: string) => void,
  waitFor: (condition: () => boolean, message: string) => Promise<void>,
) {
  const sign = () => host.querySelector<HTMLButtonElement>(".town-center-sign");
  const ring = () => host.querySelector<HTMLElement>(".town-center-ring");
  const actions = () => [
    ...host.querySelectorAll<HTMLButtonElement>(".town-center-action"),
  ];
  await waitFor(() => sign() !== null, "the town center has no plaque");
  const plaque = sign()!.getBoundingClientRect();
  check(
    plaque.top >= 0 &&
      plaque.left >= 0 &&
      plaque.bottom <= window.innerHeight &&
      plaque.right <= window.innerWidth,
    "the town center is not in Town's home view",
  );
  check(
    sign()!.textContent === "Town center",
    `the plaque reads ${sign()!.textContent}`,
  );

  // A tap on the building, through the canvas's own hit test.
  const canvas = host.querySelector<HTMLElement>(".town-canvas-host")!;
  const at = {
    clientX: plaque.left + plaque.width / 2,
    clientY: plaque.top + plaque.height / 2,
  };
  for (const type of ["pointerdown", "pointerup"])
    canvas.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 61,
        pointerType: "mouse",
        button: 0,
        buttons: type === "pointerdown" ? 1 : 0,
        ...at,
      }),
    );
  await waitFor(
    () => ring() !== null,
    "a tap on the town center opened no menu",
  );
  check(actions().length === 6, `the ring has ${actions().length} actions`);
  check(
    document.activeElement === actions()[0],
    "the ring did not focus its first action",
  );
  check(
    sign()!.getAttribute("aria-expanded") === "true",
    "the plaque does not report its open menu",
  );
  // Measured once the ring's opening motion has finished.
  await new Promise((resolve) => setTimeout(resolve, 400));
  for (const action of actions()) {
    const box = action
      .querySelector(".town-center-medallion")!
      .getBoundingClientRect();
    check(
      box.width >= 44 &&
        box.left >= 0 &&
        box.top >= 0 &&
        box.right <= window.innerWidth &&
        box.bottom <= window.innerHeight,
      `${action.dataset.action} is off screen or under 44 px: ${JSON.stringify(box)}`,
    );
  }
  document.activeElement!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await waitFor(() => ring() === null, "Escape did not close the ring");

  // The plaque opens it too; a press outside closes it.
  sign()!.click();
  await waitFor(() => ring() !== null, "the plaque opened no menu");
  await new Promise((resolve) => setTimeout(resolve, 350));
  host.querySelector(".town-center-backdrop")!.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      clientX: 4,
      clientY: 4,
    }),
  );
  await waitFor(() => ring() === null, "a press outside did not close it");

  // New agent opens World's launcher and closes the ring.
  const launches: unknown[] = [];
  const launched = (event: Event) =>
    launches.push((event as CustomEvent).detail);
  window.addEventListener(WORLD_AGENT_LAUNCH_EVENT, launched);
  try {
    sign()!.click();
    await waitFor(() => ring() !== null, "the plaque did not reopen the menu");
    actions()
      .find((action) => action.dataset.action === "launch")!
      .click();
    await waitFor(() => ring() === null, "choosing New agent left it open");
    check(launches.length === 1, "New agent did not open the launcher");
  } finally {
    window.removeEventListener(WORLD_AGENT_LAUNCH_EVENT, launched);
  }
}
