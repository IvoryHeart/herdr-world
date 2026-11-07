import { connectTownReceptionFilter } from "./townReceptionSetting";

/**
 * The reception filter's visibility rule in the real Town scene (#501): with
 * Done filtered, every finished agent is still seated at its desk with its
 * mark, reception keeps no finish, the Town board, building sign, room
 * plaques and Needs you count are unchanged (accessible targets follow the
 * bodies on screen, so they are not counted as facts), find picks the kept agents out
 * and Next walks them, and Reset to default for all buildings brings
 * everyone back. Zoomed in to desks, where boards hide, a tap on a lobby
 * brings its board and filter back.
 */
export async function checkTownReceptionFilter(
  host: HTMLElement,
  check: (condition: boolean, message: string) => void,
  waitFor: (
    condition: () => boolean,
    message: string | (() => string),
  ) => Promise<void>,
) {
  await waitFor(
    () => window.__HERDR_TOWN_RENDERER__?.ready === true,
    "the reception fixture's renderer never became ready",
  );
  const renderer = window.__HERDR_TOWN_RENDERER__!;
  // The World service's write path; the fixture has no socket.
  const saved: unknown[] = [];
  connectTownReceptionFilter(async (value) => {
    saved.push(value);
  });
  const facts = () =>
    JSON.stringify([
      host.querySelector(".town-board-counts")?.textContent ??
        host.querySelector(".town-board-chip")?.getAttribute("aria-label"),
      document.querySelector(".needs-you-counter")?.getAttribute("aria-label"),
      [
        ...host.querySelectorAll(".town-building-sign .town-reception-tags"),
      ].map((tags) => tags.textContent),
      [...host.querySelectorAll(".town-room-plaque-count")].map((count) =>
        count.getAttribute("title"),
      ),
    ]);
  const finished = () =>
    [
      ...host.querySelectorAll<HTMLElement>(
        '.world-semantic-target[data-kind="agent"]',
      ),
    ]
      .filter((target) =>
        target.getAttribute("aria-label")?.includes(", done, desk "),
      )
      .map((target) => target.dataset.targetKey ?? "");
  await waitFor(
    () =>
      finished().length > 0 &&
      host.querySelector(".town-reception-done") !== null &&
      host.querySelector(".town-reception-sign") !== null,
    "the reception fixture has no finished visitor or no reception sign",
  );
  const before = facts();
  const sign = () =>
    [...host.querySelectorAll<HTMLButtonElement>(".town-reception-sign")].find(
      (button) =>
        button
          .closest(".town-reception")
          ?.querySelector(".town-reception-done"),
    ) ?? host.querySelector<HTMLButtonElement>(".town-reception-sign")!;
  const box = sign().getBoundingClientRect();
  if (window.innerWidth <= 640)
    check(
      box.width >= 40 && box.height >= 40,
      `the phone reception sign is ${box.width}×${box.height}, under 40 px`,
    );
  check(
    sign().querySelectorAll('[data-taken="false"]').length === 0,
    "the default reception sign greys a mark",
  );
  sign().click();
  const filter = () =>
    document.querySelector<HTMLElement>(".town-reception-filter");
  await waitFor(() => filter() !== null, "the reception sign opened no filter");
  const doneBox = [...filter()!.querySelectorAll("label")]
    .find((label) => label.textContent?.includes("Done"))
    ?.querySelector<HTMLInputElement>("input");
  check(doneBox?.checked === true, "Done is not ticked by default");
  const allBox = () =>
    [...filter()!.querySelectorAll("label")]
      .find((label) => label.textContent?.includes("Apply to all buildings"))
      ?.querySelector<HTMLInputElement>("input");
  check(allBox()?.checked === false, "Apply to all buildings starts ticked");
  // Every building's finished agents stay at their desks.
  allBox()?.click();
  doneBox?.click();
  const kept = finished();
  await waitFor(
    () =>
      kept.every((key) => renderer.held.includes(key)) &&
      renderer.walking === 0 &&
      host.querySelector(".town-reception-done") === null,
    () =>
      `finished agents did not all return to their desks: ${kept.length} finished, ${renderer.held.length} seated, ${renderer.walking} walking`,
  );
  check(
    JSON.stringify(saved[saved.length - 1]) ===
      JSON.stringify({ default: ["blocked", "ask"], hosts: {} }),
    `the filter was not saved to World: ${JSON.stringify(saved)}`,
  );
  check(renderer.actors >= kept.length, "a filtered agent left the scene");
  check(
    facts() === before,
    `filtering changed facts: ${before} became ${facts()}`,
  );
  check(
    sign().querySelector('[data-taken="false"]') !== null,
    "the reception sign does not grey the filtered mark",
  );
  // Close the filter; the tag counts the kept agents and finds them.
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  await waitFor(() => filter() === null, "Escape did not close the filter");
  const tag = [
    ...host.querySelectorAll<HTMLElement>("[data-reception-held]"),
  ].find((element) => element.querySelector(".town-reception-find"));
  check(
    tag !== undefined && /\d+\s*at desks/.test(tag.textContent ?? ""),
    "reception has no count tag with find",
  );
  tag?.querySelector<HTMLButtonElement>(".town-reception-find")?.click();
  const peeked = () =>
    host.ownerDocument.querySelector<HTMLElement>(".town-peek")?.dataset
      .agentKey ?? "";
  await waitFor(
    () => kept.includes(peeked()),
    "find did not show an agent kept at its desk",
  );
  const first = peeked();
  const next = [
    ...host.ownerDocument.querySelectorAll<HTMLButtonElement>(
      ".town-peek button",
    ),
  ].find((button) => button.textContent?.includes("Next"));
  if (next) {
    next.click();
    await waitFor(
      () => peeked() !== first && kept.includes(peeked()),
      "Next did not walk to another agent kept at its desk",
    );
  }
  host.ownerDocument
    .querySelector<HTMLButtonElement>(".town-peek-close")
    ?.click();
  // Reset to default: everyone who belongs at reception walks back.
  sign().click();
  await waitFor(() => filter() !== null, "the reception sign did not reopen");
  check(allBox()?.checked === false, "Apply to all buildings stayed ticked");
  allBox()?.click();
  [...filter()!.querySelectorAll("button")]
    .find((button) => button.textContent === "Reset to default")
    ?.click();
  await waitFor(
    () =>
      renderer.held.length === 0 &&
      host.querySelector("[data-reception-held]") === null &&
      host.querySelector(".town-reception-done") !== null,
    "Reset to default did not bring finished agents back to reception",
  );
  check(saved[saved.length - 1] === undefined, "the reset was not saved");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  check(facts() === before, "resetting the filter changed facts");
  await filterAtDeskLevel(host, renderer, sign, filter, waitFor);
}

