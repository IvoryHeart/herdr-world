/**
 * Rooms of a herdr-core connection, as World's read model names them
 * (server/src/herdr-core/topology.ts): `hc:unplaced` is the core's main
 * room, `hc:room:<id>` one of World's own rooms, and `hc:space:<id>` a
 * space the Herdr desktop app made, which stays the app's.
 */
export const CORE_APP_SPACE_REASON =
  "A Herdr app space: rename or close it in the Herdr app";

export function isCoreAppSpace(workspaceId: string) {
  return workspaceId.startsWith("hc:space:");
}
