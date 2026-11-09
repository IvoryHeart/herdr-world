/**
 * Town's group selection in the real scene (#820): a Shift box selects the
 * agents drawn in it (the command card takes the board sign's place, and
 * "selected" joins their accessible names), Shift+click removes one, Mark
 * reviewed (N) marks exactly N through the reviewed record, and the board's
 * Done count drops by N once Escape clears the selection.
 */
export async function checkTownGroup(
  host: HTMLElement,
  check: (condition: boolean, message: string) => void,
  waitFor: (
    condition: () => boolean,
    message: string | (() => string),
  ) => Promise<void>,
  reviews: () => number,
) {
  await waitFor(
    () => window.__HERDR_TOWN_RENDERER__?.ready === true,
    "the group fixture's renderer never became ready",
  );
  const canvas = host.querySelector<HTMLElement>(".town-canvas-host")!;
  const agents = () => [
    ...host.querySelectorAll<HTMLElement>(
      '.world-semantic-target[data-kind="agent"]',
    ),
  ];
  const selected = () =>
    agents().filter((target) =>
      target.getAttribute("aria-label")?.endsWith(", selected"),
    );
  const doneCount = () =>
    Number(
      [...host.querySelectorAll(".town-board-counts div")]
        .find((cell) => cell.querySelector("dt")?.textContent === "Done")
        ?.querySelector("dd")?.textContent,
    );
  await waitFor(
    () => doneCount() > 0 && agents().length > 0,
    "the group fixture has no finished agents",
  );
  const before = doneCount();
  const press = (type: string, at: { x: number; y: number }, shiftKey = true) =>
    canvas.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 7,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: at.x,
        clientY: at.y,
        shiftKey,
      }),
    );
  const card = () => host.querySelector<HTMLElement>(".town-group-card");
  const countsText = () =>
    card()?.querySelector(".town-group-counts")?.textContent ?? "";
  const selectedCount = () =>
    Number(/^(\d+) selected/.exec(countsText())?.[1] ?? 0);

  // Shift+drag a box over most of the map, past the board sign: every agent
  // drawn there is taken, at its desk, at reception or at the bar.
  const rect = canvas.getBoundingClientRect();
  const from = { x: rect.left + 300, y: rect.top + 20 };
  const to = { x: rect.right - 20, y: rect.bottom - 20 };
  press("pointerdown", from);
  press("pointermove", { x: from.x + 40, y: from.y + 40 });
  check(
    host.querySelector(".town-select-box") !== null,
    "a Shift drag draws no selection box",
  );
  press("pointermove", to);
  press("pointerup", to);
  check(
    host.querySelector(".town-select-box") === null,
    "the selection box stays after the drag ends",
  );
  await waitFor(
    () => card() !== null && selectedCount() > 1 && selected().length > 0,
    () =>
      `a Shift box selected nothing (card ${card() !== null}, "${countsText()}")`,
  );
  check(
    host.querySelector(".town-board-counts") === null,
    "the command card does not take the Town board sign's place",
  );
  const finished = Number(/(\d+) finished/.exec(countsText())?.[1] ?? 0);
  check(finished >= 1, `the box took no finished agent: "${countsText()}"`);
  check(
    selected().length <= selectedCount(),
    `${selected().length} targets say selected, the card ${selectedCount()}`,
  );

  // Shift+click a seated working agent: it leaves the selection.
  const working = selected().find((target) => {
    const box = target.getBoundingClientRect();
    return (
      target.getAttribute("aria-label")?.includes(", working, ") &&
      box.left > rect.left + 320 &&
      box.top > rect.top + 30 &&
      box.right < rect.right - 30 &&
      box.bottom < rect.bottom - 30
    );
  });
  if (working) {
    const count = selectedCount();
    const box = working.getBoundingClientRect();
    const at = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    press("pointerdown", at);
    press("pointerup", at);
    await waitFor(
      () => selectedCount() < count,
      "Shift+click on a selected agent did not remove it",
    );
    check(
      !working.getAttribute("aria-label")?.endsWith(", selected"),
      "a Shift+clicked agent is still announced selected",
    );
  } else check(false, "the box selected no seated working agent on screen");

  // Mark reviewed (N): N is exactly the finished agents selected.
  const review = [
    ...card()!.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent?.startsWith("Mark reviewed"))!;
  const n = Number(/\((\d+)/.exec(review.textContent ?? "")?.[1]);
  const nowFinished = Number(/(\d+) finished/.exec(countsText())?.[1] ?? 0);
  check(
    n === nowFinished && n >= 1,
    `Mark reviewed counts ${n}, the card ${nowFinished} finished`,
  );
  const marks = reviews();
  review.click();
  await waitFor(
    () =>
      [...card()!.querySelectorAll(".town-group-results li")].filter(
        (row) => row.getAttribute("data-status") === "reviewed",
      ).length === n,
    "Mark reviewed did not report every selected finished agent reviewed",
  );
  check(
    reviews() - marks === n,
    `Mark reviewed saved ${reviews() - marks} marks, not ${n}`,
  );

  // Escape clears; the board is back and its Done count dropped by N.
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  await waitFor(
    () => card() === null && host.querySelector(".town-board-counts") !== null,
    "Escape did not clear the selection",
  );
  check(selected().length === 0, "cleared agents are still announced selected");
  await waitFor(
    () => doneCount() === before - n,
    () => `the board's Done count is ${doneCount()}, not ${before} - ${n}`,
  );
}
