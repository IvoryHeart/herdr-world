import { AGENT_NAME, type AgentLook, parseLook } from "./agentProfile";
import { TERMINAL_COLOR_NAMES, type TerminalColorName } from "./terminalColor";

/**
 * Apartments: where finished agents live. When an agent's terminal ends, or
 * the person retires it through the bin, World keeps one resident record in
 * its own store instead of letting the agent vanish. Every other agent a
 * connected host's harnesses remember (their transcripts, from before
 * Apartments too) moves in asleep, unless it is running now. Town draws the
 * records as an apartment building and Board lists the same records; both
 * read this one model.
 *
 * A record is a read-only memory of a terminal that no longer exists: it is
 * never an actionable target. Resuming starts a new agent in a room the
 * person picks, with the harness's own resume command.
 */

/**
 * How many residents World keeps: the whole history, up to this many; the
 * oldest move out first. There is no age limit.
 */
export const APARTMENT_CAPACITY = 5000;

export const APARTMENT_LIMITS = {
  name: 100,
  harness: 40,
  text: 2000,
  path: 1024,
  label: 200,
  session: 200,
  links: 20,
  url: 500,
  /** Usage agent IDs kept per resident, newest last. */
  usage_agents: 8,
  usage_agent: 100,
} as const;

/**
 * How a resident looked in World when it moved in, read while it was live:
 * the profile World launched it from, its Town character (its chosen avatar's
 * or its profile's look; null when Town drew it from its own key) and its
 * colour.
 */
export type ApartmentAppearance = {
  profile_id: string | null;
  look: AgentLook | null;
  color: TerminalColorName | null;
};

/**
 * A resident's look, leniently: a part that is missing or no longer valid
 * (a look from another build) counts as unknown, never as a bad resident.
 * Residents from before World kept looks have none (null).
 */
export function parseApartmentAppearance(
  value: unknown,
): ApartmentAppearance | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  let look: ApartmentAppearance["look"] = null;
  if (row.look !== null && row.look !== undefined)
    try {
      look = parseLook(row.look);
    } catch {
      look = null;
    }
  return {
    profile_id:
      typeof row.profile_id === "string" && AGENT_NAME.test(row.profile_id)
        ? row.profile_id
        : null,
    look,
    color: (TERMINAL_COLOR_NAMES as readonly unknown[]).includes(row.color)
      ? (row.color as TerminalColorName)
      : null,
  };
}

/**
 * ended: its terminal closed by itself. retired: it rode the bin's bus.
 * found: asleep; World found it in its harness's own history on the host
 * (it ended while World was not watching, or before Apartments existed).
 */
export type ApartmentMoveOut = "ended" | "retired" | "found";

export const APARTMENT_MOVE_OUTS: readonly ApartmentMoveOut[] = [
  "ended",
  "retired",
  "found",
];

export type ApartmentLink = {
  kind: "pr" | "issue";
  number: number;
  /** owner/name when known. */
  repo?: string;
  url?: string;
  title?: string;
};

export type ApartmentResident = {
  id: string;
  /** The name Herdr gave the agent, else its harness. */
  name: string;
  /** claude, codex, … when known. */
  harness: string | null;
  /** The folder it worked in, on its host. */
  cwd: string | null;
  /** The room (workspace) and table (tab) it sat at. */
  room: string | null;
  tab: string | null;
  /** The host: its connection's ID and label, and the runtime. */
  connection_id: string;
  connection_label: string;
  runtime: "herdr" | "herdr-core";
  /**
   * The terminal it ran in (historical, never a target); `session:<id>` for
   * a resident found in its harness's history.
   */
  terminal_id: string;
  /**
   * When World first saw it (epoch ms), and when it moved out; for a found
   * resident, its transcript's start and last write.
   */
  first_seen_at: number;
  moved_out_at: number;
  move_out: ApartmentMoveOut;
  /** Its last task summary and its last report, when it left one. */
  summary: string | null;
  last_report: string | null;
  links: ApartmentLink[];
  /** The harness's session ID, when the agent reported one. */
  session_id: string | null;
  /**
   * Its look in World; null for residents that moved in before World kept
   * it. The Apartments window then shows the nearest look it has.
   */
  appearance: ApartmentAppearance | null;
  /**
   * The agent IDs `world.usage.analytics` counted it under while it ran
   * (group `agent`), newest last; a new harness session in the same terminal
   * is a new ID. Absent or empty for records from before World kept them and
   * for residents found in a harness's history: their usage is unknown.
   */
  usage_agent_ids?: string[];
};

