import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { dataRoot, replaceDataFile } from "../config/data-paths";
import { worldEnv } from "../config/environment";
import {
  type AgentProfile,
  PROFILE_LIMITS,
  ProfileError,
  STARTER_PROFILES,
  parseProfile,
} from "../../../shared/agentProfile";
import {
  type ChimeSettings,
  ChimeError,
  DEFAULT_CHIMES,
  TIMBRE_LABELS,
  parseChimeSettings,
} from "../../../shared/chimes";
import {
  BIN_COUNTDOWNS,
  type BinCountdown,
  DEFAULT_BIN_COUNTDOWN,
  parseBinCountdown,
} from "../../../shared/bin";

/**
 * The World service's agent profiles, plus which launched terminal came from
 * which profile so Town can dress it, the owner's chime settings and who
 * holds the Town master role, and the bin countdown. One revisioned document, bounded and written
 * atomically. Starter profiles are seeded once and are then the owner's to
 * edit or delete.
 */

export type ProfileAssignment = {
  connection_id: string;
  terminal_id: string;
  profile_id: string;
};
/** A terminal on a host, as assignments key it. */
export type TerminalKey = { connection_id: string; terminal_id: string };
export type ProfilesDocument = {
  version: 1;
  revision: number;
  profiles: AgentProfile[];
  assignments: ProfileAssignment[];
  chimes: ChimeSettings;
  /**
   * The one agent holding the Town master role, or null. Only the owner
   * assigns it; like assignments it names a terminal, so it ends with the
   * terminal (a Herdr restart).
   */
  town_master: TerminalKey | null;
  /** How long an agent waits in the bin before it is closed. */
  bin_countdown_s: BinCountdown;
};

export const MAX_ASSIGNMENTS = 256;

export function defaultProfilesPath() {
  return (
    worldEnv("AGENT_PROFILES_PATH") ?? join(dataRoot(), "agent-profiles.json")
  );
}

function seeded(): ProfilesDocument {
  return {
    version: 1,
    revision: 0,
    profiles: structuredClone(STARTER_PROFILES),
    assignments: [],
    chimes: structuredClone(DEFAULT_CHIMES),
    town_master: null,
    bin_countdown_s: DEFAULT_BIN_COUNTDOWN,
  };
}

const ID = /^[A-Za-z0-9:_.-]{1,128}$/;
function parseAssignment(value: unknown): ProfileAssignment | null {
  const v = value as Record<string, unknown> | null;
  return v &&
    typeof v.connection_id === "string" &&
    typeof v.terminal_id === "string" &&
    typeof v.profile_id === "string" &&
    ID.test(v.connection_id) &&
    ID.test(v.terminal_id) &&
    ID.test(v.profile_id)
    ? {
        connection_id: v.connection_id,
        terminal_id: v.terminal_id,
        profile_id: v.profile_id,
      }
    : null;
}
function parseTerminalKey(value: unknown): TerminalKey | null {
  const v = value as Record<string, unknown> | null;
  return v &&
    typeof v.connection_id === "string" &&
    typeof v.terminal_id === "string" &&
    ID.test(v.connection_id) &&
    ID.test(v.terminal_id)
    ? { connection_id: v.connection_id, terminal_id: v.terminal_id }
    : null;
}
const sameTerminal = (a: TerminalKey, b: TerminalKey) =>
  a.connection_id === b.connection_id && a.terminal_id === b.terminal_id;

/** The Town master's timbre is its own: no crew default or profile uses it. */
function checkChimes(document: ProfilesDocument) {
  const master = document.chimes.timbres.town_master;
  const taken = document.profiles.find((p) => p.chime === master);
  if (taken)
    throw new ProfileError(
      `${TIMBRE_LABELS[master]} is the Town master's chime; ${taken.name} can't use it`,
    );
}

export function parseProfilesDocument(value: unknown): ProfilesDocument {
  const v = value as Record<string, unknown> | null;
  if (!v || v.version !== 1 || !Array.isArray(v.profiles))
    throw new ProfileError("not a profiles document");
  const profiles = v.profiles
    .slice(0, PROFILE_LIMITS.profiles)
    .map(parseProfile);
  if (new Set(profiles.map((p) => p.id)).size !== profiles.length)
    throw new ProfileError("profile IDs repeat");
  let chimes: ChimeSettings;
  try {
    chimes = parseChimeSettings(v.chimes);
  } catch {
    chimes = structuredClone(DEFAULT_CHIMES);
  }
  const document: ProfilesDocument = {
    version: 1,
    revision: Number.isSafeInteger(v.revision) ? (v.revision as number) : 0,
    profiles,
    assignments: (Array.isArray(v.assignments) ? v.assignments : [])
      .map(parseAssignment)
      .filter((a): a is ProfileAssignment => a !== null)
      .slice(-MAX_ASSIGNMENTS),
    chimes,
    town_master: parseTerminalKey(v.town_master),
    bin_countdown_s: parseBinCountdown(v.bin_countdown_s),
  };
  // A profile that took the master's chime before falls back to its class's.
  const master = chimes.timbres.town_master;
  for (const profile of document.profiles)
    if (profile.chime === master) profile.chime = null;
  return document;
}

export class ProfileStore {
  private document: ProfilesDocument;

