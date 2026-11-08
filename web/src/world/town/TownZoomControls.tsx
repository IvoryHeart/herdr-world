import { EllipsisVertical } from "lucide-react";
import type { useMobileControls } from "../../components/MobileControls";

/**
 * Town's camera controls, centred on the right edge: zoom in and out, and
 * ALL for the whole town. On the phone the shell's More menu joins them, so
 * Town has one set of floating controls.
 */
export function TownZoomControls({
  onZoom,
  onAll,
  shellControls,
}: {
  onZoom(direction: 1 | -1): void;
  onAll(): void;
  shellControls: ReturnType<typeof useMobileControls>;
}) {
  return (
    <div className="town-zoom" role="group" aria-label="Camera">
      <button type="button" aria-label="Zoom in" onClick={() => onZoom(1)}>
        +
      </button>
      <button type="button" aria-label="Zoom out" onClick={() => onZoom(-1)}>
        −
      </button>
      <button
        type="button"
        className="town-zoom-all"
        aria-label="Show the whole town"
        onClick={onAll}
      >
        ALL
      </button>
      {shellControls ? (
        <button
          type="button"
          className="town-zoom-more"
          aria-label="More options"
          aria-haspopup="menu"
          aria-expanded={shellControls.moreOpen}
          onClick={shellControls.toggleMore}
        >
          <EllipsisVertical size={18} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
