/** Opens the bin tray from any view (Town's stops and bus). */
export const WORLD_BIN_OPEN_EVENT = "herdr-world:bin-open";

export function openWorldBin() {
  window.dispatchEvent(new Event(WORLD_BIN_OPEN_EVENT));
}
