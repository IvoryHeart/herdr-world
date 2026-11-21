import {
  type ApartmentResident,
  apartmentResumeArgs,
} from "../../../shared/apartments";

/**
 * The launch that resumes a resident: its harness, its name and the
 * harness's own resume arguments, on the host it ran on (its transcript
 * lives there). Throws a plain refusal otherwise.
 */
export function apartmentResumeLaunch(
  resident: ApartmentResident | undefined,
  connectionId: string,
): { kind: string; label: string; args: string[]; text: string } {
  if (!resident) throw new Error("That resident has moved out.");
  if (resident.connection_id !== connectionId)
    throw new Error(
      `Resume ${resident.name} in a room on ${resident.connection_label}, where it ran.`,
    );
  const args = apartmentResumeArgs(resident);
  if (!args || !resident.harness)
    throw new Error(
      `World does not know how to resume this ${resident.harness ?? "agent"}.`,
    );
  return {
    kind: resident.harness,
    label: resident.name.slice(0, 64),
    args,
    text: "",
  };
}
