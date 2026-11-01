import {
  assertDeskMetadataByteCount,
  DESK_HISTORY_LIMIT,
  DESK_METADATA_MAX_BYTES,
} from "../../../shared/deskState";
import type { MarkBody, SavedTerminalMark } from "../storage/terminal-marks";
import type { BindingEntity } from "./binding-types";
import { terminalMarkStorageBytes } from "../storage/terminal-mark-budget";

/** Conservative resulting-row accounting; neither ID nor time is persisted here. */
export function estimateDeskWrite(
  prior: SavedTerminalMark | undefined,
  body: MarkBody,
  entity: BindingEntity,
  connectionId: string,
  at: number,
) {
  const id = prior?.id ?? `d-00000000:pending:${entity.terminals[0]}`;
  const row: SavedTerminalMark = {
    id,
    kind: "desk",
    revision: (prior?.revision ?? -1) + 1,
    body,
    binding: {
      id: prior?.binding.id ?? "b-00000000",
      record_id: id,
      slot: "target",
      revision: (prior?.binding.revision ?? 0) + 1,
      state: "unresolved",
      checked_at: at,
      policy: "desk",
      adapter: "herdr",
      instance: connectionId,
      kind: "pane",
      native_id: entity.native_id,
      evidence: prior?.binding.evidence ?? {
        terminals: [...entity.terminals],
        ...(entity.session ? { session: entity.session } : {}),
      },
    },
  };
  // A worker may commit later than the observation. A JSON number takes at
  // most 24 bytes; reserve the remainder for its actual binding checked_at.
  const reserve = Math.max(0, 24 - JSON.stringify(at).length);
  const delta =
    terminalMarkStorageBytes([row]) +
    reserve -
    (prior ? terminalMarkStorageBytes([prior]) : 0);
  return { row, reserve, delta };
}

/** Oldest inactive captures yield to current stops, never the reverse. */
export function deskHistoryEvictions(
  saved: SavedTerminalMark[],
  current: SavedTerminalMark[],
  reserveBytes = 0,
) {
  assertDeskMetadataByteCount(terminalMarkStorageBytes(current) + reserveBytes);
  const ids = new Set(current.map((row) => row.id));
  const history = saved.filter(
    (row) => row.kind === "desk" && !ids.has(row.id),
  );
  const removed: SavedTerminalMark[] = [];
  while (
    history.length > DESK_HISTORY_LIMIT ||
    terminalMarkStorageBytes([...current, ...history]) + reserveBytes >
      DESK_METADATA_MAX_BYTES
  )
    removed.push(history.shift()!);
  return removed;
}
