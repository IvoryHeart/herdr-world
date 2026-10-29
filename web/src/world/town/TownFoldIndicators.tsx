import {
  townFoldedActivityLabel,
  type TownFoldedActivity,
} from "./townFoldedActivity";
import "./townFoldIndicators.css";

export function TownFoldIndicators({
  activity,
}: {
  activity: TownFoldedActivity | undefined;
}) {
  const label = townFoldedActivityLabel(activity);
  if (!label) return null;
  return (
    <span
      className="town-fold-indicators"
      role="img"
      aria-label={label}
      title={label}
    >
      {activity?.needsYou ? (
        <span className="town-fold-needs" aria-hidden="true">
          !
        </span>
      ) : null}
      {activity?.done ? (
        <span className="town-fold-done" aria-hidden="true">
          ✓
        </span>
      ) : null}
    </span>
  );
}
