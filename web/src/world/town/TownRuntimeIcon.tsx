import { useEffect, useRef, useState } from "react";
import { helpAnchor } from "../../help/helpEntry";
import type { OfficeRoom } from "../herdrOfficeProjection";
import "./townRuntimeIcon.css";

export type TownRuntimeKind = NonNullable<OfficeRoom["runtimeKind"]>;

/**
 * A runtime's mark in Town's pixel style, told apart by shape as well as
 * colour: the Herdr TUI is a terminal window with a prompt, herdr-core a
 * diamond around its core.
 */
export function TownRuntimeGlyph({
  kind,
  size = 14,
}: {
  kind: TownRuntimeKind;
  size?: number;
}) {
  return (
    <svg
      className="town-runtime-glyph"
      data-runtime={kind}
      width={size}
      height={size}
      viewBox="0 0 12 12"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {kind === "herdr" ? (
        <>
          <rect x="0" y="1" width="12" height="10" fill="#ffe9c2" />
          <rect x="1" y="2" width="10" height="8" fill="#20140a" />
          <rect x="2" y="4" width="1" height="1" fill="#9fd89a" />
          <rect x="3" y="5" width="1" height="1" fill="#9fd89a" />
          <rect x="2" y="6" width="1" height="1" fill="#9fd89a" />
          <rect x="5" y="7" width="4" height="1" fill="#9fd89a" />
        </>
      ) : (
        <>
          <polygon points="6,0 12,6 6,12 0,6" fill="#7fd3e6" />
          <polygon points="6,2 10,6 6,10 2,6" fill="#14303a" />
          <rect x="5" y="5" width="2" height="2" fill="#ffd166" />
        </>
      )}
    </svg>
  );
}

/**
 * A room's runtime beside its name on a plaque: the icon, which names the
 * runtime in words in a small tooltip on hover, keyboard focus or a tap.
 * Its press stays its own, so it never opens the plaque's card.
 */
export function TownRuntimeIcon({
  kind,
  tag,
}: {
  kind: TownRuntimeKind;
  /** The runtime in words: "Herdr TUI", "herdr-core". */
  tag: string;
}) {
  const [tapped, setTapped] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <button
      type="button"
      className={`town-runtime-icon${tapped ? " is-shown" : ""}`}
      data-runtime={kind}
      aria-label={`Runtime: ${tag}`}
      {...helpAnchor("town.runtime")}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        // A tap shows the name for a moment; touch screens have no hover,
        // and some never focus a tapped button.
        if (timer.current) clearTimeout(timer.current);
        setTapped(!tapped);
        if (!tapped) timer.current = setTimeout(() => setTapped(false), 2500);
      }}
      onBlur={() => setTapped(false)}
    >
      <TownRuntimeGlyph kind={kind} />
      <span className="town-runtime-tip" aria-hidden="true">
        {tag}
      </span>
    </button>
  );
}

/**
 * The runtime's mark where the icon cannot take a press of its own (a room's
 * overview card, a menu entry): it names the runtime on hover, and its words
 * stay in the accessible name.
 */
export function TownRuntimeMark({
  kind,
  tag,
  size,
  help = false,
}: {
  kind: TownRuntimeKind;
  tag: string;
  size?: number;
  /** Help's Try rings it, as the plaque's icon (a room's overview card). */
  help?: boolean;
}) {
  return (
    <span
      className="town-runtime-mark"
      data-runtime={kind}
      {...(help ? helpAnchor("town.runtime") : {})}
    >
      <TownRuntimeGlyph kind={kind} size={size} />
      <span className="town-runtime-tip" aria-hidden="true">
        {tag}
      </span>
      <span className="town-visually-hidden">{` (${tag})`}</span>
    </span>
  );
}
