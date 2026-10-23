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

/**
 * The World service's agent profiles, plus which launched terminal came from
 * which profile so Town can dress it. One revisioned document, bounded and
 * written atomically. Starter profiles are seeded once and are then the
 * owner's to edit or delete.
 */

export type ProfileAssignment = {
  connection_id: string;
  terminal_id: string;
  profile_id: string;
};
export type ProfilesDocument = {
  version: 1;
  revision: number;
  profiles: AgentProfile[];
  assignments: ProfileAssignment[];
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

export function parseProfilesDocument(value: unknown): ProfilesDocument {
  const v = value as Record<string, unknown> | null;
  if (!v || v.version !== 1 || !Array.isArray(v.profiles))
    throw new ProfileError("not a profiles document");
  const profiles = v.profiles
    .slice(0, PROFILE_LIMITS.profiles)
    .map(parseProfile);
  if (new Set(profiles.map((p) => p.id)).size !== profiles.length)
    throw new ProfileError("profile IDs repeat");
  return {
    version: 1,
    revision: Number.isSafeInteger(v.revision) ? (v.revision as number) : 0,
    profiles,
    assignments: (Array.isArray(v.assignments) ? v.assignments : [])
      .map(parseAssignment)
      .filter((a): a is ProfileAssignment => a !== null)
      .slice(-MAX_ASSIGNMENTS),
  };
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
