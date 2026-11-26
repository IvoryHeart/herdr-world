import { memo } from "react";
import { openApartments } from "../apartments/apartmentsStore";
import { useApartments } from "../apartments/useApartments";
import {
  townApartmentsCount,
  useTownApartmentsArrivals,
} from "./townApartmentsArrivals";
import { townApartmentsLot } from "./townApartmentsLot";
import { TOWN_TILE as T, type TownLayout } from "./townLayout";
import { useTownPlace } from "./useTownPlace";
import "./townApartmentsSign.css";

const openTownApartments = () => openApartments();

/**
 * The apartment building's sign (#1011): how many finished agents live
 * there, opening Apartments to search, read and resume them. A town too
 * small for the building opens it from the town center instead. Each agent
 * the bus brings counts as it walks in at the door, and the count pops.
 */
export const TownApartments = memo(function TownApartments({
  layout,
}: {
  layout: TownLayout;
}) {
  const { residents, verified } = useApartments();
  const { pending, now } = useTownApartmentsArrivals();
  const lot = townApartmentsLot(layout);
  // The building opens what its sign does (#1170). A town too small for it
  // still opens Apartments from the town center's Buildings ring (#1261).
  useTownPlace("apartments", openTownApartments);
  if (!lot) return null;
  const count = townApartmentsCount(residents, pending, now);
  const text = count
    ? `${count} resident${count === 1 ? "" : "s"}`
    : verified
      ? "No one yet"
      : "…";
  return (
    <button
      type="button"
      className="town-apartments-sign"
      data-town-place="apartments"
      data-help="town.apartments"
      data-empty={count ? undefined : true}
      data-count={count}
      style={{ left: (lot.x + lot.w / 2) * T, top: lot.y * T + 6 }}
      aria-label={`Apartments: ${count ? text : "no residents yet"}. Open Apartments`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        openTownApartments();
      }}
    >
      <span className="town-apartments-title" aria-hidden="true">
        APARTMENTS
      </span>
      <span
        // A new key each count replays its pop as one more moves in.
        key={count}
        className="town-apartments-count"
        data-pop={pending.length ? "" : undefined}
        aria-hidden="true"
      >
        {text}
      </span>
    </button>
  );
});
