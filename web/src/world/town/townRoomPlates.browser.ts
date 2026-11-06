import { store } from "../../store";
import type { LaunchTarget } from "../agentProfiles";
import { prepareTownRoomCard } from "./townRoomCard.browser";

/** Geometry and input checks against the real Town scene's synthetic dense rooms. */
export async function checkTownRoomPlates(
  host: HTMLElement,
  check: (condition: boolean, message: string) => void,
  waitFor: (
    condition: () => boolean,
    message: string | (() => string),
  ) => Promise<void>,
  target: Pick<LaunchTarget, "connectionId" | "generation" | "workspaceId">,
) {
  const renderer = window.__HERDR_TOWN_RENDERER__!;
  await prepareTownRoomCard(host, renderer, waitFor);
  const before = renderer.frames;
  host.querySelector<HTMLButtonElement>(".town-room-card")!.click();
  await waitFor(
    () =>
      renderer.frames > before &&
      !renderer.flying &&
      renderer.level !== "overview",
    "dense room focus never settled",
  );
  const plates = [...host.querySelectorAll<HTMLElement>(".town-room-plaque")];
  const overflow = plates.filter((plate) => {
    const box = plate.getBoundingClientRect();
    const room = plate.closest(".town-room")!.getBoundingClientRect();
    return box.left < room.left + 7 || box.right > room.right - 7;
  });
  check(
    plates.length >= 3 && overflow.length === 0,
    `${overflow.length} of ${plates.length} dense room plates exceed their room's padded width`,
  );
  check(
    host.querySelector('.town-room-plaque [aria-label^="New agent in "]') ===
      null,
    "room plates still contain a New agent control",
  );
  const names = plates.map(
    (plate) => plate.querySelector<HTMLElement>(".town-room-plaque-name")!,
  );
  check(
    names.some((name) => name.scrollWidth > name.clientWidth) &&
      names.every(
        (name) =>
          getComputedStyle(name).textOverflow === "ellipsis" &&
          name.title === name.textContent?.trim(),
      ),
    "long room names need end ellipsis and their complete name in a tooltip",
  );
  check(
    plates.every((plate) => {
      const count = plate.querySelector<HTMLElement>(".town-room-plaque-count");
      const swatch = plate.querySelector<HTMLElement>(".color-swatch-button");
      const badge = plate.querySelector<HTMLElement>(".town-room-plaque-badge");
      return (
        !!count &&
        !!swatch &&
        /^\d+\/\d+$/.test(count.textContent ?? "") &&
        count.title === count.getAttribute("aria-label") &&
        getComputedStyle(count).fontVariantNumeric.includes("tabular-nums") &&
        count.scrollWidth <= count.clientWidth + 1 &&
        (!badge || badge.scrollWidth <= badge.clientWidth + 1)
      );
    }),
    "room count, colour and blocked badge must stay visible outside the truncated name",
  );
  const counters = plates.map(
    (plate) => plate.querySelector<HTMLElement>(".town-room-plaque-count")!,
  );
  check(
    counters.some(
      (count) =>
        count.textContent === "3/8" &&
        count.title === "3 of 8 agents active: 2 working, 1 waiting on you",
    ),
    "mixed agent statuses must show 3/8, without counting plain terminals or asks",
  );
  check(
    ["0/2", "0/0", "2/2"].every((value) =>
      counters.some((count) => count.textContent === value),
    ),
    "idle, empty and all-active rooms need explicit active/total counts",
  );
  check(
    counters.every((count) => {
      const total = count.querySelector<HTMLElement>(
        ".town-room-plaque-total",
      )!;
      const zero = count.textContent!.startsWith("0/");
      return zero
        ? Number(getComputedStyle(count).opacity) < 1 &&
            Number(getComputedStyle(total).opacity) === 1
        : Number(getComputedStyle(count).opacity) === 1 &&
            Number(getComputedStyle(total).opacity) < 1;
    }),
    "the total must be muted, and zero-active counters must be wholly muted",
  );
  const plate = plates[0]!;
  const nameBox = plate
    .querySelector(".town-room-plaque-name")!
    .getBoundingClientRect();
  check(
    document
      .elementFromPoint(
        nameBox.left + nameBox.width / 2,
        nameBox.top + nameBox.height / 2,
      )
      ?.closest(".town-room-plaque") === plate,
    "the visible room plate must receive its native pointer hit",
  );
  const actions = plate.querySelector<HTMLElement>(".town-room-plaque-actions");
  check(!actions, "room management controls belong in the shared summary card");
  const receivesPointer = (element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    return element.contains(
      document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      ),
    );
  };
  const width = plate.getBoundingClientRect().width;
  plate.dispatchEvent(
    new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }),
  );
  await waitFor(
    () => document.querySelector(".town-place-summary") !== null,
    "hovering a room name did not show its summary",
  );
  const hoverCard = document.querySelector<HTMLElement>(".town-place-summary")!;
  const cardStyle = getComputedStyle(hoverCard);
  const plateStyle = getComputedStyle(plate);
  check(
    cardStyle.backgroundColor === plateStyle.backgroundColor &&
      cardStyle.color === plateStyle.color &&
      cardStyle.borderTopColor === plateStyle.borderTopColor &&
      getComputedStyle(hoverCard.querySelector("header strong")!).fontFamily ===
        getComputedStyle(plate.querySelector(".town-room-plaque-name")!)
          .fontFamily,
    "place summaries must use the room plaque's wood palette and Town heading font",
  );
  const canvas = host.querySelector<HTMLElement>(".town-canvas-host")!;
  canvas.dispatchEvent(
    new PointerEvent("pointerleave", { pointerType: "mouse" }),
  );
  const afterLabelDelay = performance.now() + 250;
  await waitFor(
    () => performance.now() >= afterLabelDelay,
    "label hover dismiss deadline did not elapse",
  );
  check(
    document.querySelector(".town-place-summary") === hoverCard,
    "a queued canvas leave must not dismiss the room label's hover summary",
  );
  plate.dispatchEvent(
    new PointerEvent("pointerout", {
      bubbles: true,
      pointerType: "mouse",
      relatedTarget: hoverCard,
    }),
  );
  hoverCard.dispatchEvent(
    new PointerEvent("pointerover", {
      bubbles: true,
      pointerType: "mouse",
      relatedTarget: plate,
    }),
  );
  // A queued scene hover-clear can arrive after the portal receives the pointer.
  canvas.dispatchEvent(
    new PointerEvent("pointerleave", { pointerType: "mouse" }),
  );
  const afterDismissDelay = performance.now() + 250;
  await waitFor(
    () => performance.now() >= afterDismissDelay,
    "hover dismiss deadline did not elapse",
  );
  check(
    document.querySelector(".town-place-summary") === hoverCard &&
      hoverCard.querySelector('[aria-label^="Rename room "]') !== null &&
      hoverCard.querySelector('[aria-label^="Close room "]') !== null,
    "moving from a room name into its combined actions/summary card must keep that card open",
  );
  document
    .querySelector<HTMLButtonElement>('[aria-label="Close place summary"]')!
    .click();
  await waitFor(
    () => document.querySelector(".town-place-summary") === null,
    "hovered room summary did not close",
  );
  plate.focus();
  await waitFor(
    () => document.querySelector(".town-place-summary") !== null,
    "focusing a room name did not show its summary",
  );
  const roomSummary = document.querySelector<HTMLElement>(
    ".town-place-summary",
  )!;
  check(
    roomSummary.textContent?.includes("Needs you") === true &&
      roomSummary.textContent?.includes("Done, not reviewed") === true,
    "room summary must reuse the board's attention sections",
  );
  check(
    !roomSummary.textContent?.includes("Spend") &&
      !roomSummary.textContent?.includes("Hosts and rooms"),
    "place summary must omit town-wide spend and topology",
  );
  const sharedActions = roomSummary.querySelector<HTMLElement>(
    ".town-place-summary-actions",
  );
  check(
    !!sharedActions &&
      [...sharedActions.querySelectorAll("button")].every(
        (button) =>
          button.getBoundingClientRect().height >= 39.5 &&
          receivesPointer(button),
      ) &&
      sharedActions.querySelector('[aria-label^="Rename room "]') !== null &&
      sharedActions.querySelector('[aria-label^="Close room "]') !== null &&
      Math.abs(plate.getBoundingClientRect().width - width) < 1,
    "room summary must contain reachable Rename and Close controls without widening the name plate",
  );
  plate.blur();
  plate.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }),
  );
  await waitFor(
    () => document.querySelector(".town-place-summary") !== null,
    "a touch on the room name did not show its summary",
  );
  check(
    document.querySelector(
      '.town-place-summary [aria-label^="Rename room "]',
    ) !== null &&
      document.querySelector(
        '.town-place-summary [aria-label^="Close room "]',
      ) !== null,
    "touch must reveal the same combined actions and room summary",
  );
  document
    .querySelector<HTMLButtonElement>('[aria-label="Close place summary"]')!
    .click();
  await waitFor(
    () => document.querySelector(".town-place-summary") === null,
    "room summary did not close",
  );
  plate.blur();
  const tableName = host.querySelector<HTMLButtonElement>(
    '[data-town-place-summary-trigger="desk"]',
  )!;
  check(
    receivesPointer(tableName),
    "the table title must receive native pointer hits",
  );
  tableName.dispatchEvent(
    new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }),
  );
  await waitFor(
    () => document.querySelector(".town-place-summary") !== null,
    "hovering a table name did not show its summary",
  );
  const tableSummary = document.querySelector(".town-place-summary");
  canvas.dispatchEvent(
    new PointerEvent("pointerleave", { pointerType: "mouse" }),
  );
  const afterTableLabelDelay = performance.now() + 250;
  await waitFor(
    () => performance.now() >= afterTableLabelDelay,
    "table label hover dismiss deadline did not elapse",
  );
  check(
    document.querySelector(".town-place-summary") === tableSummary,
    "a queued canvas leave must not dismiss the table title's hover summary",
  );
  document
    .querySelector<HTMLButtonElement>('[aria-label="Close place summary"]')!
    .click();
  await waitFor(
    () => document.querySelector(".town-place-summary") === null,
    "hovered table summary did not close",
  );
  const tableTarget = [
    ...host.querySelectorAll<HTMLElement>(
      '.world-semantic-target[data-kind="desk"]',
    ),
  ].find(
    (target) => target.dataset.targetKey === tableName.dataset.townDeskKey,
  )!;
  const tableBox = tableTarget.getBoundingClientRect();
  canvas.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      pointerType: "mouse",
      clientX: tableBox.left + tableBox.width / 2,
      clientY: tableBox.top + tableBox.height / 2,
    }),
  );
  await waitFor(
    () =>
      document
        .querySelector(".town-place-summary")
        ?.getAttribute("aria-label") === `Summary of ${tableName.textContent}`,
    "hovering the canvas table did not show its summary",
  );
  document
    .querySelector<HTMLButtonElement>('[aria-label="Close place summary"]')!
    .click();
  await waitFor(
    () => document.querySelector(".town-place-summary") === null,
    "canvas table summary did not close",
  );
  tableName.click();
  await waitFor(
    () => document.querySelector(".town-place-summary") !== null,
    "tapping a table name did not show its summary",
  );
  const card = document.querySelector<HTMLElement>(".town-place-summary")!;
  const cardBox = card.getBoundingClientRect();
  check(
    card.getAttribute("aria-label") === `Summary of ${tableName.textContent}` &&
      cardBox.left >= 0 &&
      cardBox.right <= window.innerWidth &&
      cardBox.top >= 0 &&
      cardBox.bottom <= window.innerHeight,
    "the table's own summary must fit the viewport",
  );
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await waitFor(
    () => document.querySelector(".town-place-summary") === null,
    "Escape did not close the place summary",
  );
  const seat = host.querySelector<HTMLButtonElement>(
    '.town-new-seat[aria-label^="New agent or terminal in "]',
  );
  check(
    !!seat,
    "the empty seat must offer the room's agent-or-terminal launcher",
  );
  if (!seat) return;
  const seatBox = seat.getBoundingClientRect();
  check(
    getComputedStyle(seat).borderTopStyle === "dashed" &&
      document
        .elementFromPoint(
          seatBox.left + seatBox.width / 2,
          seatBox.top + seatBox.height / 2,
        )
        ?.closest(".town-new-seat") === seat,
    "the room's + must be a visible dashed seat receiving native pointer hits",
  );
  const originalCreate = store.createQualifiedTab;
  const created: {
    connectionId: string;
    runtimeGeneration: number;
    workspaceId: string;
  }[] = [];
  store.createQualifiedTab = async (owner, workspaceId) => {
    created.push({ ...owner, workspaceId });
  };
  try {
    seat.click();
    await waitFor(
      () => document.querySelector(".agent-launcher") !== null,
      "the empty seat did not open the launcher",
    );
    const terminal = document.querySelector<HTMLButtonElement>(
      ".agent-launcher-card",
    );
    check(
      terminal?.textContent?.includes("Terminal") === true,
      "Terminal must be the launcher's first choice",
    );
    if (!terminal?.textContent?.includes("Terminal")) return;
    terminal.click();
    await waitFor(
      () => created.length === 1,
      "Terminal did not use the qualified plain-tab creation action",
    );
    check(
      created[0]!.connectionId === target.connectionId &&
        created[0]!.runtimeGeneration === target.generation &&
        created[0]!.workspaceId === target.workspaceId,
      `the seat's Terminal choice changed its qualified room (${JSON.stringify(created)})`,
    );
    await waitFor(
      () => document.querySelector(".agent-launcher") === null,
      "successful Terminal creation did not close the launcher",
    );
    store.createQualifiedTab = async () => {
      throw new Error("Synthetic terminal refusal");
    };
    seat.click();
    await waitFor(
      () => document.querySelector(".agent-launcher-card") !== null,
      "the seat did not reopen the launcher",
    );
    document.querySelector<HTMLButtonElement>(".agent-launcher-card")!.click();
    await waitFor(
      () =>
        document
          .querySelector(".agent-launcher")!
          .textContent?.includes("Synthetic terminal refusal") === true,
      "Terminal creation failure did not remain visible in the launcher",
    );
  } finally {
    store.createQualifiedTab = originalCreate;
  }
}
