/** Current Desk projection of durable metadata, qualified independently of the browser's host filter. */
export type DeskIdentity = {
  connection_id: string;
  connection_generation: number;
  terminal_id: string;
  agent_session_fingerprint: string | null;
};
export type DeskRecord = DeskIdentity & {
  reviewed_stop: string | null;
  stopped_at: number | null;
  /** Stable current-stop identity, independent of its expiring display time. */
  observed_stop_id?: string | null;
  opened_at: number | null;
};
export type DeskState = { revision: number; records: DeskRecord[] };

/** Current stops follow source/session lifetime. Only inactive history is counted. */
export const DESK_HISTORY_LIMIT = 500;
/** Leave 256 KiB of headroom below the existing 1 MiB frame ceiling. */
export const DESK_METADATA_MAX_BYTES = 768 * 1024;
export function deskMetadataBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
export function assertDeskMetadataSize(value: unknown) {
  if (deskMetadataBytes(value) > DESK_METADATA_MAX_BYTES)
    throw new Error(
      "Desk capacity exceeded: metadata exceeds the 768 KiB budget (1 MiB frame limit unchanged)",
    );
}
export const DESK_OPENS_LIMIT = 40;
export const DESK_OBSERVATION_LIMIT = 4096;
export const DESK_IDLE_WINDOW_MS = 12 * 60 * 60_000;

export function deskKey(identity: DeskIdentity) {
  return JSON.stringify([
    identity.connection_id,
    identity.connection_generation,
    identity.terminal_id,
    identity.agent_session_fingerprint,
  ]);
}

export function validDeskIdentity(value: unknown): value is DeskIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as DeskIdentity;
  return (
    [item.connection_id, item.terminal_id].every(
      (id) => typeof id === "string" && id.length > 0 && id.length <= 512,
    ) &&
    Number.isSafeInteger(item.connection_generation) &&
    item.connection_generation >= 0 &&
    (item.agent_session_fingerprint === null ||
      (typeof item.agent_session_fingerprint === "string" &&
        /^[a-f0-9]{64}$/u.test(item.agent_session_fingerprint)))
  );
}

export function parseDeskState(value: unknown): DeskState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const state = value as DeskState;
  if (
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0 ||
    !Array.isArray(state.records)
  )
    return null;
  const seen = new Set<string>();
  for (const record of state.records) {
    if (
      !validDeskIdentity(record) ||
      !(
        record.reviewed_stop === null ||
        (typeof record.reviewed_stop === "string" &&
          record.reviewed_stop.length > 0 &&
          record.reviewed_stop.length <= 8192)
      ) ||
      !(
        record.observed_stop_id === undefined ||
        record.observed_stop_id === null ||
        (typeof record.observed_stop_id === "string" &&
          record.observed_stop_id.length > 0 &&
          record.observed_stop_id.length <= 512)
      ) ||
      ![record.stopped_at, record.opened_at].every(
        (at) => at === null || (Number.isFinite(at) && at >= 0),
      ) ||
      seen.has(deskKey(record))
    )
      return null;
    seen.add(deskKey(record));
  }
  return deskMetadataBytes(state) <= DESK_METADATA_MAX_BYTES ? state : null;
}
