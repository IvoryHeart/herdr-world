/** Process-local Desk state, qualified independently of the browser's host filter. */
export type DeskIdentity = {
  connection_id: string;
  connection_generation: number;
  terminal_id: string;
  agent_session_fingerprint: string | null;
};
export type DeskRecord = DeskIdentity & {
  reviewed_stop: string | null;
  stopped_at: number | null;
  opened_at: number | null;
};
export type DeskState = { revision: number; records: DeskRecord[] };

export const DESK_RECORD_LIMIT = 500;
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
    !Array.isArray(state.records) ||
    state.records.length > DESK_RECORD_LIMIT
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
      ![record.stopped_at, record.opened_at].every(
        (at) => at === null || (Number.isFinite(at) && at >= 0),
      ) ||
      seen.has(deskKey(record))
    )
      return null;
    seen.add(deskKey(record));
  }
  return state;
}
