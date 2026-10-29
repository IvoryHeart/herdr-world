import type { SnapTarget } from "./windowManager";

/** The menu is portaled outside the frame; send its preview to that frame only. */
export const WINDOW_SNAP_PREVIEW = "herdr-world:window-snap-preview";
export function previewWindowSnap(
  host: HTMLElement | null,
  target: SnapTarget | null,
) {
  const frame = host?.closest(".world-managed-window");
  frame?.dispatchEvent(
    new CustomEvent<SnapTarget | null>(WINDOW_SNAP_PREVIEW, { detail: target }),
  );
}
