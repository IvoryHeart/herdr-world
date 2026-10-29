import type { WorldObject } from "../worldObject";
import { fixtureHost, fixtureWorld } from "../board/boardFixture";
import { HOLD_MS } from "../board/boardGesture";

export type PaneMoveCall = {
  paneId: string;
  tabId: string;
  allowClose: boolean;
};

/** Real Board components and the shared gesture machine, on the fixture clock. */
export async function boardFollowupsAcceptance({
  host,
  mount,
  settle,
  waitFor,
  check,
  opened,
  moves,
  requireConfirmation,
  cardColors,
}: {
  host: HTMLElement;
  mount(key: number, world: WorldObject): void;
  settle(ms?: number): Promise<unknown>;
  waitFor(condition: () => unknown, message: string): Promise<unknown>;
  check(condition: boolean, message: string): void;
  opened: readonly string[];
  moves: readonly PaneMoveCall[];
  requireConfirmation(value: boolean): void;
  cardColors(): string;
}) {
  const world = fixtureWorld([
    fixtureHost("synthetic-board", [
      {
        label: "Synthetic room",
        tabs: [
          { label: "Source desk", panes: [["blocked"], ["working"]] },
          { label: "Destination desk", panes: [["idle"]] },
        ],
      },
    ]),
  ]);
  const board = () => host.querySelector<HTMLElement>(".board")!;
  const menu = async () => {
    host
      .querySelector<HTMLButtonElement>('[aria-label="Board settings"]')!
      .click();
    await settle();
    return host.querySelector<HTMLElement>(".board-menu")!;
  };
  const action = (container: ParentNode, label: string) => {
    const choice = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.trim() === label);
    if (!choice) throw new Error(`Missing ${label}`);
    choice.click();
  };
  mount(9100, world);
  await waitFor(
    () => host.querySelectorAll(".board-tab").length === 2,
    "two-pane move fixture mounts",
  );
  await settle(1000);
  const next = host.querySelector<HTMLButtonElement>(
    '[aria-label="Next agent needing you"]',
  );
  check(
    Boolean(next) && !next!.disabled,
    "Next is visible for a waiting agent",
  );
  next!.click();
  await settle();
  check(
    opened[opened.length - 1] === world.leaves[0]!.id,
    "Next opens the waiting agent on its owning host",
  );
  action(await menu(), "Whiteboard");
  await settle();
  check(
    board().dataset.surface === "whiteboard" &&
      getComputedStyle(board()).getPropertyValue("--board-ground").trim() ===
        "#f2f3ee",
    "Whiteboard overrides the theme palette",
  );
  const colors = cardColors();
  action(await menu(), "Status colours…");
  await settle();
  const dialog = document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Board status colours"]',
  )!;
  const input = dialog.querySelector<HTMLInputElement>(
    '[aria-label="Needs you status colour"]',
  )!;
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!.call(input, "#ff00aa");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
  check(
    board().style.getPropertyValue("--s-blocked") === "#ff00aa",
    "status colours update the Board",
  );
  check(
    getComputedStyle(board().querySelector(".board-s-blocked .board-dot")!)
      .backgroundColor === "rgb(255, 0, 170)",
    "status dots use the chosen colour",
  );
  check(
    cardColors() === colors,
    "status colours leave saved card colours untouched",
  );
  dialog
    .querySelector<HTMLButtonElement>(
      '[aria-label="Close Board status colours"]',
    )!
    .click();
  mount(9101, world);
  await settle(1000);
  check(
    board().dataset.surface === "whiteboard" &&
      board().style.getPropertyValue("--s-blocked") === "#ff00aa",
    "surface and status choices survive a remount",
  );
  action(await menu(), "Status colours…");
  await settle();
  const resetDialog = document.querySelector<HTMLElement>(
    '[aria-label="Board status colours"]',
  )!;
  action(resetDialog, "Reset status colours");
  await settle();
  check(
    board().style.getPropertyValue("--s-blocked") === "",
    "reset restores the surface's default status palette",
  );
  resetDialog
    .querySelector<HTMLButtonElement>(
      '[aria-label="Close Board status colours"]',
    )!
    .click();
  action(await menu(), "Blackboard");
  await settle();
  check(
    getComputedStyle(board()).getPropertyValue("--board-ground").trim() ===
      "#1c2320",
    "Blackboard has its dark palette",
  );
  action(await menu(), "Follow theme");
  await settle();
  action(await menu(), "Help");
  await settle();
  check(
    Boolean(document.querySelector('[aria-label="Board help"]')),
    "Board Help opens from its menu",
  );
  const cameraBeforeHelp =
    board().querySelector<HTMLElement>(".board-world")!.style.transform;
  const helpText = document.querySelector('[aria-label="Board help"] p')!;
  const helpBounds = helpText.getBoundingClientRect();
  for (const [type, dx] of [
    ["pointerdown", 0],
    ["pointermove", 30],
    ["pointerup", 30],
  ] as const)
    helpText.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 81,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: helpBounds.x + 5 + dx,
        clientY: helpBounds.y + 5,
      }),
    );
  await settle();
  check(
    board().querySelector<HTMLElement>(".board-world")!.style.transform ===
      cameraBeforeHelp,
    "dragging Help text does not pan the Board behind it",
  );
  document
    .querySelector<HTMLButtonElement>('[aria-label="Close Board help"]')!
    .click();
  await settle();

  mount(9102, world);
  await waitFor(
    () => host.querySelectorAll(".board-tab").length === 2,
    "move fixture remounts",
  );
  await settle(1000);
  const source = () =>
    host.querySelector<HTMLElement>('[data-key="synthetic-board:w1:t1"]')!;
  const destination = () =>
    host.querySelector<HTMLElement>('[data-key="synthetic-board:w1:t2"]')!;
  const center = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  };
  const pointer = (
    element: Element,
    type: string,
    at: { x: number; y: number },
    touch = false,
  ) =>
    element.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 42,
        pointerType: touch ? "touch" : "mouse",
        isPrimary: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: at.x,
        clientY: at.y,
      }),
    );
  const drag = async (touch: boolean, cancel: boolean | "escape" = false) => {
    const row = source().querySelectorAll<HTMLElement>("[data-pane]")[1]!;
    if (!row) throw new Error("Single-pane row is not visible");
    const start = center(row),
      finish = center(destination());
    pointer(row, "pointerdown", start, touch);
    if (touch) await settle(HOLD_MS + 10);
    else pointer(row, "pointermove", { x: start.x + 10, y: start.y + 10 });
    await settle();
    check(
      Boolean(document.querySelector(".board-pane-drag")),
      "pane drag lifts a separate ghost",
    );
    pointer(row, "pointermove", finish, touch);
    await settle();
    if (cancel === "escape") {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await settle();
      check(
        !document.querySelector(".board-pane-drag"),
        "Escape dismisses the pane drag",
      );
    }
    pointer(
      row,
      cancel === true ? "pointercancel" : "pointerup",
      finish,
      touch,
    );
    await settle(100);
    check(
      !document.querySelector(".board-pane-drag"),
      "pane drag clears its ghost",
    );
  };
  const before = moves.length;
  const sourceBefore = source().style.transform;
  await drag(false);
  check(
    moves.length === before + 1 &&
      moves[moves.length - 1]?.paneId === world.leaves[1]!.pane.pane_id &&
      moves[moves.length - 1]?.tabId === "w1:t2",
    "mouse drag moves exactly the chosen pane",
  );
  check(
    source().style.transform === sourceBefore,
    "pane drag leaves its whole card in place",
  );
  await drag(false, true);
  check(moves.length === before + 1, "cancelling a pane drag sends no move");
  const covering = document.createElement("div");
  const coveredBounds = destination().getBoundingClientRect();
  covering.style.cssText = `position:fixed;left:${coveredBounds.left}px;top:${coveredBounds.top}px;width:${coveredBounds.width}px;height:${coveredBounds.height}px;z-index:9999;background:#334455`;
  document.body.appendChild(covering);
  try {
    await drag(false);
  } finally {
    covering.remove();
  }
  check(
    moves.length === before + 1,
    "a tab covered by another window is not a pane drop target",
  );
  await drag(false, "escape");
  check(moves.length === before + 1, "Escape cancels without a pane move");
  await drag(true);
  check(
    moves.length === before + 2,
    "touch hold moves one pane with the same gesture",
  );
  requireConfirmation(true);
  await drag(false);
  await waitFor(
    () => document.querySelector('[aria-label="Move the room\'s last pane?"]'),
    "last-room move asks first",
  );
  action(
    document.querySelector('[aria-label="Move the room\'s last pane?"]')!,
    "Cancel",
  );
  await settle();
  check(
    moves.length === before + 3,
    "cancelling the last-room warning does not retry",
  );
  await drag(false);
  action(
    document.querySelector('[aria-label="Move the room\'s last pane?"]')!,
    "Move pane and close room",
  );
  await settle(100);
  check(
    moves.length === before + 5 && moves[moves.length - 1]?.allowClose === true,
    "only explicit confirmation permits closing the old room",
  );
  requireConfirmation(false);
}
