import "./townReceptionMarquee.css";
import { portrait } from "./TownReceptionEntry";

/** Faces a closed reception shows; the rest are a count. */
export const TOWN_MARQUEE_FACES = 5;

/** One visitor as the marquee draws it. */
export type TownMarqueeFace = { key: string; done: boolean };

/**
 * A closed reception (#903): a small marquee over the door with the host's
 * name, how many need you and the first few faces waiting. It is a picture of
 * the board, not a second set of controls: the board itself opens over it on
 * hover, keyboard focus or a tap on the lobby, and holds every control.
 */
export function TownReceptionMarquee({
  label,
  waiting,
  faces,
}: {
  label: string;
  waiting: number;
  faces: readonly TownMarqueeFace[];
}) {
  const shown = faces.slice(0, TOWN_MARQUEE_FACES);
  return (
    <div className="town-reception-marquee" aria-hidden="true">
      <span className="town-reception-marquee-name">{label}</span>
      {waiting ? <b>{waiting}</b> : null}
      {shown.map((face) => (
        <span
          key={face.key}
          className="town-reception-face"
          data-done={face.done || undefined}
        >
          <img src={portrait(face.key)} alt="" width={28} height={40} />
        </span>
      ))}
      {faces.length > shown.length ? (
        <span className="town-reception-marquee-more">
          +{faces.length - shown.length}
        </span>
      ) : null}
    </div>
  );
}
