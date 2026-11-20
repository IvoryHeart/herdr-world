import type { HostProfile } from "../../../shared/hosts";
import type { RoutedManager } from "./core-support";
import type { ConnectionManager } from "./manager";
import {
  CONNECTION_PROFILE_FILE_VERSION,
  type ConnectionProfile,
  type ConnectionProfileStore,
  type PersistedConnectionRegistry,
  isCoreProfile,
} from "./profiles";
import { STARTUP_DEFAULT_CONNECTION_ID } from "./types";

/** Called only inside the profile service's shared mutation queue. */
export async function persistHostCatalogue(args: {
  hosts: HostProfile[];
  additions: ConnectionProfile[];
  previous: PersistedConnectionRegistry | null;
  profiles: Map<string, { profile: ConnectionProfile; readOnly: boolean }>;
  explicitStartupOverride: boolean;
  manager: Pick<ConnectionManager, "defaultId" | "setDefault">;
  store: ConnectionProfileStore;
  register(profile: ConnectionProfile): void;
  managerOf(id: string): RoutedManager;
  disableMutations(): void;
}): Promise<PersistedConnectionRegistry> {
  // An explicit startup override may shadow a saved startup-default runtime.
  // Keep the saved profile rather than persisting that process-only override.
  const byId = new Map(
    args.previous?.profiles.map((profile) => [profile.id, profile]),
  );
  for (const { profile, readOnly } of args.profiles.values())
    if (!readOnly || !args.explicitStartupOverride)
      byId.set(profile.id, profile);
  for (const profile of args.additions) byId.set(profile.id, profile);
  const profiles = [...byId.values()];
  const defaultId = profiles.some(
    (profile) => profile.id === args.manager.defaultId(),
  )
    ? args.manager.defaultId()
    : (profiles[0]?.id ?? STARTUP_DEFAULT_CONNECTION_ID);
  const next: PersistedConnectionRegistry = {
    version: CONNECTION_PROFILE_FILE_VERSION,
    default_connection_id: defaultId,
    profiles,
    hosts: args.hosts,
  };
  await args.store.save(next);
  const registered: ConnectionProfile[] = [];
  try {
    for (const profile of args.additions) {
      args.register(profile);
      args.profiles.set(profile.id, { profile, readOnly: false });
      registered.push(profile);
    }
  } catch (error) {
    try {
      for (const profile of registered) {
        await args.managerOf(profile.id).unregister(profile.id);
        args.profiles.delete(profile.id);
      }
      if (args.previous) await args.store.save(args.previous);
      else await args.store.clear();
    } catch (rollbackError) {
      args.disableMutations();
      throw new AggregateError(
        [error, rollbackError],
        "host persistence rollback failed",
        { cause: rollbackError },
      );
    }
    throw error;
  }
  if (!args.explicitStartupOverride) {
    for (const entry of args.profiles.values()) entry.readOnly = false;
    if (defaultId !== args.manager.defaultId())
      args.manager.setDefault(defaultId, {
        external: Boolean(
          args.profiles.get(defaultId) &&
            isCoreProfile(args.profiles.get(defaultId)!.profile),
        ),
      });
  }
  return next;
}
