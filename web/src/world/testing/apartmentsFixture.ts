import { STARTER_PROFILES } from "../../../../shared/agentProfile";
import type {
  ApartmentAppearance,
  ApartmentMoveOut,
  ApartmentResident,
  ApartmentState,
} from "../../../../shared/apartments";
import { EMPTY_APARTMENTS } from "../../../../shared/apartments";
import type { ApartmentsClient } from "../apartments/apartmentsStore";

/** Synthetic Apartments residents and an in-memory client, for tests. */
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const starterLook = (id: string) =>
  STARTER_PROFILES.find((profile) => profile.id === id)!.look;

/**
 * One resident per way the Apartments window finds an avatar
 * (apartments/residentLook.ts), by name.
 */
const LOOKS: Record<string, ApartmentAppearance | null> = {
  // Launched from the Builder profile: its look, kept at move-in.
  ada: { profile_id: "builder", look: starterLook("builder"), color: "orange" },
  // An avatar chosen for it in World.
  grace: { profile_id: null, look: starterLook("designer"), color: "purple" },
  // Started by hand: the character Town drew from its own key.
  linus: { profile_id: null, look: null, color: "teal" },
  // From before World kept looks: the nearest, a profile of its harness.
  hopper: null,
  // Its look no longer reads: its profile's look now.
  lovelace: { profile_id: "reviewer", look: null, color: "blue" },
  // A harness with no profile, from before World kept looks: the default.
  turing: null,
};

/**
 * The usage agent IDs residents were counted under, matching the Usage
 * fixture's agents (usage/usageFixture.ts `fixture-agent-N`), so
 * `?usageFixture&apartments-preview=avatars` shows residents' usage. Linus
 * ran twice in one terminal; the others moved in before World kept usage.
 */
const USAGE: Record<string, string[]> = {
  ada: ["fixture-agent-5"],
  grace: ["fixture-agent-1"],
  linus: ["fixture-agent-0", "fixture-agent-2"],
};

/** Synthetic residents ending at `now`; example.com and example paths only. */
export function fixtureResidents(now: number): ApartmentResident[] {
  const base = {
    connection_id: "fixture",
    connection_label: "Fixture host",
    runtime: "herdr" as const,
    tab: null,
  };
  const people: [
    string,
    string,
    string,
    number,
    ApartmentMoveOut,
    string,
    number | null,
  ][] = [
    [
      "ada",
      "claude",
      "project-alpha",
      2 * HOUR,
      "ended",
      "Fixed the widget parser and opened a PR",
      42,
    ],
    [
      "grace",
      "codex",
      "project-beta",
      26 * HOUR,
      "retired",
      "Reviewed the storage migration",
      17,
    ],
    [
      "linus",
      "claude",
      "project-alpha",
      3 * DAY,
      "ended",
      "Wrote the release notes draft",
      null,
    ],
    [
      "hopper",
      "codex",
      "project-gamma",
      9 * DAY,
      "ended",
      "Investigated the flaky menu test",
      88,
    ],
    [
      "lovelace",
      "codex",
      "project-gamma",
      12 * DAY,
      "retired",
      "Answered the release checklist questions",
      null,
    ],
    [
      "turing",
      "pi",
      "project-beta",
      20 * DAY,
      "retired",
      "Sketched the onboarding copy",
      null,
    ],
  ];
  return people.map(
    ([name, harness, project, ago, move, summary, pr], index) => ({
      ...base,
      id: `r-fixture${index + 1}`,
      name,
      harness,
      cwd: `/srv/example/${project}`,
      room: project,
      terminal_id: `t-fixture${index + 1}`,
      first_seen_at: now - ago - 40 * 60 * 1000,
      moved_out_at: now - ago,
      move_out: move,
      summary,
      last_report: pr ? `Opened PR #${pr}; checks are green.` : null,
      links: pr
        ? [
            {
              kind: "pr" as const,
              number: pr,
              repo: "example/project",
              url: `https://example.com/example/project/pull/${pr}`,
              title: summary,
            },
          ]
        : [],
      session_id:
        harness === "pi" ? null : `0f0e0d0c-0000-4000-8000-00000000000${index}`,
      // A herdr-core resident shares the one look.
      ...(name === "turing"
        ? { runtime: "herdr-core" as const, connection_label: "Fixture core" }
        : {}),
      appearance: LOOKS[name] ?? null,
      usage_agent_ids: USAGE[name] ?? [],
    }),
  );
}

/**
 * A resident of a harness World reads no log of (OpenCode): its usage says
 * tokens are not available. The preview adds it after the avatar cases.
 */
export function fixtureLoglessResident(now: number): ApartmentResident {
  return {
    id: "r-fixture-logless",
    name: "hamilton",
    harness: "opencode",
    cwd: "/srv/example/project-beta",
    room: "project-beta",
    tab: null,
    connection_id: "fixture",
    connection_label: "Fixture host",
    runtime: "herdr",
    terminal_id: "t-fixture-logless",
    first_seen_at: now - 28 * HOUR,
    moved_out_at: now - 26 * HOUR,
    move_out: "ended",
    summary: "Tidied the synthetic style sheet",
    last_report: null,
    links: [],
    session_id: null,
    appearance: null,
    usage_agent_ids: ["fixture-agent-15"],
  };
}

/** A client answering Apartments' calls from synthetic residents in memory. */
export function fixtureApartmentsClient(
  now: number,
  extra: readonly ApartmentResident[] = [],
): ApartmentsClient {
  let state: ApartmentState = {
    ...EMPTY_APARTMENTS,
    revision: 1,
    residents: [...fixtureResidents(now), ...extra],
  };
  return {
    async call(method, params = {}) {
      if (method === "world.apartments.list") return state;
      if (method === "world.apartments.evict") {
        const ids = new Set(params.ids as string[]);
        state = {
          ...state,
          revision: state.revision + 1,
          residents: state.residents.filter((item) => !ids.has(item.id)),
        };
        return state;
      }
      if (method === "world.apartments.history") {
        const resident = state.residents.find((item) => item.id === params.id);
        if (!resident) throw new Error("That resident has moved out.");
        const at = (offset: number) =>
          new Date(resident.first_seen_at + offset).toISOString();
        return {
          status: "ok",
          detail: "",
          truncated: false,
          report: resident.last_report,
          messages: [
            {
              id: "m1",
              role: "user",
              text: `Please: ${resident.summary}`,
              sent_at: at(0),
            },
            {
              id: "m2",
              role: "assistant",
              text: resident.last_report ?? "Done.",
              sent_at: at(30 * 60 * 1000),
            },
          ],
        };
      }
      throw new Error("Unavailable in the Apartments fixture");
    },
    onControl: () => () => undefined,
    onStatus: () => () => undefined,
  };
}
