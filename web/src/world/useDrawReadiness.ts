import { captureAssets } from "./captureAssets";
import { useLayoutEffect, useRef, type RefObject } from "react";
import {
  DrawReadiness,
  type CaptureView,
  type DrawReceipt,
} from "./drawReadiness";

const surfaces = new Map<
  number,
  { root: HTMLElement; gate: DrawReadiness; view: CaptureView }
>();
let nextOwner = 0;
let selected: number | null = null;
type PaintFrame = (callback: () => void) => () => void;
let paintFrame: PaintFrame = (callback) => {
  const id = requestAnimationFrame(callback);
  return () => cancelAnimationFrame(id);
};
/** Manual scene clocks still cross native browser paint/ResizeObserver delivery. */
export function setCapturePaintFrameForTesting(frame: PaintFrame) {
  paintFrame = frame;
}

function visible(root: HTMLElement) {
  return (
    root.isConnected &&
    !document.hidden &&
    root.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
  );
}
export const captureReadiness = {
  invalidate() {
    for (const { gate } of surfaces.values())
      gate.invalidate("capture viewport");
  },
  async wait(options: {
    view?: CaptureView;
    width: number;
    height: number;
    timeoutMs: number;
  }) {
    const candidates = [...surfaces.entries()].filter(
      ([, surface]) =>
        (!options.view || surface.view === options.view) &&
        visible(surface.root),
    );
    if (candidates.length !== 1)
      throw new Error(
        `Capture needs one visible surface (${options.view ?? "any"}); found ${candidates.length}`,
      );
    const [owner, surface] = candidates[0]!;
    selected = owner;
    const receipt = await surface.gate.wait(options.timeoutMs);
    if (receipt.width !== options.width || receipt.height !== options.height)
      throw new Error(
        `Capture viewport mismatch: ${receipt.width}x${receipt.height}; expected ${options.width}x${options.height}`,
      );
    return receipt;
  },
  diagnostics(receipt: DrawReceipt) {
    return (
      surfaces.get(receipt.owner)?.gate.diagnostics() ?? { stage: "retired" }
    );
  },
  matches(receipt: DrawReceipt) {
    return (
      selected === receipt.owner &&
      surfaces.get(receipt.owner)?.gate.matches(receipt) === true
    );
  },
};
declare global {
  interface Window {
    __HERDR_WORLD_CAPTURE__?: typeof captureReadiness;
  }
}

/** Commits invalidate evidence; only an outstanding capture requests any work. */
export function useDrawReadiness(
  view: CaptureView,
  root: RefObject<HTMLElement | null>,
  wake?: () => void,
) {
  const gate = useRef<DrawReadiness | null>(null);
  const wakeRef = useRef(wake);
  useLayoutEffect(() => {
    wakeRef.current = wake;
  });
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const owner = ++nextOwner;
    const current = new DrawReadiness({
      view,
      owner,
      assets: (signal) => captureAssets(element, signal),
      active: () => selected === owner && visible(element),
      viewport: () => ({ width: innerWidth, height: innerHeight }),
      wake: () => {
        if (wakeRef.current) wakeRef.current();
        else current.drawn(); // DOM committed; child passive sprite effects precede paint.
      },
      frame: (fn) => paintFrame(fn),
      deadline: (fn, ms) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      },
      publish: (receipt) => {
        if (receipt)
          document.documentElement.dataset.worldDrawn = JSON.stringify(receipt);
        else if (selected === owner)
          delete document.documentElement.dataset.worldDrawn;
      },
    });
    element.dataset.worldCaptureOwner = String(owner);
    gate.current = current;
    surfaces.set(owner, { root: element, gate: current, view });
    window.__HERDR_WORLD_CAPTURE__ = captureReadiness;
    const invalidate = () => current.invalidate("resize/visibility");
    const observer = new ResizeObserver(invalidate);
    observer.observe(element);
    window.addEventListener("resize", invalidate);
    document.addEventListener("visibilitychange", invalidate);
    document.fonts?.addEventListener("loading", invalidate);
    document.fonts?.addEventListener("loadingdone", invalidate);
    return () => {
      current.dispose();
      surfaces.delete(owner);
      gate.current = null;
      delete element.dataset.worldCaptureOwner;
      observer.disconnect();
      window.removeEventListener("resize", invalidate);
      document.removeEventListener("visibilitychange", invalidate);
      document.fonts?.removeEventListener("loading", invalidate);
      document.fonts?.removeEventListener("loadingdone", invalidate);
    };
  }, [view, root]);
  useLayoutEffect(() => {
    gate.current?.invalidate("commit");
  });
  return gate;
}
