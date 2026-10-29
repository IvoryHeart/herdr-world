import { expect, test } from "bun:test";
import { type HTMLButtonElement, type PointerEvent, Window } from "happy-dom";
import { checkTownRoomFold } from "./townRoomFold.browser";

function scenario(mountAfter: number | null) {
  const browser = new Window({ url: "https://example.test" });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousPointerEvent = Object.getOwnPropertyDescriptor(
    globalThis,
    "PointerEvent",
  );
  const renderer = {
    ready: true,
    frames: 10,
    flying: false,
    level: "overview" as "overview" | "room",
  };
  Object.assign(browser, { __HERDR_TOWN_RENDERER__: renderer });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: browser,
  });
  Object.defineProperty(globalThis, "PointerEvent", {
    configurable: true,
    writable: true,
    value: browser.PointerEvent,
  });
  const host = browser.document.createElement("div");
  host.innerHTML = `
    <div class="world-semantic-targets-overlay" aria-busy="false"></div>
    <button class="town-room-card">other-room</button>
    <div class="town-room">
      <div class="town-room-plaque"><span class="town-room-plaque-count">4/26</span></div>
      <button class="town-new-seat"></button>
      <button class="town-fold-tile" aria-expanded="false"></button>
    </div>`;
  const room = host.querySelector(".town-room")!;
  const fold = host.querySelector<HTMLButtonElement>(".town-fold-tile")!;
  const seat = host.querySelector<HTMLButtonElement>(".town-new-seat")!;
  fold.getBoundingClientRect = () => new browser.DOMRect(48, 0, 48, 48);
  seat.getBoundingClientRect = () => new browser.DOMRect(0, 0, 48, 48);
  let ticks = 0;
  let cardClicks = 0;
  let otherClicks = 0;
  let foldClicks = 0;
  const touchSequence: string[] = [];
  for (const type of ["pointerdown", "pointerup"])
    fold.addEventListener(type, (event) => {
      const pointer = event as PointerEvent;
      touchSequence.push(
        `${pointer.type}:${pointer.pointerType}:${pointer.buttons}`,
      );
    });
  host.querySelector(".town-room-card")!.addEventListener("click", () => {
    otherClicks += 1;
  });
  const setDesks = (count: number) => {
    for (const target of host.querySelectorAll(".world-semantic-target"))
      target.remove();
    for (let index = 0; index < count; index += 1) {
      const target = browser.document.createElement("button");
      target.className = "world-semantic-target";
      target.dataset.kind = "desk";
      target.dataset.targetKey = JSON.stringify([
        "local",
        "local-fold-room",
        `local-fold-room-tab-${index}`,
      ]);
      target.getBoundingClientRect = () =>
        new browser.DOMRect(
          (index % 6) * 48,
          Math.floor(index / 6) * 48,
          48,
          48,
        );
      room.append(target);
    }
    fold.innerHTML =
      count === 24
        ? '+2<span class="town-fold-indicators"><span class="town-fold-needs"></span><span class="town-fold-done"></span></span>'
        : "+2";
  };
  const card = browser.document.createElement("button");
  card.className = "town-room-card";
  card.textContent = "fold-room";
  card.addEventListener("click", () => {
    cardClicks += 1;
    renderer.frames += 1;
    renderer.level = "room";
    setDesks(24);
  });
  fold.addEventListener("click", () => {
    touchSequence.push("click");
    foldClicks += 1;
    renderer.frames += 1;
    const expanded = fold.getAttribute("aria-expanded") !== "true";
    fold.setAttribute("aria-expanded", String(expanded));
    setDesks(expanded ? 26 : 24);
  });
  if (mountAfter === 0) room.prepend(card);
  const waitFor = async (condition: () => boolean, message: string) => {
    for (let tick = 0; tick < 4; tick += 1) {
      if (condition()) return;
      ticks += 1;
      // Renderer readiness and completed target admission precede this card's
      // DOM commit. A calm renderer owes no additional frame while waiting.
      if (ticks === mountAfter) room.prepend(card);
    }
    throw new Error(message);
  };
  return {
    renderer,
    host: host as unknown as HTMLElement,
    waitFor,
    ticks: () => ticks,
    cardClicks: () => cardClicks,
    otherClicks: () => otherClicks,
    foldClicks: () => foldClicks,
    touchSequence,
    async close() {
      if (previousWindow)
        Object.defineProperty(globalThis, "window", previousWindow);
      else Reflect.deleteProperty(globalThis, "window");
      if (previousPointerEvent)
        Object.defineProperty(globalThis, "PointerEvent", previousPointerEvent);
      else Reflect.deleteProperty(globalThis, "PointerEvent");
      await browser.happyDOM.close();
    },
  };
}

const check = (condition: boolean, message: string) => {
  expect(condition, message).toBe(true);
};

test.each([0, 2])(
  "the fold scenario waits for its named card mounted after %i ticks",
  async (mountAfter) => {
    const view = scenario(mountAfter);
    try {
      expect(view.renderer.ready).toBe(true);
      expect(
        view.host.querySelector(
          '.world-semantic-targets-overlay[aria-busy="false"]',
        ),
      ).not.toBeNull();
      await checkTownRoomFold(view.host, check, view.waitFor, 4, 26);
      expect(view.ticks()).toBe(mountAfter);
      expect(view.cardClicks()).toBe(1);
      expect(view.otherClicks()).toBe(0);
      expect(view.foldClicks()).toBe(2);
      expect(view.touchSequence).toEqual([
        "pointerdown:touch:1",
        "pointerup:touch:0",
        "click",
        "pointerdown:touch:1",
        "pointerup:touch:0",
        "click",
      ]);
      expect(view.renderer.frames).toBe(13);
    } finally {
      await view.close();
    }
  },
);

test("a missing named card fails the bounded precondition without clicking another room", async () => {
  const view = scenario(null);
  try {
    await expect(
      checkTownRoomFold(view.host, check, view.waitFor, 4, 26),
    ).rejects.toThrow("the synthetic fold room overview card never mounted");
    expect(view.ticks()).toBe(4);
    expect(view.cardClicks()).toBe(0);
    expect(view.otherClicks()).toBe(0);
    expect(view.renderer.frames).toBe(10);
  } finally {
    await view.close();
  }
});
