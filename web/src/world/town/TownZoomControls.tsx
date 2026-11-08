import { EllipsisVertical } from "lucide-react";
import { useEffect } from "react";
import { useMobileControls } from "../../components/MobileControls";

/**
 * Town's camera group: the zoom buttons step between whole town, one
 * building, one room and one desk (TownSceneCamera.stepZoom), and ALL shows
 * the whole town. On a phone the shell's More menu joins the group, so Town
 * has one set of floating controls.
 */
export function TownZoomControls({
  onStep,
  onAll,
}: {
  onStep: (direction: 1 | -1) => void;
  onAll: () => void;
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
