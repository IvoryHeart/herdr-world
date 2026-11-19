import { memo } from "react";
import { openApartments } from "../apartments/apartmentsStore";
import { useApartments } from "../apartments/useApartments";
import { townApartmentsLot } from "./townApartmentsLot";
import { TOWN_TILE as T, type TownLayout } from "./townLayout";
import "./townApartmentsSign.css";

/**
 * The apartment building's sign (#1011): how many finished agents live
 * there, opening Apartments to search, read and resume them. A town too
 * small for the building opens it from the town center instead.
 */
export const TownApartments = memo(function TownApartments({
  layout,
}: {
  layout: TownLayout;
}) {
  const { residents, verified } = useApartments();
  const lot = townApartmentsLot(layout);
  if (!lot) return null;
  const count = residents.length;
  const text = count
    ? `${count} resident${count === 1 ? "" : "s"}`
    : verified
      ? "No one yet"
      : "…";
  return (
    <button
      type="button"
      className="town-apartments-sign"
      data-empty={count ? undefined : true}
      style={{ left: (lot.x + lot.w / 2) * T, top: lot.y * T + 6 }}
      aria-label={`Apartments: ${count ? text : "no residents yet"}. Open Apartments`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        openApartments();
      }}
    >
      <span className="town-apartments-title" aria-hidden="true">
        APARTMENTS
      </span>
      <span className="town-apartments-count" aria-hidden="true">
        {text}
      </span>
    </button>
  );
});
