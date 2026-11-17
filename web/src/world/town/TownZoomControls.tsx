import { useEffect, useSyncExternalStore } from "react";
import { Clock, EllipsisVertical, Moon, Sun, Sunset } from "lucide-react";
import { useMobileControls } from "../../components/MobileControls";
import {
  setTownDaylightMode,
  subscribeTownDaylight,
  townDaylightMode,
  townNextDaylightMode,
} from "./townDaylight";
import "./townDaylight.css";

/** The time-of-day button's face for each mode (townDaylight.ts). */
const DAYLIGHT = {
  clock: { icon: Clock, label: "Time of day: follows your clock" },
  day: { icon: Sun, label: "Time of day: day" },
  dusk: { icon: Sunset, label: "Time of day: dusk" },
  night: { icon: Moon, label: "Time of day: night" },
} as const;

/**
 * Town's camera buttons. The zoom buttons step between whole town, one
 * building, one room and one desk, choosing whatever is nearest the centre
 * of the screen. The current step is read from the zoom, so pinching and
 * wheel zoom mix freely. Under them, the time-of-day button cycles the
 * town's light through your clock, day, dusk and night. On the phone the
 * shell's More menu joins them.
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
  const daylight = useSyncExternalStore(
    subscribeTownDaylight,
    townDaylightMode,
  );
  const Daylight = DAYLIGHT[daylight];
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
      <button
        type="button"
        className="town-zoom-daylight"
        data-mode={daylight}
        aria-label={Daylight.label}
        title={Daylight.label}
        onClick={() => setTownDaylightMode(townNextDaylightMode(daylight))}
      >
        <Daylight.icon size={17} aria-hidden="true" />
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
