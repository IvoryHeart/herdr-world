/**
 * A testing-only switch for herdr-core connections: open World with
 * `?coreFixture` and Manage connections shows a "Fixture core" box. Its
 * buttons start, kill and remove an in-process stand-in core on the World
 * service (two synthetic terminals, no programs), so a person can watch a
 * core connection go live, stale and back without installing core. The page
 * drops the parameter at once; the box stays until the page reloads.
 * `?coreFixture=alphabet` puts the reviewer at terminal 20 (`t1b`).
 */
const PARAM = "coreFixture";
let enabled: boolean | undefined;
let scenario: "default" | "alphabet" = "default";

/** The switch, read once per page load; the parameter is removed. */
export function coreFixtureEnabled(): boolean {
  if (enabled !== undefined) return enabled;
  enabled = false;
  if (typeof location === "undefined") return enabled;
  const url = new URL(location.href);
  if (!url.searchParams.has(PARAM)) return enabled;
  enabled = true;
  scenario =
    url.searchParams.get(PARAM) === "alphabet" ? "alphabet" : "default";
  url.searchParams.delete(PARAM);
  history.replaceState(history.state, "", url);
  return enabled;
}

export function coreFixtureScenario(): "default" | "alphabet" {
  coreFixtureEnabled();
  return scenario;
}

/** For tests: forget the switch so the next read sees the URL again. */
export function resetCoreFixture() {
  enabled = undefined;
  scenario = "default";
}
