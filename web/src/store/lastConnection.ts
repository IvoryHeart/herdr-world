import { worldLocalStorage } from "../browserStorage";

/**
 * Roamgate #529: the connection this browser is on opens again on its next
 * load. It is only the initial selection (S7); it never retargets an
 * operation, and the phone still opens on Town.
 */
const LAST_CONNECTION_KEY = "lastConnection";

/**
 * The connection to open when none is active: the one this browser was last
 * on while the catalog still has it, else the server's default.
 */
export function preferredConnectionId(
  defaultConnectionId: string,
  catalog: { connections: readonly { id: string }[] },
): string {
  let last: string | null;
  try {
    last = worldLocalStorage.getItem(LAST_CONNECTION_KEY);
  } catch {
    last = null;
  }
  return last &&
    (catalog.connections.length === 0 ||
      catalog.connections.some((connection) => connection.id === last))
    ? last
    : defaultConnectionId;
}

export function rememberLastConnection(connectionId: string) {
  try {
    worldLocalStorage.setItem(LAST_CONNECTION_KEY, connectionId);
  } catch {
    // Storage may be unavailable; a reload then opens the default.
  }
}
