import type { TestClock } from "../testing/testClock";
import { store } from "../../store";
import type { LaunchTarget } from "../agentProfiles";
import { prepareTownRoomCard } from "./townRoomCard.browser";

// A card hangs 3px into its plate's 2px border by design. Fractional layout at
// a true 390px viewport rounds that to 3.00006px, so allow float error (#643).
const CARD_OVERLAP = 3 + 0.01;

/** Geometry and input checks against the real Town scene's synthetic dense rooms. */
export async function checkTownRoomPlates(
  host: HTMLElement,
  check: (condition: boolean, message: string) => void,
  waitFor: (
    condition: () => boolean,
    message: string | (() => string),
  ) => Promise<void>,
  target: Pick<LaunchTarget, "connectionId" | "generation" | "workspaceId">,
  /** How many agents the town has opened or selected so far. */
  activations: () => number,
  clock: Pick<TestClock, "frame" | "advance">,
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
  const heading = plate.querySelector<HTMLElement>(
    ".town-room-plaque-heading",
  )!;
  const cardOpen = () =>
    plate.classList.contains("is-open") &&
    !!actions &&
    getComputedStyle(actions).visibility === "visible";
  // Hover and focus open nothing: only a click on the title does.
  plate.dispatchEvent(
    new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }),
  );
  plate.dispatchEvent(
    new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }),
  );
  plate.focus();
  await clock.frame();
  check(
    !cardOpen() && plate.getAttribute("aria-expanded") === "false",
    "hovering or focusing a room plate must not open its card",
  );
  heading.click();
  await waitFor(
    cardOpen,
    "a click on the room plate's title never opened its card",
  );
  check(
    plate.getAttribute("aria-expanded") === "true" &&
      [...actions!.querySelectorAll("button")].every(
        (button) =>
          button.getBoundingClientRect().width >= 39.5 &&
          button.getBoundingClientRect().height >= 39.5 &&
          receivesPointer(button),
      ) &&
      Math.abs(plate.getBoundingClientRect().width - width) < 1,
    "a click on the title must reveal 40px room actions without widening the name plate",
  );
  // One card holds the room's summary and its actions, hung from the plate.
  const card = plate.querySelector<HTMLElement>(".town-room-plaque-card");
  // The card builds its summary when it first opens.
  await waitFor(
    () => !!card?.querySelector(".town-place-summary"),
    "the room's card never built its summary",
  );
  check(
    !!card &&
      card.contains(actions) &&
      getComputedStyle(card).visibility === "visible" &&
      !!card.querySelector(".town-place-summary .town-board-counts") &&
      Math.abs(
        card.getBoundingClientRect().left - plate.getBoundingClientRect().left,
      ) < 3 &&
      card.getBoundingClientRect().top >=
        plate.getBoundingClientRect().bottom - CARD_OVERLAP,
    "the room's card must show its summary with the actions, under the plate",
  );
  // Only one card is open: another plate's title takes over.
  const other = plates[1]!;
  other.querySelector<HTMLElement>(".town-room-plaque-heading")!.click();
  await waitFor(
    () => other.classList.contains("is-open") && !cardOpen(),
    "opening another room's card left the first one open",
  );
  // The runtime icon's tooltip is its own: a press on it opens no card.
  const icon = plate.querySelector<HTMLElement>(".town-runtime-icon");
  icon?.click();
  check(
    !cardOpen() && other.classList.contains("is-open"),
    "a press on the runtime icon must not open or close a card",
  );
  // A second click on the title closes the card.
  other.querySelector<HTMLElement>(".town-room-plaque-heading")!.click();
  await waitFor(
    () => !host.querySelector(".town-room-plaque.is-open"),
    "a second click on the title never closed its card",
  );
  // Enter on the focused plate opens it; Escape closes it.
  plate.focus();
  plate.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
  );
  await waitFor(
    cardOpen,
    "Enter on the focused room plate never opened its card",
  );
  plate.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
  );
  await waitFor(() => !cardOpen(), "Escape never closed the room's card");
  // A press outside the plate closes it.
  heading.click();
  await waitFor(cardOpen, "the room's card did not reopen");
  document.body.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }),
  );
  await waitFor(
    () => !cardOpen(),
    "a press outside the room plate never closed its card",
  );
  plate.blur();
  // With every card closed, each agent of each room's top row takes a tap.
  await checkTopRowAgentsTappable(host, check, waitFor, activations, clock);
  // A table's nameplate takes its own pointer and opens the table's card.
  plate.blur();
  const title = plate
    .closest(".town-room")!
    .querySelector<HTMLElement>(".town-desk-title");
  const tag = title?.querySelector<HTMLElement>(".town-desk-tag");
  const deskCard = title?.querySelector<HTMLElement>(".town-desk-card");
  check(
    !!tag && !!deskCard && getComputedStyle(deskCard).visibility === "hidden",
    "a table's card must start hidden under its nameplate",
  );
  if (title && tag && deskCard) {
    const tagBox = tag.getBoundingClientRect();
    check(
      tag.contains(
        document.elementFromPoint(
          tagBox.left + tagBox.width / 2,
          tagBox.top + tagBox.height / 2,
        ),
      ),
      "a table's nameplate must receive its native pointer hit",
    );
    title.focus();
    await waitFor(
      () => !!deskCard.querySelector(".town-place-summary"),
      "the table's card never built its summary",
    );
    check(
      getComputedStyle(deskCard).visibility === "visible" &&
        !!deskCard.querySelector(".town-place-summary .town-board-counts") &&
        deskCard.getBoundingClientRect().top >= tagBox.bottom - CARD_OVERLAP,
      "focusing a table's nameplate must show the table's summary under it",
    );
    title.blur();
    // The table itself, drawn on the canvas: a mouse over its centre, away
    // from the plate, opens the same card, which leaves the table uncovered.
    const canvas = host.querySelector<HTMLElement>(".town-canvas-host")!;
    const tags = title.closest<HTMLElement>(".town-desk-tags")!;
    const tagsBox = tags.getBoundingClientRect();
    const centre = {
      clientX: tagsBox.left + tagsBox.width / 2,
      clientY: tagsBox.top + (tagsBox.height * 30) / 80,
    };
    check(
      getComputedStyle(deskCard).visibility === "hidden" &&
        canvas.contains(
          document.elementFromPoint(centre.clientX, centre.clientY),
        ),
      "a table's centre must be the canvas, with its card closed",
    );
    canvas.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 71,
        pointerType: "mouse",
        ...centre,
      }),
    );
    await waitFor(
      () =>
        title.classList.contains("is-open") &&
        getComputedStyle(deskCard).visibility === "visible",
      "hovering a table's centre never opened its card",
    );
    check(
      canvas.contains(
        document.elementFromPoint(centre.clientX, centre.clientY),
      ) && !!deskCard.querySelector(".town-place-summary .town-board-counts"),
      "a table's hover card must show its summary without covering the table",
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerleave", { pointerId: 71, pointerType: "mouse" }),
    );
    await waitFor(
      () =>
        !title.classList.contains("is-open") &&
        getComputedStyle(deskCard).visibility === "hidden",
      "a table's card stayed open after the mouse left the town",
    );
  }
  plate.blur();
  // A touch on the plate opens nothing; the tap on its title does.
  plate.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }),
  );
  check(!cardOpen(), "a touch on the room plate must not open its card");
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

