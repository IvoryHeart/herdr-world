import { useEffect, useRef } from "react";
import type { OfficeAgent } from "../herdrOfficeProjection";
import { findTownMaster } from "./townMaster";

/** Town masters whose chat has been docked in this page visit. */
const dockedTownMasters = new Set<string>();

/**
 * The Town master's (FirstMate's) chat is docked from the start on wide
 * screens, once per visit: closed, it stays closed until opened again. Herdr's
 * agent name (herdr agent rename) matches first, then the shown label.
 */
export function useTownMaster(
  roster: readonly { agent: OfficeAgent }[],
  name: string,
  mobile: boolean,
  dock: (agentKey: string) => void,
) {
  const wanted = name.trim().toLowerCase();
  const latest = useRef({ roster, wanted, mobile, dock });
  latest.current = { roster, wanted, mobile, dock };
  useEffect(() => {
    if (mobile || !wanted) return;
    let active = true;
    const isCurrent = () =>
      active &&
      latest.current.roster === roster &&
      latest.current.wanted === wanted &&
      !latest.current.mobile;
    void findTownMaster(roster, wanted, isCurrent)
      .then((master) => {
        if (!isCurrent() || !master || dockedTownMasters.has(master.key))
          return;
        dockedTownMasters.add(master.key);
        latest.current.dock(master.key);
      })
      .catch(() => {
        // An optional lookup failure leaves docking to the user's explicit action.
      });
    return () => {
      active = false;
    };
  }, [roster, wanted, mobile]);
}
