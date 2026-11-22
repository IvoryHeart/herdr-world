import { useEffect } from "react";
import type { TerminalKey } from "../agentProfiles";
import type { WorldObject } from "../worldObject";

/** Town masters whose chat has been docked in this page visit. */
const dockedTownMasters = new Set<string>();

/** A synced holder docks once per visit on wide screens, without taking focus. */
export function useTownMaster(
  world: Pick<WorldObject, "leaves">,
  holder: TerminalKey | null,
  mobile: boolean,
  dock: (agentKey: string) => void,
) {
  const master =
    !mobile && holder
      ? world.leaves.find(
          (leaf) =>
            leaf.kind === "agent" &&
            leaf.connectionId === holder.connection_id &&
            leaf.terminalId === holder.terminal_id &&
            !leaf.stale &&
            leaf.capabilities.openSpaces,
        )
      : undefined;
  const key = master?.id;
  useEffect(() => {
    if (!key || dockedTownMasters.has(key)) return;
    dockedTownMasters.add(key);
    dock(key);
  }, [key, dock]);
}
