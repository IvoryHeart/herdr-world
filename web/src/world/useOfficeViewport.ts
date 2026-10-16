import { useLayoutEffect, useState, type RefObject } from "react";
import type { OfficeRect } from "./officeGeometry";

/** Match canvas overscan, updating React only as a logical row enters the window. */
export function useOfficeViewport(ref: RefObject<HTMLDivElement | null>) {
  const [viewport, setViewport] = useState<OfficeRect>();
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame: number | null = null;
    const read = () => {
      frame = null;
      const next = {
        x: Math.floor(element.scrollLeft / 128) * 128 - element.clientWidth,
        y:
          Math.floor(element.scrollTop / 128) * 128 -
          element.clientHeight -
          128,
        width: element.clientWidth * 3 + 128,
        height: element.clientHeight * 3 + 256,
      };
      setViewport((previous) =>
        previous &&
        Object.keys(next).every(
          (key) =>
            previous[key as keyof OfficeRect] === next[key as keyof OfficeRect],
        )
          ? previous
          : next,
      );
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(read);
    };
    read();
    element.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener("scroll", schedule);
    };
  }, [ref]);
  return viewport;
}
