import type { ApartmentResident } from "../../../../shared/apartments";
import { type ProfilesDocument, townLookOf } from "../agentProfiles";
import { townLookFor, type TownLook } from "../town/townSprites";
import { worldObjectId } from "../worldObject";

/**
 * Where a resident's avatar comes from:
 * - `own`: the character it had in Town, kept when it moved in;
 * - `profile`: its profile's look now (its own look was not kept);
 * - `harness`: the nearest: a profile of the same harness;
 * - `default`: World's default for an agent without a profile.
 */
export type ResidentLookSource = "own" | "profile" | "harness" | "default";

export type ResidentLook = {
  look: TownLook;
  source: ResidentLookSource;
  /** The profile whose look it shows, for `profile` and `harness`. */
  profile?: string;
};

/** The key Town drew the live agent's default character from. */
export const residentTownKey = (
  resident: Pick<ApartmentResident, "connection_id" | "terminal_id">,
) => worldObjectId(resident.connection_id, "terminal", resident.terminal_id);

/**
 * A resident's avatar: the character it had in Town (its avatar's or its
 * profile's look, or, with neither, the one Town drew from its own key).
 * When that was not kept (a resident from before World kept looks, or its
 * look no longer reads), the nearest: its profile's look now, else a
 * profile of the same harness, else World's default. Never empty.
 */
export function residentLook(
  resident: Pick<
    ApartmentResident,
    "appearance" | "harness" | "connection_id" | "terminal_id"
  >,
  profiles: Pick<ProfilesDocument, "profiles"> | null,
): ResidentLook {
  const kept = resident.appearance;
  if (kept?.look) return { look: townLookOf(kept.look), source: "own" };
  const list = profiles?.profiles ?? [];
  const profile = kept?.profile_id
    ? list.find((item) => item.id === kept.profile_id)
    : undefined;
  if (profile)
    return {
      look: townLookOf(profile.look),
      source: "profile",
      profile: profile.name,
    };
  // Kept, and launched without a profile: Town drew it from its key.
  if (kept && !kept.profile_id)
    return { look: townLookFor(residentTownKey(resident)), source: "own" };
  const sibling = resident.harness
    ? list.find((item) => item.harness === resident.harness)
    : undefined;
  if (sibling)
    return {
      look: townLookOf(sibling.look),
      source: "harness",
      profile: sibling.name,
    };
  return { look: townLookFor(residentTownKey(resident)), source: "default" };
}

/** Says, for a title, where an avatar that is not its own comes from. */
export function residentLookNote(look: ResidentLook): string | null {
  if (look.source === "profile")
    return `Avatar from its profile ${look.profile}`;
  if (look.source === "harness")
    return `Nearest avatar: the ${look.profile} profile, same harness`;
  if (look.source === "default") return "World's default avatar";
  return null;
}
