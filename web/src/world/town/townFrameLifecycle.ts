import { registerWorldFrames } from "../worldFrameScheduler";

/** GPU recovery is a state paint, including when ambient animation is asleep. */
export function registerTownFrames(
  element: Element,
  canvas: EventTarget,
  draw: (now: number) => void,
  onPause: (paused: boolean) => void,
) {
  const frames = registerWorldFrames(element, draw, onPause);
  const restore = () => frames.request("state");
  canvas.addEventListener("webglcontextrestored", restore);
  const dispose = frames.dispose;
  frames.dispose = () => {
    canvas.removeEventListener("webglcontextrestored", restore);
    dispose();
  };
  return frames;
}
