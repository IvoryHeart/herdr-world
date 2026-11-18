import type { ConnectionManager } from "./manager";
import type { ConnectionProfileBootstrap } from "./profile-service";
import { isCoreProfile, type LocalConnectionProfile } from "./profiles";
import { STARTUP_DEFAULT_CONNECTION_ID } from "./types";

export function localMigrationSeed(
  bootstrap: ConnectionProfileBootstrap,
  newProfileId: string,
): LocalConnectionProfile | null {
  const startupProfile = bootstrap.registrations.find(
    (registration) => registration.profile.id === STARTUP_DEFAULT_CONNECTION_ID,
  )?.profile;
  if (
    !startupProfile ||
    startupProfile.type !== "local" ||
    isCoreProfile(startupProfile)
  )
    return null;
  return {
    id: newProfileId === "local" ? "localhost" : "local",
    label: "Local",
    type: "local",
    control_socket_path: startupProfile.control_socket_path,
    client_socket_path: startupProfile.client_socket_path,
    auto_connect: true,
  };
}

/** The setup card's lookup; a ready implicit local server counts as Herdr. */
export function noHerdrTuiForMigration(
  manager: Pick<ConnectionManager, "has" | "status">,
  findBinary: () => string | null,
): boolean {
  return (
    findBinary() === null &&
    !(
      manager.has(STARTUP_DEFAULT_CONNECTION_ID) &&
      manager.status(STARTUP_DEFAULT_CONNECTION_ID).state === "ready"
    )
  );
}