/**
 * Each room's plate stands above its floor, so with every card closed no
 * plate covers an agent of the room's top row: a press on each, on a desktop
 * and a phone screen, reaches the town and opens that agent (or, above desk
 * level, its desk's pane).
 */
export async function checkTopRowAgentsTappable(
  host: HTMLElement,
  check: (condition: boolean, message: string) => void,
  waitFor: (
    condition: () => boolean,
    message: string | (() => string),
  ) => Promise<void>,
  activations: () => number,
  clock: Pick<TestClock, "frame" | "advance">,
) {
  const renderer = window.__HERDR_TOWN_RENDERER__!;
  const canvas = host.querySelector<HTMLElement>(".town-canvas-host")!;
  await waitFor(
    () =>
      !renderer.flying &&
      host.querySelector('.town-targets[aria-busy="true"]') === null,
    () =>
      `Town's agent targets never settled (flying ${renderer.flying}, busy ${
        host.querySelector(".town-targets")?.getAttribute("aria-busy") ?? "none"
      })`,
  );
  check(
    host.querySelector(".town-room-plaque.is-open") === null,
    "every room card must be closed before tapping the top row",
  );
  const onScreen = (box: DOMRect) =>
    box.width > 0 &&
    box.left >= 0 &&
    box.top >= 0 &&
    box.right <= window.innerWidth &&
    box.bottom <= window.innerHeight;
  // Each visible room's top row: its desks' top edge, and the seats above
  // their tables (the upper half of the row's 80px cells).
  const rows = [...host.querySelectorAll<HTMLElement>(".town-room")]
    .filter((room) => room.querySelector(".town-room-plaque"))
    .map((room) => {
      const cells = [
        ...room.querySelectorAll<HTMLElement>(".town-desk-tags"),
      ].map((cell) => cell.getBoundingClientRect());
      const top = Math.min(...cells.map((cell) => cell.top));
      const height = cells[0]?.height ?? 0;
      return {
        room: room.getBoundingClientRect(),
        plates: [...room.querySelectorAll<HTMLElement>(".town-room-plaque")],
        top,
        bottom: top + height / 2,
      };
    })
    .filter((row) => Number.isFinite(row.top));
  const agentsOf = (row: (typeof rows)[number]) =>
    [
      ...host.querySelectorAll<HTMLElement>(
        '.world-semantic-target[data-kind="agent"]',
      ),
    ].filter((target) => {
      const box = target.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      return (
        onScreen(box) &&
        x > row.room.left &&
        x < row.room.right &&
        y >= row.top - box.height &&
        y < row.bottom
      );
    });
  // A mouse press on both screens: a finger's tap on a table may first open
  // its card, and the hit test is the same either way. A tap opens what it
  // lands on (TownView.tsx): the agent, or above desk level its desk's pane.
  const kind = "mouse";
  // A short wait of its own, so one miss reports with the rest.
  const within = async (condition: () => boolean) => {
    for (let wait = 0; wait < 40; wait++) {
      if (condition()) return true;
      await clock.advance(25);
    }
    return condition();
  };
  const misses: string[] = [];
  let tapped = 0;
  for (const row of rows)
    for (const agent of agentsOf(row)) {
      const box = agent.getBoundingClientRect();
      const label = agent.getAttribute("aria-label") ?? "agent";
      const covered = row.plates.some((plate) => {
        const plateBox = plate.getBoundingClientRect();
        return (
          plateBox.width > 0 &&
          plateBox.left < box.right &&
          plateBox.right > box.left &&
          plateBox.top < box.bottom &&
          plateBox.bottom > box.top
        );
      });
      if (covered) misses.push(`${label}: under its room's plate`);
      const at = {
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
      };
      const hit = document.elementFromPoint(at.clientX, at.clientY);
      if (!hit || !canvas.contains(hit)) {
        misses.push(
          `${label}: the pointer lands on ${hit?.closest("[class]")?.className ?? "nothing"}`,
        );
        continue;
      }
      const tap = (type: string) =>
        hit.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 81,
            pointerType: kind,
            isPrimary: true,
            button: 0,
            buttons: type === "pointerdown" ? 1 : 0,
            ...at,
          }),
        );
      const before = activations();
      tap("pointerdown");
      tap("pointerup");
      if (await within(() => activations() > before)) tapped++;
      else
        misses.push(
          `${label}: a tap at ${renderer.level} level opened nothing`,
        );
      canvas.dispatchEvent(
        new PointerEvent("pointerleave", { pointerId: 81, pointerType: kind }),
      );
      // Past the double-tap window, so the next agent's tap stands alone.
      await clock.advance(350);
    }
  check(
    tapped > 0 && misses.length === 0,
    `every top-row agent must take a tap with cards closed (${tapped} tapped): ${misses.join("; ")}`,
  );
}

