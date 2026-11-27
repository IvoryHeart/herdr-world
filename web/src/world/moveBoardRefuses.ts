/**
 * Testing switch: open World with `?moveBoardRefuses=1` and every agent move
 * to another runtime asks the service to have the Board refuse its desk
 * rehome (server/src/rpc/agent-move.ts), so a Codex move that lands while
 * its desk details (colour, pin, links) stay behind can be tried. The page
 * drops the parameter at once; the switch lasts until a reload.
 */
const PARAM = "moveBoardRefuses";
let on: boolean | undefined;

/** The switch, read once per page load; the parameter is removed. */
export function moveBoardRefuses(): boolean {
  if (on !== undefined) return on;
  on = false;
  if (typeof location === "undefined") return on;
  const url = new URL(location.href);
  if (!url.searchParams.has(PARAM)) return on;
  on = url.searchParams.get(PARAM) !== "0";
  url.searchParams.delete(PARAM);
  history.replaceState(history.state, "", url);
  return on;
}