  constructor(
    private readonly path: string = defaultProfilesPath(),
    private readonly options: {
      now?: () => number;
      log?: (message: string) => void;
    } = {},
  ) {
    this.document = this.load();
  }

  private load(): ProfilesDocument {
    if (!existsSync(this.path)) return seeded();
    try {
      return parseProfilesDocument(JSON.parse(readFileSync(this.path, "utf8")));
    } catch (error) {
      const aside = `${this.path}.unreadable-${(this.options.now ?? Date.now)()}`;
      try {
        renameSync(this.path, aside);
      } catch {
        // Leave it; the next save replaces it.
      }
      this.options.log?.(
        `agent profiles unreadable (${String(error)}); kept at ${aside}`,
      );
      return seeded();
    }
  }

  get(): ProfilesDocument {
    return structuredClone(this.document);
  }

  profile(id: string): AgentProfile | undefined {
    const found = this.document.profiles.find((p) => p.id === id);
    return found && structuredClone(found);
  }

  private commit(next: ProfilesDocument) {
    next.revision = this.document.revision + 1;
    replaceDataFile(this.path, JSON.stringify(next));
    this.document = next;
    return this.get();
  }

  /** Create or replace one profile. */
  save(value: unknown): ProfilesDocument {
    const profile = parseProfile(value);
    const next = structuredClone(this.document);
    const index = next.profiles.findIndex((p) => p.id === profile.id);
    if (index >= 0) {
      // A starter stays marked as one; the browser cannot claim the mark.
      if (next.profiles[index]!.starter) profile.starter = true;
      else delete profile.starter;
      next.profiles[index] = profile;
    } else {
      delete profile.starter;
      if (next.profiles.length >= PROFILE_LIMITS.profiles)
        throw new ProfileError(
          `World keeps at most ${PROFILE_LIMITS.profiles} profiles`,
        );
      next.profiles.push(profile);
    }
    checkChimes(next);
    return this.commit(next);
  }

  /** Replace the owner's chime settings. */
  saveChimes(value: unknown): ProfilesDocument {
    let chimes: ChimeSettings;
    try {
      chimes = parseChimeSettings(value);
    } catch (error) {
      if (error instanceof ChimeError) throw new ProfileError(error.message);
      throw error;
    }
    const next = structuredClone(this.document);
    next.chimes = chimes;
    checkChimes(next);
    return this.commit(next);
  }

  /** Set the bin countdown to one of the offered lengths. */
  saveBinCountdown(value: unknown): ProfilesDocument {
    if (!BIN_COUNTDOWNS.includes(value as BinCountdown))
      throw new ProfileError("choose a bin countdown from the list");
    const next = structuredClone(this.document);
    next.bin_countdown_s = value as BinCountdown;
    return this.commit(next);
  }

  /**
   * Give the Town master role to a terminal, or clear it with null. Moving it
   * from another holder needs `replace`, so the owner is asked first.
   */
  setTownMaster(
    value: unknown,
    options: { replace?: boolean } = {},
  ): ProfilesDocument {
    const next = structuredClone(this.document);
    if (value === null) {
      next.town_master = null;
      return this.commit(next);
    }
    const key = parseTerminalKey(value);
    if (!key) throw new ProfileError("the Town master must be a terminal");
    const current = next.town_master;
    if (current && !sameTerminal(current, key) && !options.replace)
      throw new ProfileError("another agent is the Town master");
    next.town_master = key;
    return this.commit(next);
  }

  delete(id: string): ProfilesDocument {
    const next = structuredClone(this.document);
    next.profiles = next.profiles.filter((p) => p.id !== id);
    next.assignments = next.assignments.filter((a) => a.profile_id !== id);
    return this.commit(next);
  }

  /** Remember that a launched terminal is this profile's agent. */
  assign(assignment: ProfileAssignment): ProfilesDocument {
    const parsed = parseAssignment(assignment);
    if (!parsed) throw new ProfileError("assignment is not valid");
    const next = structuredClone(this.document);
    next.assignments = [
      ...next.assignments.filter(
        (a) =>
          a.connection_id !== parsed.connection_id ||
          a.terminal_id !== parsed.terminal_id,
      ),
      parsed,
    ].slice(-MAX_ASSIGNMENTS);
    return this.commit(next);
  }
}

type Write = (
  store: ProfileStore,
  p: Record<string, unknown>,
) => ProfilesDocument;
/** The RPCs that write the profiles document, which also holds the chimes, the Town master and the bin countdown. */
const WRITES: Record<string, Write> = {
  "world.profiles.save": (store, p) => store.save(p.profile),
  "world.profiles.delete": (store, p) => store.delete(String(p.id ?? "")),
  "world.chimes.save": (store, p) => store.saveChimes(p.chimes),
  "world.bin_countdown.save": (store, p) => store.saveBinCountdown(p.seconds),
  "world.town_master.set": (store, p) =>
    store.setTownMaster(p.terminal ?? null, { replace: p.replace === true }),
};

/** The write an RPC method performs on the profiles document, if any. */
export function profileWrite(method: string) {
  const write = Object.hasOwn(WRITES, method) ? WRITES[method] : undefined;
  return write
    ? (store: ProfileStore, params: unknown) =>
        write(store, (params ?? {}) as Record<string, unknown>)
    : null;
}
