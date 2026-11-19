import {
  INTEGRATION_STATES,
  type IntegrationEntry,
  type IntegrationKind,
} from "../../shared/integrations";

/**
 * A testing-only switch for the Integrations screen: open World with
 * `?integrationsFixture` and Configuration → Integrations adds 40 sample
 * rows across runtimes, sources and editors, in every state, so a person
 * can try the tabs and search at the size World is growing to. Sample rows
 * have no action and give World nothing: elements never see them. The page
 * drops the parameter at once; the rows stay until the page reloads.
 */
const PARAM = "integrationsFixture";
let enabled: boolean | undefined;

/** The switch, read once per page load; the parameter is removed. */
export function integrationsFixtureEnabled(): boolean {
  if (enabled !== undefined) return enabled;
  enabled = false;
  if (typeof location === "undefined") return enabled;
  const url = new URL(location.href);
  if (!url.searchParams.has(PARAM)) return enabled;
  enabled = true;
  url.searchParams.delete(PARAM);
  history.replaceState(history.state, "", url);
  return enabled;
}

/** For tests: forget the switch so the next read sees the URL again. */
export function resetIntegrationsFixture() {
  enabled = undefined;
}

const SAMPLES: Array<[IntegrationKind, string, number]> = [
  ["runtime", "Sample host", 14],
  ["source", "Sample tracker", 18],
  ["ide", "Sample editor", 8],
];

/** The sample rows, after the real ones; none when the switch is off. */
export function withIntegrationsFixture(
  rows: readonly IntegrationEntry[],
): readonly IntegrationEntry[] {
  if (!integrationsFixtureEnabled()) return rows;
  const samples = SAMPLES.flatMap(([kind, label, count]) =>
    Array.from({ length: count }, (_, index): IntegrationEntry => {
      const number = String(index + 1).padStart(2, "0");
      return {
        id: `${kind}:sample-${number}`,
        kind,
        type: "sample",
        label: `${label} ${number}`,
        provides: [],
        state: INTEGRATION_STATES[index % INTEGRATION_STATES.length],
        detail: "Sample row from ?integrationsFixture; not real.",
        settings: [],
        control: "none",
      };
    }),
  );
  return [...rows, ...samples];
}
