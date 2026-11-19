/**
 * Apartments: where finished agents live. When an agent's terminal ends, or
 * the person retires it through the bin, World keeps one resident record in
 * its own store instead of letting the agent vanish. Town draws the records
 * as an apartment building and Board lists the same records; both read this
 * one model.
 *
 * A record is a read-only memory of a terminal that no longer exists: it is
 * never an actionable target. Resuming starts a new agent in a room the
 * person picks, with the harness's own resume command.
 */

/** How many residents World keeps; the oldest move out first. */
export const APARTMENT_CAPACITY = 500;
/** Residents older than this move out on the next write. */
export const APARTMENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export const APARTMENT_LIMITS = {
  name: 100,
  harness: 40,
  text: 2000,
  path: 1024,
  label: 200,
  session: 200,
  links: 20,
  url: 500,
} as const;

/** ended: its terminal closed by itself. retired: it rode the bin's bus. */
export type ApartmentMoveOut = "ended" | "retired";

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
  /** The terminal it ran in (historical, never a target). */
  terminal_id: string;
  /** When World first saw it (epoch ms), and when it moved out. */
  first_seen_at: number;
  moved_out_at: number;
  move_out: ApartmentMoveOut;
  /** Its last task summary and its last report, when it left one. */
  summary: string | null;
  last_report: string | null;
  links: ApartmentLink[];
  /** The harness's session ID, when the agent reported one. */
  session_id: string | null;
};

export type ApartmentState = {
  revision: number;
  residents: ApartmentResident[];
  capacity: number;
  retention_ms: number;
};

export const EMPTY_APARTMENTS: ApartmentState = {
  revision: 0,
  residents: [],
  capacity: APARTMENT_CAPACITY,
  retention_ms: APARTMENT_RETENTION_MS,
};

const SESSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/**
 * The command that resumes a resident in its harness, or null when World
 * does not know one. Only a well-formed session ID is ever placed in it.
 */
export function apartmentResumeCommand(
  resident: Pick<ApartmentResident, "harness" | "session_id">,
): string | null {
  const session = resident.session_id;
  if (!session || !SESSION.test(session)) return null;
  const harness = (resident.harness ?? "").toLowerCase();
  if (harness === "claude") return `claude --resume ${session}`;
  if (harness === "codex") return `codex resume ${session}`;
  return null;
}

/** The project a resident worked on: its folder's last segment. */
export function apartmentProject(
  resident: Pick<ApartmentResident, "cwd" | "room">,
): string | null {
  const parts = (resident.cwd ?? "").split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? resident.room ?? null;
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
