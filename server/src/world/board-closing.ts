import { serverLogger } from "../utils/logger";
import { checkAnchor } from "./board-anchor";
import { tabClosedOps, type BoardStore } from "./board-store";
import { closesTerminals, pruneGoneInterest } from "./interest-prune";

/** A host's current runtime, as the board's close handling reads it. */
type Host = {
  call: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  isCurrent: () => boolean;
  changed: (revision: number) => void;
};

/**
 * What Board's saved state does after Herdr closes something on a host's
 * current runtime: a closed tab's colour and desk pin go, and mute or focus
 * records for terminals that are gone go.
 */
export function afterHerdrClose(
  board: BoardStore,
  connectionId: string,
  eventName: string | null | undefined,
  event: unknown,
  host: Host,
) {
  const closedTab =
    eventName?.replaceAll("_", ".") === "tab.closed"
      ? (event as { data?: { tab_id?: unknown } }).data?.tab_id
      : undefined;
  if (typeof closedTab === "string" && closedTab)
    void dropClosedTabSettings(board, connectionId, closedTab, host);
  if (closesTerminals(eventName))
    void pruneGoneInterest(board, connectionId, host);
}

async function dropClosedTabSettings(
  board: BoardStore,
  connectionId: string,
  tabId: string,
  { call, isCurrent, changed }: Host,
) {
  try {
    const { colors, desk_pins: pins } = board.get().layout;
    const saved = (key: string) => Boolean(colors[key] || pins[key]);
    const plain = saved(`${connectionId}:${tabId}`);
    if (!plain && !saved(`${connectionId}:tab:${tabId}`)) return;
    const absent =
      plain &&
      (
        await checkAnchor(call, {
          kind: "workspace",
          native_id: tabId,
          isCurrent,
        })
      ).state === "absent";
    if (!isCurrent()) return;
    const ops = tabClosedOps(board.get(), connectionId, tabId, absent);
    if (ops.length) changed(board.patch(ops).revision);
  } catch (error) {
    serverLogger.warn("Board could not drop a closed tab's colour or pin", {
      detail: String(error),
    });
  }
}