/** Zoomed in to desks the board hides; a tap on its lobby brings it back. */
async function filterAtDeskLevel(
  host: HTMLElement,
  renderer: NonNullable<typeof window.__HERDR_TOWN_RENDERER__>,
  sign: () => HTMLButtonElement,
  filter: () => HTMLElement | null,
  waitFor: (
    condition: () => boolean,
    message: string | (() => string),
  ) => Promise<void>,
) {
  await waitFor(() => filter() === null, "Escape did not close the filter");
  for (let into = 0; into < 8 && renderer.level !== "desk"; into += 1) {
    const frames = renderer.frames;
    host.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click();
    await waitFor(
      () => renderer.frames > frames && !renderer.flying,
      "zooming in to desks never settled",
    );
  }
  // One building's board, found by name: off-screen buildings drop theirs.
  const name = `${sign().getAttribute("aria-label")!.split(" reception takes")[0]} reception takes`;
  const own = () =>
    [...host.querySelectorAll<HTMLButtonElement>(".town-reception-sign")].find(
      (button) => button.getAttribute("aria-label")?.startsWith(name),
    );
  const board = () => own()?.closest<HTMLElement>(".town-reception") ?? null;
  const shown = () => {
    const element = board();
    return element ? getComputedStyle(element).visibility === "visible" : false;
  };
  await waitFor(
    () => renderer.level === "desk" && board() !== null && !shown(),
    `the reception board is still up at ${renderer.level} level`,
  );
  const canvas = host.querySelector<HTMLElement>(".town-canvas-host")!;
  // The lobby floor starts two tiles under the back wall, 18 px below the
  // board's foot: its bottom row, clear of the queue, where the camera has
  // it now.
  const lobby = () => {
    const foot = board()?.getBoundingClientRect();
    return foot
      ? {
          x: foot.left + foot.width / 2,
          y: foot.bottom + (18 + 8.5 * 16) * renderer.zoom,
        }
      : null;
  };
  // Pan with the arrow keys, as a person would, until the lobby is in view
  // just under the top, where its board would be cut off.
  const aim = () => {
    const at = lobby();
    if (!at) return "ArrowUp";
    if (at.x < window.innerWidth * 0.25) return "ArrowLeft";
    if (at.x > window.innerWidth * 0.75) return "ArrowRight";
    if (at.y < 60) return "ArrowUp";
    if (at.y > 320) return "ArrowDown";
    return null;
  };
  for (let pan = 0, key = aim(); pan < 80 && key; pan += 1, key = aim()) {
    const frames = renderer.frames;
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    await waitFor(
      () => renderer.frames > frames && !renderer.flying,
      "panning to the lobby never settled",
    );
  }
  const at = lobby();
  await waitFor(
    () => at !== null && aim() === null,
    () =>
      `panning never brought the lobby into view: ${JSON.stringify(lobby())}`,
  );
  for (const type of ["pointerdown", "pointerup"])
    canvas.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 41,
        isPrimary: true,
        pointerType: "mouse",
        button: 0,
        buttons: type === "pointerdown" ? 1 : 0,
        clientX: at!.x,
        clientY: at!.y,
      }),
    );
  await waitFor(
    () => {
      const box = board()?.getBoundingClientRect();
      return (
        board()?.dataset.open === "true" &&
        shown() &&
        !renderer.flying &&
        renderer.level === "desk" &&
        !!box &&
        box.top >= 0 &&
        box.bottom <= window.innerHeight
      );
    },
    () => {
      const box = board()?.getBoundingClientRect();
      return `a tap on the lobby at desk level did not bring its board into view: open ${board()?.dataset.open}, shown ${shown()}, level ${renderer.level}, flying ${renderer.flying}, board ${Math.round(box?.top ?? NaN)}–${Math.round(box?.bottom ?? NaN)} of ${window.innerHeight}, tapped ${JSON.stringify(at)} at zoom ${renderer.zoom.toFixed(2)}`;
    },
  );
  own()!.click();
  await waitFor(
    () => filter() !== null,
    "the board brought back at desk level opened no filter",
  );
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
}
