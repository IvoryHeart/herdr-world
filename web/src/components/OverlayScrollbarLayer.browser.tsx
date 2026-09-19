import { createRoot } from "react-dom/client";
import { OverlayScrollbarLayer } from "./OverlayScrollbarLayer";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/vendor.css";

const failures: string[] = [];
function check(condition: boolean, message: string) {
  if (!condition) failures.push(message);
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

async function run() {
  const host = document.createElement("div");
  const scroller = document.createElement("div");
  scroller.style.cssText =
    "position:fixed;right:20px;top:40px;width:300px;height:200px;overflow:auto";
  const content = document.createElement("div");
  content.style.cssText = "width:800px;height:1000px";
  scroller.append(content);
  document.body.append(scroller, host);
  const browserWindow: Window = window;
  const setTimeout = browserWindow.setTimeout.bind(window);
  const clearTimeout = browserWindow.clearTimeout.bind(window);
  const timers = new Map<number, { delay: number; run: () => void }>();
  let timerId = 0;
  browserWindow.setTimeout = (handler, delay, ...args) => {
    if ((delay === 900 || delay === 160) && typeof handler === "function") {
      const id = --timerId;
      timers.set(id, { delay, run: () => handler(...args) });
      return id;
    }
    return setTimeout(handler, delay, ...args);
  };
  browserWindow.clearTimeout = (id) => {
    if (id !== undefined && timers.delete(id)) return;
    clearTimeout(id);
  };
  const advance = async (delay: number) => {
    for (const [id, timer] of [...timers]) {
      if (timer.delay !== delay) continue;
      timers.delete(id);
      timer.run();
    }
    await settle();
  };
  const movePointer = () =>
    content.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }),
    );
  const isVisible = () =>
    !!host.querySelector(".overlay-scrollbar-layer.is-visible");
  const root = createRoot(host);
  root.render(<OverlayScrollbarLayer />);
  await settle();
  try {
    movePointer();
    await settle();
    check(!isVisible(), "Hover alone must not reveal scrollbars");
    scroller.scrollTop = 40;
    scroller.dispatchEvent(new Event("scroll"));
    await settle();
    check(isVisible(), "Scrolling must reveal scrollbars");
    const hideTimer = [...timers.keys()];
    movePointer();
    await settle();
    check(
      JSON.stringify([...timers.keys()]) === JSON.stringify(hideTimer),
      "Pointer movement must not extend scrollbar visibility",
    );
    await advance(900);
    check(!isVisible(), "Idle scrollbars must fade out");
    const thumb = host.querySelector<HTMLElement>(".overlay-scrollbar-thumb");
    check(
      !!thumb && getComputedStyle(thumb).pointerEvents === "none",
      "Hidden thumbs must not intercept pointer events",
    );
    window.dispatchEvent(new Event("resize"));
    movePointer();
    await settle();
    check(!isVisible(), "Hover and resizing must not revive idle scrollbars");
    await advance(160);
    check(
      !host.querySelector(".overlay-scrollbar-thumb"),
      "Idle thumbs must be removed",
    );
    for (const scale of [1, 0.9, 1.25]) {
      document.documentElement.style.zoom = String(scale);
      for (const width of [300, 400]) {
        scroller.style.width = `${width}px`;
        scroller.scrollTop = 160;
        scroller.scrollLeft = 80;
        scroller.dispatchEvent(new Event("scroll"));
        await settle();
        const vertical = host.querySelector<HTMLElement>(".is-vertical");
        const horizontal = host.querySelector<HTMLElement>(".is-horizontal");
        check(!!vertical && !!horizontal, "Both axes must render");
        if (!vertical || !horizontal) continue;
        const bounds = scroller.getBoundingClientRect();
        const v = vertical.getBoundingClientRect();
        const h = horizontal.getBoundingClientRect();
        check(
          Math.abs(v.right - (bounds.right - 3)) < 1,
          `${scale}/${width}: vertical thumb must align with panel right edge`,
        );
        check(
          Math.abs(h.bottom - (bounds.bottom - 3)) < 1,
          `${scale}/${width}: horizontal thumb must align with panel bottom edge`,
        );
        check(
          v.top >= bounds.top && v.bottom <= bounds.bottom,
          `${scale}/${width}: vertical thumb must stay inside the panel`,
        );
        for (const [thumb, axis, viewport, size, maxScroll] of [
          [
            vertical,
            "y",
            bounds.height,
            v.height,
            scroller.scrollHeight - scroller.clientHeight,
          ],
          [
            horizontal,
            "x",
            bounds.width,
            h.width,
            scroller.scrollWidth - scroller.clientWidth,
          ],
        ] as const) {
          // Synthetic pointers do not have a native capture session.
          thumb.setPointerCapture = () => {};
          thumb.hasPointerCapture = () => false;
          const initial =
            axis === "y" ? scroller.scrollTop : scroller.scrollLeft;
          thumb.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              pointerId: 1,
              clientX: 100,
              clientY: 100,
            }),
          );
          thumb.dispatchEvent(
            new PointerEvent("pointermove", {
              bubbles: true,
              pointerId: 1,
              clientX: axis === "x" ? 120 : 100,
              clientY: axis === "y" ? 120 : 100,
            }),
          );
          const actual =
            axis === "y" ? scroller.scrollTop : scroller.scrollLeft;
          const expected = initial + (20 / (viewport - 6 - size)) * maxScroll;
          check(
            Math.abs(actual - expected) < 2,
            `${scale}/${width}: ${axis} drag must use viewport pointer units`,
          );
          thumb.dispatchEvent(
            new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }),
          );
          await settle();
        }
      }
    }
  } finally {
    root.unmount();
    browserWindow.setTimeout = setTimeout;
    browserWindow.clearTimeout = clearTimeout;
    scroller.remove();
    host.remove();
    document.documentElement.style.zoom = "";
  }
}
run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
