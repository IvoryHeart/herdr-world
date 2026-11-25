import { WORLD_AGENT_LAUNCH_EVENT } from "../agentProfiles";
import { WORLD_APARTMENTS_EVENT } from "../apartments/apartmentsStore";
import { spotlightHelpTarget } from "../../help/helpTry";
import { townCenterMenuPoint } from "./TownCenterMenu";
import { worldFinder } from "../worldFinder";

/**
 * The town center in a real renderer: its plaque is in the home view, a tap
 * on the building opens the ring around it, every action fits on screen,
 * Escape and a press outside close it, New agent opens the launcher, and
 * Buildings opens a second ring around itself (#1261) whose Apartments opens
 * as its building's sign does; Escape there returns to the first ring.
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
  const ids = () => actions().map((action) => action.dataset.action);
  check(actions().length === 8, `the ring has ${actions().length} actions`);
  check(ids().includes("focus"), "the ring offers no Focus");
  check(ids().includes("buildings"), "the ring offers no Buildings");
  check(
    !ids().some((id) => ["library", "apartments", "needs-you"].includes(id!)),
    `the first ring still offers a building: ${ids().join(", ")}`,
  );
  check(
    !actions().some((action) => /\d/.test(action.textContent ?? "")),
    "a first-ring entry shows a number",
  );
  check(
    document.activeElement === actions()[0],
    "the ring did not focus its first action",
  );
  check(
    sign()!.getAttribute("aria-expanded") === "true",
    "the plaque does not report its open menu",
  );
  // Measured at the end of the ring's opening motion. A busy software
  // renderer can hold the animation clock for longer than the motion lasts,
  // so the check settles it rather than waiting a fixed time.
  const fits = () => {
    for (const animation of ring()!.getAnimations({ subtree: true }))
      animation.finish();
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
    labelsClear();
  };
  // Each label sits outside the ring, beyond its icon (#1261): on screen,
  // clear of the ring's circle, every medallion, the hub and each other.
  const labelsClear = () => {
    const medallions = [
      ...ring()!.querySelectorAll(".town-center-medallion, .town-center-hub"),
    ].map((element) => element.getBoundingClientRect());
    const hub = ring()!
      .querySelector(".town-center-hub")!
      .getBoundingClientRect();
    const middle = {
      x: hub.left + hub.width / 2,
      y: hub.top + hub.height / 2,
    };
    // The ring's outer edge: its oval through the medallions, widened by
    // half a medallion.
    const style = getComputedStyle(ring()!);
    const half = medallions[0]!.width / 2 - 1;
    const outer = {
      x: Number.parseFloat(style.getPropertyValue("--ring-x")) + half,
      y: Number.parseFloat(style.getPropertyValue("--ring-y")) + half,
    };
    // Scaled so the oval is a unit circle, a box stays a box.
    const outside = (box: DOMRect) =>
      Math.hypot(
        Math.max(box.left - middle.x, 0, middle.x - box.right) / outer.x,
        Math.max(box.top - middle.y, 0, middle.y - box.bottom) / outer.y,
      ) >= 1;
    // The nearest a box comes to a point.
    const nearest = (box: DOMRect, x: number, y: number) =>
      Math.hypot(
        Math.max(box.left - x, 0, x - box.right),
        Math.max(box.top - y, 0, y - box.bottom),
      );
    const labels = actions().map((action) => ({
      id: action.dataset.action,
      box: action
        .querySelector(":scope > .town-center-label")!
        .getBoundingClientRect(),
    }));
    for (const action of actions()) {
      const name = action.querySelector(".town-center-label > span")!;
      check(
        name.scrollWidth <= name.clientWidth,
        `${action.dataset.action}'s name is cut short: ${name.scrollWidth} > ${name.clientWidth}`,
      );
    }
    for (const { id, box } of labels) {
      check(
        box.left >= 0 &&
          box.top >= 0 &&
          box.right <= window.innerWidth &&
          box.bottom <= window.innerHeight,
        `${id}'s label is off screen: ${JSON.stringify(box)}`,
      );
      check(
        outside(box),
        `${id}'s label is inside the ring: ${JSON.stringify({ box, middle, outer })}`,
      );
      for (const medallion of medallions)
        check(
          nearest(
            box,
            medallion.left + medallion.width / 2,
            medallion.top + medallion.height / 2,
          ) >=
            medallion.width / 2 - 1,
          `${id}'s label covers an entry: ${JSON.stringify({ box, medallion })}`,
        );
      for (const other of labels)
        check(
          other.id === id ||
            box.right <= other.box.left ||
            other.box.right <= box.left ||
            box.bottom <= other.box.top ||
            other.box.bottom <= box.top,
          `${id}'s label overlaps ${other.id}'s`,
        );
    }
    // A later ring's name, over its hub, covers no entry either.
    const name = ring()!.querySelector(".town-center-hub > .town-center-label");
    if (name) {
      const box = name.getBoundingClientRect();
      for (const medallion of medallions.slice(0, -1))
        check(
          nearest(
            box,
            medallion.left + medallion.width / 2,
            medallion.top + medallion.height / 2,
          ) >=
            medallion.width / 2 - 1,
          `the ring's name covers an entry: ${JSON.stringify({ box, medallion })}`,
        );
    }
  };
  fits();
  // Buildings opens the second ring around itself: its centre, Back, sits
  // where Buildings was, unless it moved to fit. It fits too, and Escape
  // returns to the first ring with Buildings focused.
  const centre = (element: Element) => {
    const box = element.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  };
  // Measured once the camera has panned the first ring into view.
  await waitFor(
    () => window.__HERDR_TOWN_RENDERER__?.flying === false,
    "the camera kept panning under the ring",
  );
  const buildingsAt = centre(
    actions()
      .find((action) => action.dataset.action === "buildings")!
      .querySelector(".town-center-medallion")!,
  );
  actions()
    .find((action) => action.dataset.action === "buildings")!
    .click();
  await waitFor(
    () => ring()?.dataset.ring === "buildings",
    "Buildings opened no second ring",
  );
  {
    for (const animation of ring()!.getAnimations({ subtree: true }))
      animation.finish();
    const backAt = centre(host.querySelector(".town-center-hub")!);
    const view = host
      .querySelector(".town-center-layer")!
      .getBoundingClientRect();
    const fit = townCenterMenuPoint(
      { x: buildingsAt.x - view.left, y: buildingsAt.y - view.top },
      view.width,
      view.height,
    );
    check(
      Math.abs(backAt.x - view.left - fit.x) <= 2 &&
        Math.abs(backAt.y - view.top - fit.y) <= 2,
      `the Buildings ring is not around Buildings: ${JSON.stringify({ buildingsAt, backAt, fit })}`,
    );
  }
  check(
    ["apartments", "post", "observatory"].every((id) => ids().includes(id)),
    `the Buildings ring lacks a building: ${ids().join(", ")}`,
  );
  check(
    !actions().some((action) => /\d/.test(action.textContent ?? "")),
    "a Buildings entry shows a number",
  );
  check(
    document.activeElement === actions()[0],
    "the Buildings ring did not focus its first building",
  );
  fits();
  document.activeElement!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await waitFor(
    () => ring()?.dataset.ring === "town-center",
    "Escape did not return to the first ring",
  );
  check(
    document.activeElement?.getAttribute("data-action") === "buildings",
    "the first ring did not focus Buildings again",
  );
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

  // Apartments opens from the Buildings ring and from the building's sign.
  let apartments = 0;
  const opened = () => {
    apartments += 1;
  };
  window.addEventListener(WORLD_APARTMENTS_EVENT, opened);
  try {
    sign()!.click();
    await waitFor(() => ring() !== null, "the plaque did not reopen the menu");
    actions()
      .find((action) => action.dataset.action === "buildings")!
      .click();
    await waitFor(
      () => ring()?.dataset.ring === "buildings",
      "Buildings opened no second ring",
    );
    // The centre's Back returns to the first ring; Buildings again.
    host.querySelector<HTMLButtonElement>(".town-center-hub")!.click();
    await waitFor(
      () => ring()?.dataset.ring === "town-center",
      "Back did not return to the first ring",
    );
    actions()
      .find((action) => action.dataset.action === "buildings")!
      .click();
    await waitFor(
      () => ring()?.dataset.ring === "buildings",
      "Buildings did not reopen its ring",
    );
    actions()
      .find((action) => action.dataset.action === "apartments")!
      .click();
    await waitFor(() => ring() === null, "choosing Apartments left it open");
    check(apartments === 1, "Apartments did not open from the ring");
    const building = host.querySelector<HTMLButtonElement>(
      ".town-apartments-sign",
    );
    check(building !== null, "Town has no apartment building sign");
    building?.click();
    check(apartments === 2, "the apartment sign did not open Apartments");
  } finally {
    window.removeEventListener(WORLD_APARTMENTS_EVENT, opened);
  }

  // Lenses turns a lens on, its legend in the Town board's place; ✕ leaves
  // it and the board comes back.
  const legend = () => host.querySelector<HTMLElement>(".town-lens-legend");
  sign()!.click();
  await waitFor(() => ring() !== null, "the plaque did not reopen the menu");
  actions()
    .find((action) => action.dataset.action === "lenses")!
    .click();
  await waitFor(() => legend() !== null, "Lenses showed no legend");
  check(
    host.querySelector(".town-board:not(.town-lens-legend)") === null,
    "the Town board stayed beside the lens legend",
  );
  await waitFor(
    () => host.querySelector(".town-lens-room") !== null,
    "the lens tinted no room",
  );
  await checkSearchOverLens(host, check, waitFor);
  legend()!
    .querySelector<HTMLButtonElement>('[aria-label="Leave the lens"]')!
    .click();
  await waitFor(() => legend() === null, "✕ did not leave the lens");
  check(host.querySelector(".town-lens") === null, "the lens tints stayed");
  check(
    host.querySelector(".town-board") !== null,
    "the Town board did not come back",
  );
}

/**
 * Help's Try on the Apartments sign when it is off camera (#1150): Town
 * flies its camera to the sign. The browser must not scroll the clipped
 * Town shell, which would lift the controls off the painted buildings. It
 * leaves the camera where Try put it, so it runs last.
 */
