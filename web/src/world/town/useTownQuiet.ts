import { useMemo, useRef, useState } from "react";
import type {
  HerdrOfficeProjection,
  OfficeAgent,
} from "../herdrOfficeProjection";
import type { OfficePreferences } from "../officePreferences";
import type { TownBoardQuiet } from "./TownBoard";
import { townQuietAgents, townQuietSame, townQuietText } from "./townQuietWork";

type Anchor = { x: number; y: number };
const NONE: ReadonlyMap<string, number> = new Map();

/**
 * Town's quiet working agents (#1130): who has been working without its
 * session moving for the Quiet working agents threshold, and the board's
 * find. Find shows the first quiet agent (`show`); `step` then walks the ones
 * still quiet, wrapping, as reception's find does (useTownReception.ts).
 */
export function useTownQuiet(
  office: Pick<HerdrOfficeProjection, "roster">,
  activityAt: (agent: OfficeAgent) => number | undefined,
  now: number,
  { townQuietMinutes: minutes }: Pick<OfficePreferences, "townQuietMinutes">,
  show: (key: string, anchor: Anchor) => void,
) {
  // The same map, and so the same key set, while nobody's quiet changes, so
  // the scene is not handed a new state every clock tick.
  const last = useRef<ReadonlyMap<string, number>>(NONE);
  const since = useMemo(() => {
    const next = townQuietAgents(
      office.roster.map(({ agent }) => agent),
      activityAt,
      now,
      minutes,
    );
    if (townQuietSame(next, last.current)) return last.current;
    return (last.current = next);
  }, [office.roster, activityAt, now, minutes]);
  const [found, setFound] = useState<readonly string[]>([]);
  const keys = useMemo(
    (): ReadonlySet<string> => new Set(since.keys()),
    [since],
  );
  const board = useMemo(
    (): TownBoardQuiet | undefined =>
      since.size
        ? {
            count: since.size,
            minutes,
            onFind(anchor) {
              const all = [...since.keys()];
              setFound(all);
              show(all[0]!, anchor);
            },
          }
        : undefined,
    // `show` is the caller's, fresh each render; the board needs only the
    // agents and the threshold to change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [since, minutes],
  );
  return {
    /** Quiet agents' keys, the same set while nobody's quiet changes. */
    keys,
    /** When each quiet agent last moved, for the time beside its hourglass. */
    since,
    /** The board's "2 quiet 10 m+" line and its find, while any are quiet. */
    board,
    /** The card's "No progress for 23 m (last 14:02)", or null. */
    text(key: string) {
      const at = since.get(key);
      return at === undefined ? null : townQuietText(at, now);
    },
    /**
     * Next after find: shows the found agent after `key` that is still
     * quiet, or null when `key` was not found or is the only one left.
     */
    step(key: string, anchor: Anchor) {
      const still = found.filter((each) => since.has(each));
      const at = still.indexOf(key);
      if (at < 0 || still.length < 2) return null;
      return () => show(still[(at + 1) % still.length]!, anchor);
    },
    clear: () => setFound([]),
  };
}
