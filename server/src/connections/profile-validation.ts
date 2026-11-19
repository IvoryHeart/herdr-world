import { type ConnectionProfile, validateConnectionProfile } from "./profiles";

/** Caller input failures; persistence and runtime failures retain their own type. */
export class ProfileInputError extends Error {}

export function validateProfileInput(value: unknown): ConnectionProfile {
  try {
    return validateConnectionProfile(value);
  } catch (error) {
    throw new ProfileInputError((error as Error).message, { cause: error });
  }
}