export async function checkApartmentsTry(
  host: HTMLElement,
  check: (condition: boolean, message: string) => void,
  waitFor: (condition: () => boolean, message: string) => Promise<void>,
) {
  const sign = host.querySelector<HTMLButtonElement>(".town-apartments-sign")!;
  const canvas = host.querySelector<HTMLElement>(".town-canvas-host")!;
  const shell = host.querySelector<HTMLElement>(".town-shell")!;
  const inView = () => {
    const box = sign.getBoundingClientRect();
    const frame = canvas.getBoundingClientRect();
    return (
      box.top >= frame.top &&
      box.left >= frame.left &&
      box.bottom <= frame.bottom &&
      box.right <= frame.right
    );
  };
  // The world layer follows the camera on Town's next frame.
  const frame = () =>
    new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  const press = async (key: string) => {
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    await frame();
  };
  canvas.focus();
  // Closer in, then away until the sign is out of the camera's view.
  for (let step = 0; step < 3; step += 1) await press("+");
  for (const key of ["ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"])
    for (let step = 0; step < 40 && inView(); step += 1) await press(key);
  await waitFor(() => !inView(), "the arrows never took the sign off camera");
  spotlightHelpTarget(sign);
  await waitFor(inView, "Try did not bring the Apartments sign into view");
  check(
    shell.scrollTop === 0 && shell.scrollLeft === 0,
    `Try scrolled the Town shell to ${shell.scrollLeft},${shell.scrollTop}`,
  );
  check(
    (document.scrollingElement?.scrollTop ?? 0) === 0,
    "Try scrolled the page",
  );
  sign.removeAttribute("data-help-spotlight");
}

