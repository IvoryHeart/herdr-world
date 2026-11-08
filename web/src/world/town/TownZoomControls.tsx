import { useEffect } from "react";
import { EllipsisVertical } from "lucide-react";
import { useMobileControls } from "../../components/MobileControls";

/**
 * Town's camera buttons. The zoom buttons step between whole town, one
 * building, one room and one desk, choosing whatever is nearest the centre
 * of the screen. The current step is read from the zoom, so pinching and
 * wheel zoom mix freely. On the phone the shell's More menu joins them.
 */
export function TownZoomControls({
  onStep,
  onAll,
}: {
  onStep(direction: 1 | -1): void;
  onAll(): void;
}) {
  const shellControls = useMobileControls();
  const ownsShellControls = shellControls !== null;
  useEffect(() => {
    if (!ownsShellControls) return;
    document.documentElement.dataset.townControls = "";
    return () => {
      delete document.documentElement.dataset.townControls;
    };
  }, [ownsShellControls]);
  return (
    <div className="town-zoom" role="group" aria-label="Camera">
      <button type="button" aria-label="Zoom in" onClick={() => onStep(1)}>
        +
      </button>
      <button type="button" aria-label="Zoom out" onClick={() => onStep(-1)}>
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
        // The shell's More menu joins the camera group on the phone, so
        // Town has one set of floating controls.
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
