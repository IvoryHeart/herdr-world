import { isCoreProfile } from "../connections/profiles";

/**
 * The Herdr connection that shows the owner alert for a herdr-core or
 * unplaced asker (#1156). herdr-core has no toasts, so the alert needs a
 * Herdr connection: the default one when the default is a Herdr connection,
 * otherwise (a herdr-core default) the first saved Herdr connection on this
 * computer. Null when there is none; the alert is then refused and Needs you
 * says the owner was not alerted. The choice is captured once, when the
 * question is recorded; dispatch never moves it to another connection.
 */
export function ownerAlertConnection(
  herdr: readonly { id: string }[],
  defaultId: string | null,
  profiles: ReadonlyMap<string, object>,
): string | null {
  if (defaultId && herdr.some((entry) => entry.id === defaultId))
    return defaultId;
  return (
    herdr.find(({ id }) => {
      const profile = profiles.get(id);
      return (
        !!profile &&
        !isCoreProfile(profile) &&
        (profile as { type?: unknown }).type === "local"
      );
    })?.id ?? null
  );
}