/**
 * A search while a lens is on (#784): its matches are outlined in the lens
 * layer, over the lens's tints, every room keeps its lens colour, and
 * Escape on the map ends the search but leaves the lens on.
 */
async function checkSearchOverLens(
  host: HTMLElement,
  check: (condition: boolean, message: string) => void,
  waitFor: (condition: () => boolean, message: string) => Promise<void>,
) {
  const tints = () =>
    [...host.querySelectorAll<HTMLElement>(".town-lens-room")].map(
      (room) => `${room.dataset.mark} ${room.style.cssText}`,
    );
  const before = tints();
  const name = host.querySelector(".town-lens-room-label b")!.textContent!;
  // Typed into World's one search box, as it is in Town.
  const type = (value: string) => worldFinder.type("town", value);
  type(name.toLowerCase());
  const marks = () => [
    ...host.querySelectorAll<HTMLElement>(
      ".town-lens > .town-lens-search > .town-lens-search-mark",
    ),
  ];
  await waitFor(
    () => marks().some((mark) => mark.style.width !== ""),
    "a search over a lens drew no marks in the lens layer",
  );
  check(
    host.querySelector(".town-lens")!.lastElementChild!.className ===
      "town-lens-search",
    "the search's marks are not over the lens's tints",
  );
  check(
    getComputedStyle(marks()[0]!).boxShadow !== "none",
    "a match over a lens has no outline",
  );
  check(
    JSON.stringify(tints()) === JSON.stringify(before),
    "a search changed the lens's colours",
  );
  // Escape on the map ends the search; the lens stays as it was.
  host
    .querySelector<HTMLElement>(".town-canvas-host")!
    .dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  await waitFor(
    () => host.querySelector(".town-lens-search") === null,
    "Escape on the map did not end the search",
  );
  check(worldFinder.get() === null, "Escape on the map left the query");
  check(
    host.querySelector(".town-lens-legend") !== null,
    "ending the search left the lens",
  );
  check(
    JSON.stringify(tints()) === JSON.stringify(before),
    "the lens did not come back as it was",
  );
}
