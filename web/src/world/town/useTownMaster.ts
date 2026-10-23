import { useEffect } from "react";
import type { OfficeAgent } from "../herdrOfficeProjection";

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
  const master = wanted
    ? (
        roster.find(({ agent }) => agent.agentName?.toLowerCase() === wanted) ??
        roster.find(({ agent }) => agent.displayLabel.toLowerCase() === wanted)
      )?.agent
    : undefined;
  useEffect(() => {
    if (!master || mobile || dockedTownMasters.has(master.key)) return;
    dockedTownMasters.add(master.key);
    dock(master.key);
    // dock reads the current roster; the master opens once per key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [master?.key, mobile]);
}
