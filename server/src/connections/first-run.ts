import { loadConnectionProfileBootstrap } from "./profile-service";
import {
  discoverLocalCoreConnection,
  hasLocalTui,
  type LocalDiscoveryOptions,
} from "./local-discovery";
import {
  CONNECTION_PROFILE_FILE_VERSION,
  type PersistedConnectionRegistry,
} from "./profiles";

/** Initialize only fresh connection state; saved and explicit choices win. */
export async function initializeConnectionProfiles(
  args: Parameters<typeof loadConnectionProfileBootstrap>[0] & {
    discovery?: LocalDiscoveryOptions;
  },
) {
  const bootstrap = loadConnectionProfileBootstrap(args);
  if (bootstrap.persistedRegistry || bootstrap.explicitStartupOverride)
    return bootstrap;
  const profile = discoverLocalCoreConnection(args.discovery);
  if (!profile) return bootstrap;
  const registry: PersistedConnectionRegistry = {
    version: CONNECTION_PROFILE_FILE_VERSION,
    default_connection_id: profile.id,
    profiles: [
      profile,
      // Persist a separate identity so both runtimes remain available after
      // restart. The implicit startup-default identity cannot be saved.
      ...(hasLocalTui(args.discovery)
        ? [
            {
              ...args.startupProfile,
              id: "tui-local",
              label: "Herdr TUI on this computer",
            },
          ]
        : []),
    ],
  };
  await args.store.save(registry);
  return {
    defaultConnectionId: profile.id,
    explicitStartupOverride: false,
    persistedRegistry: registry,
    registrations: registry.profiles.map((profile) => ({
      profile,
      readOnly: false,
    })),
  };
}
