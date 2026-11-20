import type {
  ApartmentMoveOut,
  ApartmentResident,
  ApartmentState,
} from "../../../../shared/apartments";
import { EMPTY_APARTMENTS } from "../../../../shared/apartments";
import type { ApartmentsClient } from "../apartments/apartmentsStore";

/** Synthetic Apartments residents and an in-memory client, for tests. */
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

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
    }),
  );
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