/**
 * Zoomed out to the overview, a room's name is too small to point at: a mouse
 * anywhere over the room on the canvas, away from its card, shows the room's
 * summary, and leaving the town hides it again.
 */
export async function checkOverviewRoomHover(
  host: HTMLElement,
  check: (condition: boolean, message: string) => void,
  waitFor: (
    condition: () => boolean,
    message: string | (() => string),
  ) => Promise<void>,
) {
  const canvas = host.querySelector<HTMLElement>(".town-canvas-host")!;
  const hover = (clientX: number, clientY: number) =>
    canvas.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 72,
        pointerType: "mouse",
        clientX,
        clientY,
      }),
    );
  const summaryShown = (wrap: HTMLElement) => {
    const card = wrap.querySelector<HTMLElement>(".town-room-overview-card")!;
    return (
      wrap.classList.contains("is-open") &&
      getComputedStyle(card).visibility === "visible" &&
      !!card.querySelector(".town-place-summary .town-board-counts")
    );
  };
  // A point in a room that only the canvas covers: the room's own card sits
  // at its centre, so try just inside each corner. An agent from another room
  // can stand over a corner (a visitor queueing in the lobby), and hovering
  // it rightly opens its own room's summary instead, so move on to the next
  // corner when another room opens.
  let found: { wrap: HTMLElement; clientX: number; clientY: number } | null =
    null;
  let covered = false;
  search: for (const wrap of host.querySelectorAll<HTMLElement>(
    ".town-room-overview",
  )) {
    const box = wrap.getBoundingClientRect();
    for (const [clientX, clientY] of [
      [box.left + 4, box.top + 4],
      [box.right - 4, box.top + 4],
      [box.left + 4, box.bottom - 4],
      [box.right - 4, box.bottom - 4],
    ] as const) {
      if (!canvas.contains(document.elementFromPoint(clientX, clientY)))
        continue;
      if (!covered) {
        covered = true;
        check(
          getComputedStyle(
            wrap.querySelector<HTMLElement>(".town-room-overview-card")!,
          ).visibility === "hidden",
          "an overview room's summary must start hidden",
        );
      }
      hover(clientX, clientY);
      await waitFor(
        () =>
          summaryShown(wrap) ||
          [...host.querySelectorAll<HTMLElement>(".town-room-overview")].some(
            (other) => other !== wrap && summaryShown(other),
          ),
        "hovering a zoomed-out room never showed its summary",
      );
      if (summaryShown(wrap)) {
        found = { wrap, clientX, clientY };
        break search;
      }
      canvas.dispatchEvent(
        new PointerEvent("pointerleave", {
          pointerId: 72,
          pointerType: "mouse",
        }),
      );
      await waitFor(
        () => !host.querySelector(".town-room-overview.is-open"),
        "another room's summary stayed open after the mouse left the town",
      );
    }
  }
  check(covered, "no overview room shows the canvas beside its card");
  check(
    found !== null || !covered,
    "every zoomed-out room corner opened another room's summary",
  );
  if (!found) return;
  const { wrap, clientX, clientY } = found;
  const card = wrap.querySelector<HTMLElement>(".town-room-overview-card")!;
  check(
    canvas.contains(document.elementFromPoint(clientX, clientY)),
    "a zoomed-out room's summary must let the pointer through to the town",
  );
  canvas.dispatchEvent(
    new PointerEvent("pointerleave", { pointerId: 72, pointerType: "mouse" }),
  );
  await waitFor(
    () =>
      !wrap.classList.contains("is-open") &&
      getComputedStyle(card).visibility === "hidden",
    "a zoomed-out room's summary stayed open after the mouse left the town",
  );
}
