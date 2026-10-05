import {
  fitWindow,
  WINDOW_MINIMUM,
  type Size,
  type SnapTarget,
} from "./windowManager";
import type { FloatingTerminalGeometry as Rect } from "../floatingTerminalGeometry";

export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const RESIZE_EDGES: readonly ResizeEdge[] = [
  "n",
  "s",
  "e",
  "w",
  "ne",
  "nw",
  "se",
  "sw",
];
export function resizeWindow(
  rect: Rect,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  size: Size,
): Rect {
  let left = rect.left,
    top = rect.top,
    right = rect.left + rect.width,
    bottom = rect.top + rect.height;
  const width = Math.min(WINDOW_MINIMUM.width, size.width);
  const height = Math.min(WINDOW_MINIMUM.height, size.height);
  if (edge.includes("w"))
    left = Math.max(0, Math.min(right - width, left + dx));
  if (edge.includes("e"))
    right = Math.min(size.width, Math.max(left + width, right + dx));
  if (edge.includes("n"))
    top = Math.max(0, Math.min(bottom - height, top + dy));
  if (edge.includes("s"))
    bottom = Math.min(size.height, Math.max(top + height, bottom + dy));
  return fitWindow(
    { left, top, width: right - left, height: bottom - top },
    size,
  );
}
export function snapAtPointer(
  x: number,
  y: number,
  size: Size,
): SnapTarget | "maximize" | null {
  const edge = 24;
  const left = x <= edge,
    right = x >= size.width - edge,
    top = y <= edge,
    bottom = y >= size.height - edge;
  if (top && left) return "top-left";
  if (top && right) return "top-right";
  if (bottom && left) return "bottom-left";
  if (bottom && right) return "bottom-right";
  if (left) return "left";
  if (right) return "right";
  if (top) return "maximize";
  if (bottom) return "bottom";
  return null;
}
