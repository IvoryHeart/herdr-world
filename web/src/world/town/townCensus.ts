import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import type { ProfilesDocument } from "../agentProfiles";
import { profileFor } from "../agentProfiles";
import { officePresentationKey } from "../officeSelection";
import { townHarnessOf, type TownHarness } from "./townLens";
import type { TownSummary } from "./townSummary";

/**
 * Town's census (#980): the town's numbers as a city game shows them —
 * buildings, rooms and tables; its population by what each agent is doing;
 * and the skills it has (each agent's harness, plain shells, and the skills
 * of the profiles World launched agents from). Every count carries the Town
 * keys of what it counts, so choosing it lights them on the map through
 * Town's search light. It reads only what World already observes.
 */
export type TownCensusItem = {
  /** Stable while the town changes, so a lit count stays lit and live. */
  id: string;
  /** Its name in the census ("Rooms", "Claude", "code-review"). */
  label: string;
  count: number;
  /** Town keys of what it counts (buildings, rooms, tables, agents, panes). */
  keys: readonly string[];
  /** It needs you: the one count that may take the attention colour. */
  attention?: boolean;
  /** What a lit count says: "2 waiting on you". */
  showing: string;
};

export type TownCensus = {
  places: readonly TownCensusItem[];
  /** Busy, waiting, done and quiet first (the board's columns), then the rest. */
  population: readonly TownCensusItem[];
  skills: readonly TownCensusItem[];
};

const HARNESS_ORDER: readonly TownHarness[] = [
  "claude",
  "codex",
  "pi",
  "other",
];
const HARNESS_NAMES: Record<TownHarness, string> = {
  claude: "Claude",
  codex: "Codex",
  pi: "Pi",
  other: "Other agents",
  shell: "Plain shells",
};

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

function item(
  id: string,
  label: string,
  keys: readonly string[],
  showing: string,
  count = keys.length,
): TownCensusItem {
  return { id, label, count, keys, showing };
}

/**
 * The census of a town. The population's busy, waiting, done and quiet
 * counts are the Town board's (townSummary.ts), so the board and the census
 * never disagree; waiting lights the blocked agents and whoever asked an
 * open question (`askingKeys`, World leaf IDs).
 */
export function townCensus(
  office: HerdrOfficeProjection,
  summary: TownSummary,
  askingKeys: ReadonlySet<string>,
  profiles: ProfilesDocument | null,
): TownCensus {
  const { counts } = summary;
  const agents = office.roster.map(({ agent }) => agent);
  const keysWhere = (test: (agent: (typeof agents)[number]) => boolean) =>
    agents.filter(test).map((agent) => agent.key);
  const offline = office.hosts.filter((host) => host.stale);

  const places = [
    item(
      "buildings",
      "Buildings",
      office.hosts.map((host) => host.key),
      plural(office.hosts.length, "building", "buildings"),
    ),
    ...(offline.length
      ? [
          item(
            "offline",
            "Offline",
            offline.map((host) => host.key),
            plural(offline.length, "offline building", "offline buildings"),
          ),
        ]
      : []),
    item(
      "rooms",
      "Rooms",
      office.roomRoster.map((room) => room.key),
      plural(office.roomRoster.length, "room", "rooms"),
    ),
    item(
      "tables",
      "Tables",
      office.deskRoster.map(({ desk }) => desk.key),
      plural(office.deskRoster.length, "table", "tables"),
    ),
  ];

  const agentKeys = new Set(agents.map((agent) => agent.key));
  const waiting = new Set(summary.needsYou.map((entry) => entry.agent.key));
  for (const key of askingKeys)
    waiting.add(
      agentKeys.has(key) ? key : (officePresentationKey(office, key) ?? key),
    );
  const fuel = keysWhere((agent) => !!agent.usageStop);
  const unknown = keysWhere((agent) => agent.semanticStatus === "unknown");
  const population: TownCensusItem[] = [
    item(
      "agents",
      "Agents",
      agents.map((agent) => agent.key),
      plural(counts.agents, "agent", "agents"),
      counts.agents,
    ),
    item(
      "working",
      "Busy",
      keysWhere(
        (agent) => agent.semanticStatus === "working" && !agent.usageStop,
      ),
      `${counts.working} busy`,
      counts.working,
    ),
    {
      ...item(
        "waiting",
        "Waiting",
        [...waiting],
        `${counts.needsYou} waiting on you`,
        counts.needsYou,
      ),
      attention: counts.needsYou > 0,
    },
    item(
      "done",
      "Done",
      summary.finished.map((entry) => entry.agent.key),
      `${counts.finished} done`,
      counts.finished,
    ),
    item(
      "quiet",
      "Quiet",
      keysWhere((agent) => agent.semanticStatus === "idle" && !agent.usageStop),
      `${counts.quiet} quiet`,
      counts.quiet,
    ),
    ...(fuel.length
      ? [item("fuel", "Out of fuel", fuel, `${fuel.length} out of fuel`)]
      : []),
    ...(unknown.length
      ? [item("unknown", "Unknown", unknown, `${unknown.length} unknown`)]
      : []),
  ];

  const byHarness = new Map<TownHarness, string[]>();
  const bySkill = new Map<string, string[]>();
  for (const agent of agents) {
    const harness = townHarnessOf(agent);
    let keys = byHarness.get(harness);
    if (!keys) byHarness.set(harness, (keys = []));
    keys.push(agent.key);
    const terminal = agent.currentTerminalRef;
    const profile = profileFor(
      profiles,
      terminal.connectionId,
      terminal.nativeId,
    );
    for (const skill of new Set(profile?.skills ?? [])) {
      let holders = bySkill.get(skill);
      if (!holders) bySkill.set(skill, (holders = []));
      holders.push(agent.key);
    }
  }
  const shells = (office.paneRoster ?? [])
    .filter(({ device }) => !device.agentKey)
    .map(({ device }) => device.key);
  const skills = [
    ...HARNESS_ORDER.flatMap((harness) => {
      const keys = byHarness.get(harness);
      return keys
        ? [
            item(
              `harness:${harness}`,
              HARNESS_NAMES[harness],
              keys,
              harness === "other"
                ? plural(keys.length, "other agent", "other agents")
                : `${keys.length} ${HARNESS_NAMES[harness]}`,
            ),
          ]
        : [];
    }),
    ...(shells.length
      ? [
          item(
            "shells",
            HARNESS_NAMES.shell,
            shells,
            plural(shells.length, "plain shell", "plain shells"),
          ),
        ]
      : []),
    // Profile skills, most held first, then by name.
    ...[...bySkill]
      .sort(
        ([a, left], [b, right]) =>
          right.length - left.length || a.localeCompare(b),
      )
      .map(([skill, keys]) =>
        item(
          `skill:${skill}`,
          skill,
          keys,
          `${plural(keys.length, "agent", "agents")} with ${skill}`,
        ),
      ),
  ];
  return { places, population, skills };
}

/** A census item by ID, from the census as it is now (null when gone). */
export function townCensusItem(
  census: TownCensus,
  id: string,
): TownCensusItem | null {
  for (const group of [census.places, census.population, census.skills])
    for (const entry of group) if (entry.id === id) return entry;
  return null;
}
