import { store } from "../../store";
import type { LaunchTarget } from "../agentProfiles";

/** Geometry and input checks against the real Town scene's synthetic dense rooms. */
export async function checkTownRoomPlates(
  host: HTMLElement,
  check: (condition: boolean, message: string) => void,
  waitFor: (condition: () => boolean, message: string) => Promise<void>,
  target: Pick<LaunchTarget, "connectionId" | "generation" | "workspaceId">,
) {
  const renderer = window.__HERDR_TOWN_RENDERER__!;
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
  check(
    !!actions && getComputedStyle(actions).visibility === "hidden",
    "room management controls must start hidden",
  );
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
  plate.focus();
  check(
    !!actions &&
      getComputedStyle(actions).visibility === "visible" &&
      [...actions.querySelectorAll("button")].every(
        (button) =>
          button.getBoundingClientRect().width >= 39.5 &&
          button.getBoundingClientRect().height >= 39.5 &&
          receivesPointer(button),
      ) &&
      Math.abs(plate.getBoundingClientRect().width - width) < 1 &&
      actions.getBoundingClientRect().left >=
        plate.getBoundingClientRect().left - 1 &&
      actions.getBoundingClientRect().right <=
        plate.getBoundingClientRect().right + 1,
    "keyboard focus must reveal 40px room actions without widening the name plate",
  );
  plate.blur();
  plate.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }),
  );
  check(
    !!actions && getComputedStyle(actions).visibility === "visible",
    "a touch on the room plate must reveal its management controls",
  );
  plate.blur();
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
