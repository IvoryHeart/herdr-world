/**
 * Ownership of World question closure, not authority to send to a runtime.
 * A verified terminal keeps its questions across runtime/session replacement.
 * Connection identity prevents matching another runtime's reused terminal ID.
 */
export function questionAskerKey(actor: {
  verified: boolean;
  connection_id?: string;
  terminal_id?: string;
}): string | null {
  return actor.verified && actor.connection_id && actor.terminal_id
    ? JSON.stringify([actor.connection_id, actor.terminal_id])
    : null;
}
