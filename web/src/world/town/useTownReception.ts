import { useMemo, useRef, useState } from "react";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import {
  townReceptionHeld,
  townReceptionTakes,
  type TownReceptionTakes,
} from "./townReceptionFilter";
import { useTownReceptionFilter } from "./townReceptionSetting";

type Anchor = { x: number; y: number };

/**
 * Town's reception filter (#501): the marks each building's reception takes,
 * the agents it keeps at their desks, and find. Find shows the first kept
 * agent (`show`), and `step` then walks the ones still kept, wrapping.
 */
export function useTownReception(
  office: Pick<HerdrOfficeProjection, "hosts" | "roster">,
  asking: ReadonlySet<string>,
  show: (key: string, anchor: Anchor) => void,
) {
  const filter = useTownReceptionFilter();
  const takes = useMemo((): TownReceptionTakes => {
    const byHost = new Map(
      office.hosts.map((host) => [
        host.key,
        townReceptionTakes(filter, host.connectionId),
      ]),
    );
    const all = townReceptionTakes(filter, undefined);
    return (hostKey) => byHost.get(hostKey) ?? all;
  }, [office.hosts, filter]);
  // The same set while its members are unchanged, so the scene re-places
  // agents only when the filter actually moves someone.
  const lastHeld = useRef<ReadonlySet<string>>(new Set());
  const held = useMemo(() => {
    const next = townReceptionHeld(
      office.roster.map(({ agent }) => agent),
      asking,
      takes,
    );
    const last = lastHeld.current;
    if (next.size === last.size && [...next].every((key) => last.has(key)))
      return last;
    return (lastHeld.current = next);
  }, [office.roster, asking, takes]);
  const [found, setFound] = useState<readonly string[]>([]);
  return {
    takes,
    held,
    find(keys: readonly string[], anchor: Anchor) {
      if (!keys.length) return;
      setFound(keys);
      show(keys[0]!, anchor);
    },
    /**
     * Next after find: shows the found agent after `key` that is still kept
     * at its desk, or null when `key` was not found or is the only one.
     */
    step(key: string, anchor: Anchor) {
      const still = found.filter((each) => held.has(each));
      const at = still.indexOf(key);
      if (at < 0 || still.length < 2) return null;
      return () => show(still[(at + 1) % still.length]!, anchor);
    },
    clear: () => setFound([]),
  };
}
