/** A valid carry can target the bus as well as a room. */
export function isTownRoomMoveCandidate(
  valid: boolean,
  action: string | undefined,
  label: string,
): boolean {
  return (
    valid &&
    action !== "bin" &&
    !label.includes("’s place") &&
    !label.includes("last of") &&
    label !== "Leave the team"
  );
}
