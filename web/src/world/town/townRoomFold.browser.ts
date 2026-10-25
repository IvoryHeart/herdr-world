/** Interactions and paired-tile geometry for the synthetic 26-desk room. */
export async function checkTownRoomFold(
  host: HTMLElement,
  check: (condition: boolean, message: string) => void,
  waitFor: (condition: () => boolean, message: string) => Promise<void>,
  expectedActive: number,
  expectedTotal: number,
) {
  const renderer = window.__HERDR_TOWN_RENDERER__!;
  const card = [
    ...host.querySelectorAll<HTMLButtonElement>(".town-room-card"),
  ].find((candidate) => candidate.textContent?.includes("fold-room"));
  check(!!card, "the synthetic fold room has an overview card");
  if (!card) return;
  const room = card.closest<HTMLElement>(".town-room");
  if (!room) return;
  const before = renderer.frames;
  card.click();
  await waitFor(
    () =>
      renderer.frames > before &&
      !renderer.flying &&
      renderer.level !== "overview",
    "the synthetic fold room focus never settled",
  );

  const deskTargets = () =>
    [
      ...host.querySelectorAll<HTMLElement>(
        '.world-semantic-target[data-kind="desk"]',
      ),
    ]
      .map((target) => target.dataset.targetKey ?? "")
      .filter((key) => key.includes("fold-room-tab-"))
      .sort();
  await waitFor(
    () =>
      deskTargets().length === 24 &&
      host.querySelector(
        '.world-semantic-targets-overlay[aria-busy="false"]',
      ) !== null,
    "the 26-desk room did not settle into its folded set",
  );
  const foldedKeys = deskTargets();
  const fold = room.querySelector<HTMLButtonElement>(".town-fold-tile");
  const seat = room.querySelector<HTMLButtonElement>(".town-new-seat");
  check(!!fold && !!seat, "fold and new-seat tiles are both present");
  check(
    !room.querySelector(".town-room-plaque .town-room-fold"),
    "fold moved out of the room plate",
  );
  check(
    room.querySelector(".town-room-plaque-count")?.textContent ===
      `${expectedActive}/${expectedTotal}` && expectedTotal === 26,
    `the plate count matches all 26 source agents (${room.querySelector(".town-room-plaque-count")?.textContent})`,
  );
  if (!fold || !seat) return;
  const foldBox = fold.getBoundingClientRect();
  const seatBox = seat.getBoundingClientRect();
  check(
    foldBox.height === seatBox.height &&
      foldBox.left > seatBox.left &&
      foldBox.top === seatBox.top &&
      fold.textContent?.includes("+2"),
    "the bottom-right fold tile pairs with the seat at the same height and shows +2",
  );

  const expandedBefore = renderer.frames;
  fold.click();
  await waitFor(
    () => renderer.frames > expandedBefore && deskTargets().length === 26,
    "the fold tile did not reveal both hidden desks",
  );
  check(
    fold.getAttribute("aria-expanded") === "true",
    "expanded state is exposed",
  );
  const allKeys = deskTargets();

  const foldedBefore = renderer.frames;
  fold.click();
  await waitFor(
    () => renderer.frames > foldedBefore && deskTargets().length === 24,
    "the fold tile did not fold the room again",
  );
  check(
    deskTargets().join("\n") === foldedKeys.join("\n"),
    "folding the same snapshot restores the identical stable set",
  );
  check(
    allKeys.includes(foldedKeys[0]!),
    "the expanded set retains folded desks",
  );
}