/**
 * A resident's usage agent IDs, read leniently: bad entries are dropped, a
 * repeat keeps its newest place and only the newest are kept.
 */
export function apartmentUsageAgentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter(
    (id): id is string =>
      typeof id === "string" &&
      id.length > 0 &&
      id.length <= APARTMENT_LIMITS.usage_agent,
  );
  return [...new Set(ids.reverse())]
    .slice(0, APARTMENT_LIMITS.usage_agents)
    .reverse();
}

export type ApartmentState = {
  revision: number;
  residents: ApartmentResident[];
  capacity: number;
};

export const EMPTY_APARTMENTS: ApartmentState = {
  revision: 0,
  residents: [],
  capacity: APARTMENT_CAPACITY,
};

const SESSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/**
 * One agent's identity across Apartments: its harness and session. Two
 * records with the same key are the same agent (a session ID is the
 * harness's own unique name for it). Null without a session.
 */
export function apartmentSessionKey(
  resident: Pick<ApartmentResident, "harness" | "session_id">,
): string | null {
  return resident.session_id
    ? `${resident.harness ?? ""}/${resident.session_id}`
    : null;
}

/**
 * The command that resumes a resident in its harness, or null when World
 * does not know one. Only a well-formed session ID is ever placed in it.
 */
export function apartmentResumeCommand(
  resident: Pick<ApartmentResident, "harness" | "session_id">,
): string | null {
  const args = apartmentResumeArgs(resident);
  return args ? [resident.harness, ...args].join(" ") : null;
}

/** The harness arguments that resume a resident's session, or null. */
export function apartmentResumeArgs(
  resident: Pick<ApartmentResident, "harness" | "session_id">,
): string[] | null {
  const session = resident.session_id;
  if (!session || !SESSION.test(session)) return null;
  if (resident.harness === "claude") return ["--resume", session];
  if (resident.harness === "codex") return ["resume", session];
  return null;
}

/** The project a resident worked on: its folder's last segment. */
export function apartmentProject(
  resident: Pick<ApartmentResident, "cwd" | "room">,
): string | null {
  const parts = (resident.cwd ?? "").split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? resident.room ?? null;
}

function day(at: number) {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The searchable text of one resident, lower-cased. */
export function apartmentSearchText(resident: ApartmentResident): string {
  return [
    resident.name,
    resident.harness,
    resident.cwd,
    apartmentProject(resident),
    resident.room,
    resident.tab,
    resident.connection_label,
    resident.summary,
    resident.last_report,
    resident.session_id,
    day(resident.first_seen_at),
    day(resident.moved_out_at),
    ...resident.links.flatMap((link) => [
      `#${link.number}`,
      link.kind === "pr" ? `pr ${link.number}` : `issue ${link.number}`,
      link.repo,
      link.title,
    ]),
  ]
    .filter((part): part is string => typeof part === "string" && !!part)
    .join("\n")
    .toLowerCase();
}

/**
 * Residents matching every word of `query`, newest first. A word matches
 * name, harness, folder, room, host, summary, report, session, a date
 * (`2026-11-19`, or a prefix such as `2026-11`) or a linked PR/issue
 * (`#42`, `42`).
 */
export function searchApartments(
  residents: readonly ApartmentResident[],
  query: string,
): ApartmentResident[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const sorted = [...residents].sort(
    (a, b) => b.moved_out_at - a.moved_out_at || a.id.localeCompare(b.id),
  );
  if (!words.length) return sorted;
  return sorted.filter((resident) => {
    const text = apartmentSearchText(resident);
    return words.every((word) => text.includes(word));
  });
}

/** At most this many of a resident's last messages are returned. */
export const APARTMENT_HISTORY_MESSAGES = 200;

/** A resident's conversation, read from its harness transcript. */
export type ApartmentHistory = {
  /** ok: read. unavailable: World cannot read it now; detail says why. */
  status: "ok" | "unavailable";
  detail: string;
  messages: {
    id: string;
    role: "user" | "assistant";
    text: string;
    sent_at: string;
  }[];
  /** Earlier messages were left out. */
  truncated: boolean;
  /** The agent's closing report from its last turn. */
  report: string | null;
};
