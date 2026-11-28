import { clock } from "../testing/installTestClock";
/**
 * Reception at scale in the real Town scene (#903): a closed reception is a
 * small marquee of faces whose board controls are hidden and unfocusable;
 * keyboard focus opens the full board over it without moving or resizing the
 * marquee (the board placement measures the marquee), Tab reaches the board's
 * controls and the board closes when focus leaves.
 */
export async function checkTownReceptionMarquee(
  host: HTMLElement,
  check: (condition: boolean, message: string) => void,
  waitFor: (
    condition: () => boolean,
    message: string | (() => string),
  ) => Promise<void>,
) {
  const frame = () => clock.frame();
  await waitFor(
    () =>
      window.__HERDR_TOWN_RENDERER__?.ready === true &&
      host.querySelector(".town-reception .town-reception-face") !== null,
    "no reception showed a waiting face in its marquee",
  );
  const reception = host
    .querySelector(".town-reception .town-reception-face")!
    .closest<HTMLElement>(".town-reception")!;
  const board = reception.querySelector<HTMLElement>(".town-reception-board")!;
  const entry = board.querySelector<HTMLButtonElement>(
    ".town-reception-entry:not(:disabled)",
  );
  const open = () => getComputedStyle(board).visibility === "visible";
  const faces = reception.querySelectorAll(".town-reception-face").length;
  const marquee = reception.getBoundingClientRect();
  check(!open(), "a reception board is open before anyone asked");
  check(
    marquee.height <= 40 && faces > 0 && faces <= 5,
    `the closed reception is ${Math.round(marquee.height)} px tall with ${faces} faces, not a small marquee`,
  );
  check(
    reception
      .querySelector(".town-reception-marquee")
      ?.getAttribute("aria-hidden") === "true",
    "the marquee repeats the board's controls to assistive technology",
  );
  if (entry) {
    entry.focus();
    check(
      document.activeElement !== entry,
      "a closed board's control took keyboard focus",
    );
  }

  reception.focus();
  await waitFor(open, "keyboard focus on the reception did not open its board");
  await frame();
  await frame();
  const after = reception.getBoundingClientRect();
  check(
    Math.abs(after.left - marquee.left) < 1 &&
      Math.abs(after.top - marquee.top) < 1 &&
      Math.abs(after.height - marquee.height) < 1,
    "opening the board moved or resized the marquee",
  );
  const shown = board.getBoundingClientRect();
  check(
    shown.height > marquee.height && Math.abs(shown.bottom - after.bottom) < 2,
    "the open board does not stand on the marquee's foot",
  );
  if (entry) {
    entry.focus();
    check(
      document.activeElement === entry && open(),
      "the open board's first control did not take focus",
    );
  }
  (document.activeElement as HTMLElement | null)?.blur();
  await waitFor(() => !open(), "the board stayed open after focus left");
}
