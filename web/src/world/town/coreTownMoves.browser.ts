import type { WorldObject } from "../worldObject";
import { CORE_VIEW_ONLY_REASON } from "../worldObject";

/**
 * Tapping a live herdr-core desk opens it as a Herdr desk opens (#1006): a
 * shell desk its terminal, an agent desk its agent, a two-pane desk its
 * focused pane, with no "can't" toast. One tap does it, on a phone too.
 */
export async function checkCoreDesks(
  host: HTMLElement,
  world: WorldObject,
  opened: string[],
  inspected: [string, string][],
  {
    phone,
    check,
    waitFor,
    requestCount,
  }: {
    phone: boolean;
    check(ok: unknown, message: string): void;
    waitFor(predicate: () => boolean, message: string): Promise<void>;
    requestCount(): number;
  },
) {
  const canvasHost = host.querySelector(".town-canvas-host canvas")!
    .parentElement!;
  const leafId = (address: string) =>
    world.leaves.find(
      (leaf) => leaf.connectionId === "core" && leaf.pane.pane_id === address,
    )?.id;
  const desk = (tabId: string) =>
    [
      ...host.querySelectorAll<HTMLElement>(
        '.world-semantic-target[data-kind="desk"]',
      ),
    ].find((target) => JSON.parse(target.dataset.targetKey!)[2] === tabId);
  const tap = (target: HTMLElement, id: number) => {
    const box = target.getBoundingClientRect();
    const at = {
      bubbles: true,
      pointerId: id,
      pointerType: phone ? "touch" : "mouse",
      button: 0,
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
    };
    canvasHost.dispatchEvent(
      new PointerEvent("pointerdown", { ...at, buttons: 1 }),
    );
    canvasHost.dispatchEvent(
      new PointerEvent("pointerup", { ...at, buttons: 0 }),
    );
    canvasHost.dispatchEvent(new MouseEvent("click", at));
  };
  const openedIds = () => [...opened, ...inspected.map(([id]) => id)];
  // At desk level, where each table wears its nameplate: there a touch tap
  // on a table with nothing to open at once opens its card first.
  const rendered = window.__HERDR_TOWN_RENDERER__!;
  for (let into = 0; into < 6 && rendered.level !== "desk"; into += 1) {
    const before = rendered.frames;
    host.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click();
    await waitFor(
      () => rendered.frames > before && !rendered.flying,
      "zooming in to the core desks did not finish",
    );
  }
  await waitFor(
    () => host.querySelectorAll(".town-desk-title").length >= 3,
    `the core desks wear no nameplates (level ${rendered.level})`,
  );
  let pointer = 60;
  for (const [tabId, address] of [
    ["core-shell", "t1"],
    ["core-agent", "t2"],
    ["core-pair", "t4"],
  ] as const) {
    await waitFor(() => Boolean(desk(tabId)), `no core desk ${tabId}`);
    const target = desk(tabId)!;
    opened.length = 0;
    inspected.length = 0;
    // One tap opens it, on a phone too: a desk with a pane to open has no
    // summary card first (townDeskOpensAtOnce).
    tap(target, pointer++);
    await waitFor(
      () => openedIds().length > 0,
      `one tap on the core ${tabId} desk opened nothing`,
    );
    check(
      openedIds().every((id) => id === leafId(address)),
      `the core ${tabId} desk opened ${JSON.stringify(openedIds())}, not ${address}`,
    );
    const toasts = host.querySelector(".town-toasts")?.textContent ?? "";
    check(
      !toasts.includes(CORE_VIEW_ONLY_REASON) && !/can.t/i.test(toasts),
      `tapping the core ${tabId} desk showed "${toasts}"`,
    );
  }
  // Exercise the same canvas pointer path as TUI, including the touch hold.
  const agent = host.querySelector<HTMLElement>(
    '.world-semantic-target[data-kind="agent"]',
  )!;
  check(Boolean(agent), "no core agent target to drag");
  const destination = desk("core-pair")!;
  const refusals = () =>
    [...host.querySelectorAll(".town-toast-error")].filter((toast) =>
      toast.textContent?.includes("not supported for herdr-core"),
    );
  const drag = async (from: HTMLElement, id: number) => {
    const center = (target: HTMLElement) => {
      const box = target.getBoundingClientRect();
      return {
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
      };
    };
    const start = center(from);
    const end = center(destination);
    const point = (type: string, at: typeof start) =>
      canvasHost.dispatchEvent(
        new PointerEvent(type, {
          ...at,
          bubbles: true,
          pointerId: id,
          pointerType: phone ? "touch" : "mouse",
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
        }),
      );
    const before = requestCount();
    const refusedBefore = refusals().length;
    point("pointerdown", start);
    if (phone) {
      await waitFor(
        () => host.querySelector(".town-drag-ghost") !== null,
        "holding a core target did not lift it",
      );
    } else {
      point("pointermove", {
        clientX: start.clientX + 12,
        clientY: start.clientY,
      });
      await waitFor(
        () => host.querySelector(".town-drag-ghost") !== null,
        "dragging a core target did not lift it",
      );
    }
    point("pointermove", end);
    point("pointerup", end);
    await waitFor(
      () => refusals().length > refusedBefore,
      "core drop did not visibly explain why it was refused",
    );
    check(requestCount() === before, "a refused core move sent a TUI request");
    check(
      !host.querySelector('[role="dialog"]'),
      "a refused core move opened a confirmation",
    );
  };
  await drag(agent, pointer++);
  await drag(desk("core-shell")!, pointer);
}
