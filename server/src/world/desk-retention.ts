import {
  assertDeskMetadataSize,
  deskMetadataBytes,
  DESK_HISTORY_LIMIT,
  DESK_METADATA_MAX_BYTES,
} from "../../../shared/deskState";
import type { SavedTerminalMark } from "../storage/terminal-marks";

/** Oldest inactive captures yield to current stops, never the reverse. */
export function deskHistoryEvictions(
  saved: SavedTerminalMark[],
  current: SavedTerminalMark[],
) {
  assertDeskMetadataSize(current);
  const ids = new Set(current.map((row) => row.id));
  const history = saved.filter(
    (row) => row.kind === "desk" && !ids.has(row.id),
  );
  const removed: SavedTerminalMark[] = [];
  while (
    history.length > DESK_HISTORY_LIMIT ||
    deskMetadataBytes([...current, ...history]) > DESK_METADATA_MAX_BYTES
  )
    removed.push(history.shift()!);
  return removed;
}
