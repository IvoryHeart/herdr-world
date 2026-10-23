/**
 * Chimes: World's own sound for a change that needs the owner. A chime is a
 * timbre (who: the Town master, the crew, or an agent's profile) played as a
 * motif (why: needs you, finished, for you). The owner learns two small
 * vocabularies instead of one sound per agent.
 *
 * The motif mapping lives here, once: every source of a change (Herdr's
 * lifecycle and custom notifications today, the message ledger later) goes
 * through `motifFor`.
 */

import type { Interest } from "./interest";

/** The built-in set, synthesised in the browser; no sound files. */
export const TIMBRES = [
  "bell",
  "marimba",
  "glass",
  "kalimba",
  "pluck",
  "flute",
  "woodblock",
  "celesta",
] as const;
export type Timbre = (typeof TIMBRES)[number];
export const TIMBRE_LABELS: Record<Timbre, string> = {
  bell: "Bell",
  marimba: "Marimba",
  glass: "Glass",
  kalimba: "Kalimba",
  pluck: "Pluck",
  flute: "Flute",
  woodblock: "Woodblock",
  celesta: "Celesta",
};

export const MOTIFS = ["needs_you", "for_you", "finished"] as const;
export type Motif = (typeof MOTIFS)[number];
export const MOTIF_LABELS: Record<Motif, string> = {
  needs_you: "Needs you",
  for_you: "For you",
  finished: "Finished",
};

/** v1 classes. A sub-agent class waits for a lineage source. */
export type ChimeClass = "town_master" | "crew";

/** The owner's chime settings, shared by every browser of the service. */
export type ChimeSettings = {
  timbres: Record<ChimeClass, Timbre>;
  motifs: Record<Motif, boolean>;
};

export const DEFAULT_CHIMES: ChimeSettings = {
  timbres: { town_master: "bell", crew: "marimba" },
  motifs: { needs_you: true, for_you: true, finished: true },
};

export class ChimeError extends Error {}

export const isTimbre = (value: unknown): value is Timbre =>
  typeof value === "string" && (TIMBRES as readonly string[]).includes(value);

export function parseChimeSettings(value: unknown): ChimeSettings {
  const v = (value ?? {}) as Record<string, unknown>;
  const timbres = (v.timbres ?? {}) as Record<string, unknown>;
  const motifs = (v.motifs ?? {}) as Record<string, unknown>;
  const settings: ChimeSettings = {
    timbres: {
      town_master: isTimbre(timbres.town_master)
        ? timbres.town_master
        : DEFAULT_CHIMES.timbres.town_master,
      crew: isTimbre(timbres.crew) ? timbres.crew : DEFAULT_CHIMES.timbres.crew,
    },
    motifs: {
      needs_you: motifs.needs_you !== false,
      for_you: motifs.for_you !== false,
      finished: motifs.finished !== false,
    },
  };
  if (settings.timbres.crew === settings.timbres.town_master)
    throw new ChimeError("The Town master's timbre can't be the crew's too.");
  return settings;
}

/**
 * The change kinds World relays today: Herdr's lifecycle (`blocked`,
 * `completed`) and its custom notifications addressed to the owner
 * (`message`).
 */
export type ChangeKind = "blocked" | "completed" | "message";

/** The one motif mapping. */
export function motifFor(kind: ChangeKind): Motif {
  switch (kind) {
    case "blocked":
      return "needs_you";
    case "message":
      return "for_you";
    default:
      return "finished";
  }
}

/** Who a change came from, as far as World knows. */
export type ChimeSender = {
  /** Holds the Town master role (the owner assigned it). */
  townMaster: boolean;
  /** The chime of the profile the agent was launched from, if any. */
  profileChime: Timbre | null;
};

/**
 * The timbre for a sender: the Town master always sounds as itself; anyone
 * else uses their profile's chime, then the crew default. An unattributed
 * change (no sender) is crew.
 */
export function timbreFor(
  sender: ChimeSender | null,
  settings: ChimeSettings,
): Timbre {
  if (sender?.townMaster) return settings.timbres.town_master;
  const own = sender?.profileChime;
  return own && own !== settings.timbres.town_master
    ? own
    : settings.timbres.crew;
}

/** Burst order: the Town master first, then by motif. */
export function chimePriority(motif: Motif, townMaster: boolean) {
  return (townMaster ? 10 : 0) + (2 - MOTIFS.indexOf(motif));
}

// Interest is keyed by terminal ({connection_id, terminal_id}); a change with
// no known sender is watching.

/**
 * Whether a change chimes. It always enters the toast and notification; this
 * decides the sound only.
 * - muted: never;
 * - focused: always;
 * - watching: unless some agent is focused, when only the Town master's
 *   needs-you still chimes (it breaks Focus).
 */
export function shouldChime(change: {
  motif: Motif;
  townMaster: boolean;
  settings: ChimeSettings;
  /** The viewer already sees it (its pane is on screen). */
  seen: boolean;
  interest?: Interest;
  /** Some agent is focused. */
  anyFocused?: boolean;
}) {
  if (change.seen || !change.settings.motifs[change.motif]) return false;
  const interest = change.interest ?? "watching";
  if (interest === "muted") return false;
  if (interest === "focused" || !change.anyFocused) return true;
  return change.townMaster && change.motif === "needs_you";
}

/**
 * The reason line that always travels with the sound. A change with no known
 * sender says so; World never guesses one from the text.
 */
export function chimeReason(change: {
  who: string | null;
  motif: Motif;
  detail?: string | null;
}) {
  const detail = change.detail ? `: ${change.detail}` : "";
  return change.who
    ? `${change.who} · ${MOTIF_LABELS[change.motif].toLowerCase()}${detail}`
    : `${MOTIF_LABELS[change.motif]} · sender unknown${detail}`;
}
