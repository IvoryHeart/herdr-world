import type { WorldAsk } from "../worldAsks";
import type { TownOutgoing } from "./townPostModel";

/**
 * A testing-only switch for the post office (#1105): open World with
 * `?townPostFixture` and Town's post office shows synthetic letters (one
 * from an unverified caller) and answers on the trolley instead of the
 * World ledger's, until the page reloads. The page drops the parameter at
 * once. `?townPostFixture=many` adds a bundle beyond the yard;
 * `?townPostFixture=empty` shows a post office with no mail.
 *
 * Only the post office reads it: Needs you, reception and the Outbox keep
 * the real questions, so a test letter's card says it has nothing to
 * answer instead of opening Needs you.
 */

export type TownPostFixtureMode = "letters" | "many" | "empty";

const PARAM = "townPostFixture";
let mode: TownPostFixtureMode | null | undefined;

/** The switch, read once per page load; the parameter is removed. */
export function townPostFixtureMode(): TownPostFixtureMode | null {
  if (mode !== undefined) return mode;
  mode = null;
  if (typeof location === "undefined") return mode;
  const url = new URL(location.href);
  const value = url.searchParams.get(PARAM);
  if (value === null) return mode;
  mode = value === "many" || value === "empty" ? value : "letters";
  url.searchParams.delete(PARAM);
  history.replaceState(history.state, "", url);
  return mode;
}

/** For tests: forget the switch so the next read sees the URL again. */
export function resetTownPostFixture() {
  mode = undefined;
}

/** Fixture letters carry this id prefix; their cards answer nothing. */
export const TOWN_POST_FIXTURE_PREFIX = "town-post-fixture:";

const QUESTIONS: [string, string, string[]][] = [
  [
    "orbit",
    "Ship the login fix to staging now, or wait for the review?",
    ["Ship now", "Wait"],
  ],
  [
    "harbor",
    "The migration drops an unused column. Keep a backup table?",
    ["Keep backup", "Drop it"],
  ],
  [
    "meadow",
    "Which name do you prefer for the new settings page?",
    ["Preferences", "Settings"],
  ],
  [
    "lantern",
    "Tests are flaky on CI only. Retry once or investigate first?",
    [],
  ],
];

function ask(index: number, now: number): WorldAsk {
  const [agent, question, options] = QUESTIONS[index % QUESTIONS.length]!;
  const round = Math.floor(index / QUESTIONS.length);
  return {
    id: `${TOWN_POST_FIXTURE_PREFIX}${index}`,
    at: now - (40 - index) * 60_000,
    actor: {
      label: `${agent}${round ? `-${round + 1}` : ""}`,
      // The third letter comes from a caller the service could not verify.
      verified: index !== 2,
      ...(index !== 2
        ? { name: `${agent}${round ? `-${round + 1}` : ""}` }
        : {}),
      pane_id: `pane-${index}`,
    },
    question,
    options,
    owner_only: false,
  };
}

/** The fixture's letters and trolley for a mode. */
export function townPostFixture(
  fixture: TownPostFixtureMode,
  now: number,
): { asks: WorldAsk[]; outgoing: TownOutgoing } {
  if (fixture === "empty")
    return { asks: [], outgoing: { waiting: 0, checks: 0 } };
  const count = fixture === "many" ? 26 : QUESTIONS.length;
  return {
    asks: Array.from({ length: count }, (_, index) => ask(index, now)),
    outgoing: { waiting: 2, checks: 1 },
  };
}
