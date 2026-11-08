/**
 * Edge arrows and Next in a real zoomed-in Town (townEdgeArrows.ts,
 * townNext.ts): an arrow points at a waiting agent off screen, its click
 * glides there at the same zoom and pulses the mark, and N / Shift+N step
 * through Needs you's order on a desktop, silent while typing and on phones.
 */
import { closeNeedsYou, needsYouState } from "../needsYou";

export async function checkTownEdgeArrows({
  host,
  check,
  waitFor,
}: {
  host: HTMLElement;
  check: (condition: boolean, message: string) => void;
  waitFor: (
    condition: () => boolean,
    message: string | (() => string),
  ) => Promise<void>;
}) {
  const renderer = window.__HERDR_TOWN_RENDERER__!;
  const phone = window.innerWidth <= 640;
  const arrows = () => [
    ...host.querySelectorAll<HTMLButtonElement>(".town-edge-arrow"),
  ];
  await waitFor(
    () => arrows().length > 0,
    "zoomed into a room, no arrow points at waiting agents off screen",
  );
  const arrow = arrows()[0]!;
  const label = arrow.getAttribute("aria-label") ?? "";
  check(
    /^\d+ .+ in .+, to the [a-z-]+, go there$/.test(label),
    `an edge arrow's name says what waits, where and the way: ${label}`,
  );
  check(
    ["!", "?", "✓"].includes(
      arrow.querySelector(".town-edge-arrow-mark")?.textContent ?? "",
    ),
    "an edge arrow carries the agent's mark",
  );
  const zoom = renderer.zoom;
  arrow.click();
  await waitFor(
    () => host.querySelector(".town-pulse") !== null,
    "an edge arrow's agent did not pulse",
  );
  // The glide ends with the agent in view (frames report flying a frame late).
  const ringAt = () => {
    const ring = host.querySelector(".town-pulse")?.getBoundingClientRect();
    return ring
      ? { x: ring.left + ring.width / 2, y: ring.top + ring.height / 2 }
      : null;
  };
  await waitFor(
    () => {
      const at = ringAt();
      return Boolean(
        at &&
          !renderer.flying &&
          at.x >= 0 &&
          at.x <= window.innerWidth &&
          at.y >= 0 &&
          at.y <= window.innerHeight,
      );
    },
    () =>
      `an edge arrow's agent is still off screen at ${JSON.stringify(ringAt())}`,
  );
  check(
    Math.abs(renderer.zoom - zoom) < zoom * 0.02,
    `an edge arrow changed the zoom from ${zoom} to ${renderer.zoom}`,
  );

  const press = (target: EventTarget, shiftKey = false) =>
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: shiftKey ? "N" : "n",
        code: "KeyN",
        shiftKey,
        bubbles: true,
        cancelable: true,
      }),
    );
  const next = () => host.querySelector<HTMLElement>(".town-next-label");
  const shown = (pattern: RegExp) => {
    const text = next();
    return Boolean(
      text && !text.hidden && pattern.test(text.textContent ?? ""),
    );
  };
  const sequence = needsYouState().request.sequence;
  if (phone) {
    press(document.body);
    await new Promise((resolve) => setTimeout(resolve, 100));
    check(
      needsYouState().request.sequence === sequence && next()?.hidden !== false,
      "N acted on a phone, which has no N",
    );
    return;
  }
  press(document.body);
  await waitFor(
    () => shown(/^1 of \d+ · N next$/),
    () => `N did not show its position: ${next()?.textContent}`,
  );
  const first = needsYouState().request.itemKey;
  check(
    needsYouState().open && Boolean(first),
    "N did not open Needs you at its item",
  );
  press(document.body);
  await waitFor(() => shown(/^2 of \d+ · N next$/), "a second N did not step");
  check(
    needsYouState().request.itemKey !== first,
    "a second N opened Needs you at the same item",
  );
  press(document.body, true);
  await waitFor(() => shown(/^1 of /), "Shift+N did not go back");
  check(
    needsYouState().request.itemKey === first,
    "Shift+N did not go back to the first item",
  );
  // Typing an N in a field is typing.
  const field = document.createElement("input");
  host.append(field);
  const before = needsYouState().request.sequence;
  press(field);
  check(
    needsYouState().request.sequence === before,
    "N in a text field moved Town",
  );
  field.remove();
  closeNeedsYou();
}
