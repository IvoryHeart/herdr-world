import { openLayerCount } from "../../layerStack";
import type { TownPlaceKey } from "./townPlaces";

/** The window each place's building opens (PlaceWindow's `name`). */
const WINDOWS: Record<TownPlaceKey, string> = {
  post: "needs-you",
  library: "library",
  apartments: "apartments",
  observatory: "usage",
  warehouse: "work",
};

type Box = { x0: number; y0: number; x1: number; y1: number };

/**
 * Town's places in a real renderer (#1170): a press on each building itself,
 * away from its sign, opens that place's window, and every window is the
 * same frame. On a desktop it is a centred modal of one size over dimmed
 * Town; on a phone a sheet from the bottom that keeps a strip of Town above
 * it. Hovering a building lights its sign, and Escape closes the window.
 * `disconnect` then signs GitHub out: the warehouse building opens
 * Integrations, in the same frame.
 */
export async function checkTownPlaces(
  host: HTMLElement,
  check: (condition: boolean, message: string) => void,
  waitFor: (condition: () => boolean, message: string) => Promise<void>,
  phone: boolean,
  disconnect: () => Promise<void>,
) {
  const town = () => window.__HERDR_TOWN_RENDERER__!;
  const canvas = host.querySelector<HTMLElement>(".town-canvas-host")!;
  await waitFor(
    () => Object.keys(town().layout?.places ?? {}).length > 0,
    "the renderer reported no place buildings",
  );
  const keys = Object.keys(town().layout!.places) as TownPlaceKey[];
  check(
    keys.includes("post") && keys.includes("warehouse"),
    `Town has no post office or warehouse building: ${keys.join(", ")}`,
  );
  if (phone)
    check(
      !keys.includes("library") && !keys.includes("observatory"),
      "a phone's Town drew the library or observatory as buildings",
    );
  else
    check(
      ["library", "observatory", "apartments"].every((key) =>
        keys.includes(key as TownPlaceKey),
      ),
      `a desktop Town lacks a place building: ${keys.join(", ")}`,
    );

  // Zoom all the way out, so every building is on screen at once.
  const rect = () => canvas.getBoundingClientRect();
  for (let step = 0; step < 40; step += 1) {
    const before = town().zoom;
    const box = rect();
    canvas.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: 400,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
      }),
    );
    const drawn = town().frames;
    await waitFor(
      () => town().frames > drawn || town().zoom !== before,
      "the wheel did not redraw Town",
    );
    await waitFor(() => !town().flying, "the camera kept flying");
    if (Math.abs(town().zoom - before) < 1e-4) break;
  }

  const signs = () =>
    [...host.querySelectorAll<HTMLElement>("[data-town-place]")].map((sign) =>
      sign.getBoundingClientRect(),
    );
  /** A point on the building, on screen, under none of the place signs. */
  const pointOn = (box: Box) => {
    const { zoom, camera } = town();
    const view = rect();
    const covered = signs();
    for (const fy of [0.5, 0.7, 0.3, 0.85, 0.15])
      for (const fx of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        const wx = box.x0 + (box.x1 - box.x0) * fx;
        const wy = box.y0 + (box.y1 - box.y0) * fy;
        const clientX = view.left + (wx - camera.x) * zoom + view.width / 2;
        const clientY = view.top + (wy - camera.y) * zoom + view.height / 2;
        if (
          clientX < view.left + 4 ||
          clientY < view.top + 4 ||
          clientX > view.right - 4 ||
          clientY > view.bottom - 4
        )
          continue;
        if (
          covered.some(
            (sign) =>
              clientX >= sign.left &&
              clientX <= sign.right &&
              clientY >= sign.top &&
              clientY <= sign.bottom,
          )
        )
          continue;
        return { clientX, clientY };
      }
    return null;
  };
  const pointer = (
    type: string,
    at: { clientX: number; clientY: number },
    held = type === "pointerdown",
  ) =>
    canvas.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 71,
        pointerType: phone ? "touch" : "mouse",
        isPrimary: true,
        button: type === "pointermove" ? -1 : 0,
        buttons: held ? 1 : 0,
        ...at,
      }),
    );

  /**
   * A phone's Town is taller than its screen even zoomed out: a drag from a
   * building on screen (which pans; nothing lifts from it) brings the next.
   */
  const bringIntoView = async (box: Box) => {
    for (let attempt = 0; attempt < 4 && !pointOn(box); attempt += 1) {
      const from = keys
        .map((key) => pointOn(town().layout!.places[key]!))
        .find((point) => point !== null);
      if (!from) return;
      const { zoom, camera } = town();
      const view = rect();
      const target = {
        x:
          view.left +
          ((box.x0 + box.x1) / 2 - camera.x) * zoom +
          view.width / 2,
        y:
          view.top +
          ((box.y0 + box.y1) / 2 - camera.y) * zoom +
          view.height / 2,
      };
      // Move the target to the middle, as far as the drag can reach on screen.
      const clamp = (value: number, low: number, high: number) =>
        Math.min(high, Math.max(low, value));
      const to = {
        clientX: clamp(
          from.clientX + view.left + view.width / 2 - target.x,
          view.left + 4,
          view.right - 4,
        ),
        clientY: clamp(
          from.clientY + view.top + view.height / 2 - target.y,
          view.top + 4,
          view.bottom - 4,
        ),
      };
      pointer("pointerdown", from);
      for (let step = 1; step <= 8; step += 1)
        pointer(
          "pointermove",
          {
            clientX: from.clientX + ((to.clientX - from.clientX) * step) / 8,
            clientY: from.clientY + ((to.clientY - from.clientY) * step) / 8,
          },
          true,
        );
      pointer("pointerup", to);
      // A pan clamped at the town's edge draws nothing new.
      await new Promise((resolve) => setTimeout(resolve, 250));
      await waitFor(() => !town().flying, "the camera kept flying");
    }
  };

  const frames: { key: string; box: DOMRect }[] = [];
  const press = async (key: TownPlaceKey, name: string) => {
    await bringIntoView(town().layout!.places[key]!);
    const at = pointOn(town().layout!.places[key]!);
    check(at !== null, `the ${key} building is not on screen to press`);
    if (!at) return;
    if (!phone) {
      pointer("pointermove", at);
      await waitFor(
        () =>
          host.querySelector(
            `[data-town-place="${key}"][data-place-hovered]`,
          ) !== null,
        `hovering the ${key} building did not light its sign`,
      );
    }
    pointer("pointerdown", at);
    pointer("pointerup", at);
    const selector = `.modal.place-window[data-place-window="${name}"]`;
    const frame = () => document.querySelector<HTMLElement>(selector);
    await waitFor(
      () => frame() !== null,
      `a press on the ${key} building opened no ${name} window`,
    );
    const win = frame()!;
    check(
      document.querySelectorAll(".modal.place-window").length === 1,
      `the ${key} building opened more than one window`,
    );
    check(
      host.querySelector("[data-place-hovered]") === null,
      `the ${key} sign stayed lit under its window`,
    );
    const backdrop = win.parentElement!;
    // Measured where the opening motion ends, whatever the frame rate.
    for (const animation of backdrop.getAnimations({ subtree: true }))
      if (animation.effect?.getComputedTiming().endTime !== Infinity)
        animation.finish();
    check(
      backdrop.classList.contains("place-window-backdrop") &&
        getComputedStyle(backdrop).backgroundColor !== "rgba(0, 0, 0, 0)",
      `the ${key} window does not dim Town behind it`,
    );
    check(
      win.getAttribute("role") === "dialog" &&
        win.getAttribute("aria-modal") === "true",
      `the ${key} window is not a modal dialog`,
    );
    const head = win.querySelector<HTMLElement>(":scope > .place-window-head");
    check(
      head !== null &&
        head.querySelector("h2") !== null &&
        head.querySelector(":scope > .close-button") !== null,
      `the ${key} window lacks the shared header and close button`,
    );
    const body = win.querySelector<HTMLElement>(":scope > .place-window-body");
    check(
      body !== null && getComputedStyle(body).overflowY === "auto",
      `the ${key} window's content does not scroll inside it`,
    );
    const box = win.getBoundingClientRect();
    frames.push({ key: name, box });
    if (phone)
      check(
        Math.abs(box.bottom - innerHeight) <= 1 &&
          Math.abs(box.width - innerWidth) <= 1 &&
          box.top >= 60,
        `the ${key} window is not a sheet over a strip of Town: ${JSON.stringify(box)}`,
      );
    else
      check(
        Math.abs(box.left + box.width / 2 - innerWidth / 2) <= 2 &&
          Math.abs(box.top + box.height / 2 - innerHeight / 2) <= 2 &&
          box.width < innerWidth &&
          box.height < innerHeight,
        `the ${key} window is not centred over Town: ${JSON.stringify(box)}`,
      );
    // A window that mounts through a feature host joins the layer stack an
    // effect after it shows; a person's Escape always comes later than that.
    await waitFor(
      () => openLayerCount() === 1,
      `the ${key} window is not on the layer stack`,
    );
    (document.activeElement ?? win).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await waitFor(() => frame() === null, `Escape left the ${key} window open`);
    if (!phone)
      pointer("pointermove", {
        clientX: rect().left + 2,
        clientY: rect().top + 2,
      });
  };
  for (const key of keys) await press(key, WINDOWS[key]);
  // Without GitHub the warehouse opens Integrations, still in the one frame.
  await disconnect();
  await waitFor(
    () =>
      host
        .querySelector(".town-warehouse-sign")
        ?.getAttribute("aria-label")
        ?.includes("connect GitHub") ?? false,
    "the warehouse sign did not show GitHub signed out",
  );
  // A second press on the same spot this soon would be a double tap (zoom).
  await new Promise((resolve) => setTimeout(resolve, 400));
  await press("warehouse", "integrations");
  const [first] = frames;
  for (const { key, box } of frames)
    check(
      Math.abs(box.width - first!.box.width) <= 1 &&
        Math.abs(box.height - first!.box.height) <= 1,
      `the ${key} window is ${box.width}x${box.height}, the ${first!.key} window ${first!.box.width}x${first!.box.height}`,
    );
}
