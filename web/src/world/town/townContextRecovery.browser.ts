import type { TestClock } from "../testing/testClock";

/** Real GPU loss/restoration; only scheduler time and visibility are controlled. */
export async function checkTownContextRecovery(
  canvas: HTMLCanvasElement,
  clock: TestClock,
  frames: () => number,
  check: (condition: boolean, message: string) => void,
) {
  const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  const extension = context?.getExtension("WEBGL_lose_context");
  if (!extension) throw new Error("Context recovery needs WEBGL_lose_context");
  const once = (type: string) =>
    new Promise<void>((resolve) => {
      canvas.addEventListener(type, () => resolve(), { once: true });
    });
  const restore = async () => {
    const lost = once("webglcontextlost");
    const recovery = context!.getExtension("WEBGL_lose_context")!;
    recovery.loseContext();
    await lost;
    await clock.frame();
    const restored = once("webglcontextrestored");
    recovery.restoreContext();
    await restored;
  };

  const sleeping = frames();
  await restore();
  await clock.advance(1000);
  check(
    frames() === sleeping + 1,
    "A restored sleeping Town must repaint once",
  );
  const repainted = frames();
  await clock.advance(1000);
  check(frames() === repainted, "Context recovery restarted idle drawing");

  const descriptor = Object.getOwnPropertyDescriptor(document, "hidden");
  const setHidden = (hidden: boolean) => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: hidden,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  };
  try {
    setHidden(true);
    await restore();
    await clock.advance(1000);
    check(frames() === repainted, "Hidden context recovery must defer drawing");
    setHidden(false);
    await clock.advance(1000);
    check(
      frames() === repainted + 1,
      "Visibility return must paint the restored Town",
    );
    const resumed = frames();
    await clock.advance(1000);
    check(frames() === resumed, "Visibility return restarted idle drawing");
  } finally {
    if (descriptor) Object.defineProperty(document, "hidden", descriptor);
    else Reflect.deleteProperty(document, "hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  }
}
