import { persistHostCatalogue } from "./host-persistence";
import {
  ConnectionProbeError,
  retryableLocalSocketError,
  testConnectionProfile,
} from "./profile-probe";
export {
  ConnectionProbeError,
  testConnectionSockets,
  testLocalConnectionProfile,
  testConnectionProfile,
} from "./profile-probe";
import {
  connectionIdentityForProfile,
  localMigrationSeed,
} from "./profile-creation";
import { SshTunnelError } from "../bridge/ssh-tunnel";
import { systemScheduler, type Scheduler } from "../service/ports";
import type {
  CoreConnectionListItem,
  CoreConnectionSupport,
  RoutedManager,
} from "./core-support";
import {
  ConnectionManager,
  type ConnectionRuntime,
  type ConnectionRuntimeFactory,
} from "./manager";
import {
  type ConnectionProfile,
  type CoreConnectionProfile,
  isCoreProfile,
  type TuiConnectionProfile,
  ConnectionProfileStore,
  CONNECTION_PROFILE_FILE_VERSION,
  type LocalConnectionProfile,
  type PersistedConnectionRegistry,
  publicConnectionProfile,
  validateConnectionProfile,
} from "./profiles";
import { ProfileInputError, validateProfileInput } from "./profile-validation";
import { STARTUP_DEFAULT_CONNECTION_ID } from "./types";
import { HostConnectionService } from "./host-service";
import type { DiscoverHost } from "./host-discovery";
import { forgetHostRuntime, hostId } from "./hosts";

export { connectionIdentityForProfile } from "./profile-creation";

export type StartupLocalProfile = LocalConnectionProfile & {
  id: typeof STARTUP_DEFAULT_CONNECTION_ID;
};

export type ManagedConnectionProfile = ConnectionProfile | StartupLocalProfile;
/** A Herdr (TUI) profile, including the implicit startup default. */
export type TuiManagedProfile = TuiConnectionProfile | StartupLocalProfile;

export type ConnectionProfileBootstrap = {
  defaultConnectionId: string;
  explicitStartupOverride: boolean;
  persistedRegistry: PersistedConnectionRegistry | null;
  /** Set when startup preserved an invalid registry and fell back to legacy. */
  registryLoadError?: string;
  registrations: Array<{
    profile: ManagedConnectionProfile;
    readOnly: boolean;
  }>;
};

export function loadConnectionProfileBootstrap(args: {
  store: ConnectionProfileStore;
  startupProfile: StartupLocalProfile;
  explicitStartupOverride: boolean;
}): ConnectionProfileBootstrap {
  const persistedRegistry = args.store.load();
  const persisted =
    persistedRegistry?.profiles.map((profile) => ({
      profile,
      readOnly: false,
    })) ?? [];
  if (args.explicitStartupOverride) {
    return {
      defaultConnectionId: STARTUP_DEFAULT_CONNECTION_ID,
      explicitStartupOverride: true,
      persistedRegistry,
      registrations: [
        { profile: args.startupProfile, readOnly: true },
        ...persisted.filter(
          ({ profile }) => profile.id !== STARTUP_DEFAULT_CONNECTION_ID,
        ),
      ],
    };
  }
  if (persistedRegistry) {
    return {
      defaultConnectionId: persistedRegistry.default_connection_id,
      explicitStartupOverride: false,
      persistedRegistry,
      registrations: persisted,
    };
  }
  return {
    defaultConnectionId: STARTUP_DEFAULT_CONNECTION_ID,
    explicitStartupOverride: false,
    persistedRegistry: null,
    registrations: [{ profile: args.startupProfile, readOnly: true }],
  };
}

export type ConnectionProfileRuntimeFactory<Runtime extends ConnectionRuntime> =
  (profile: TuiManagedProfile) => ConnectionRuntimeFactory<Runtime>;

export type ConnectionProfileListItem = ReturnType<
  ConnectionManager<ConnectionRuntime>["status"]
> &
  TuiConnectionProfile & { read_only: boolean };

type RetryTimer = ReturnType<Scheduler["schedule"]>;

export type ConnectionRetryOptions = {
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Optional finite policy; ordinary transient recovery continues until stopped. */
  maxAttempts?: number;
  stableResetMs?: number;
  random?: () => number;
  schedule?: (callback: () => void, delayMs: number) => RetryTimer;
};

type RetryState = {
  /** User connection intent survives a temporarily absent runtime. */
  wanted: boolean;
  enabled: boolean;
  attempt: number;
  token: number;
  retryTimer: RetryTimer | null;
  stableTimer: RetryTimer | null;
};

export class ConnectionProfileService<
  Runtime extends ConnectionRuntime = ConnectionRuntime,
  CoreRuntime extends ConnectionRuntime = ConnectionRuntime,
> {
  readonly hosts: HostConnectionService;
  private readonly profiles = new Map<
    string,
    {
      profile: ManagedConnectionProfile;
      readOnly: boolean;
    }
  >();
  private registry: PersistedConnectionRegistry | null;
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly retryStates = new Map<string, RetryState>();
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly retryMaxAttempts: number;
  private readonly retryStableResetMs: number;
  private readonly retryRandom: () => number;
  private readonly retrySchedule: (
    callback: () => void,
    delayMs: number,
  ) => RetryTimer;
  private supervisionStopped = false;
  private mutationDisabledError: string | null;

  constructor(
    private readonly args: {
      manager: ConnectionManager<Runtime>;
      store: ConnectionProfileStore;
      bootstrap: ConnectionProfileBootstrap;
      createRuntime: ConnectionProfileRuntimeFactory<Runtime>;
      core?: CoreConnectionSupport<CoreRuntime>;
      testProfile?: typeof testConnectionProfile;
      retry?: ConnectionRetryOptions;
      changed?(): void;
      /** This computer has no Herdr TUI; absent assumes it has (#935). */
      noHerdrTui?(): boolean;
      discoverHost?: DiscoverHost;
    },
  ) {
    this.registry = args.bootstrap.persistedRegistry;
    this.mutationDisabledError = args.bootstrap.registryLoadError
      ? "connection registry is invalid; repair or remove it before changing profiles"
      : null;
    this.retryBaseDelayMs = Math.max(1, args.retry?.baseDelayMs ?? 1000);
    this.retryMaxDelayMs = Math.max(
      this.retryBaseDelayMs,
      args.retry?.maxDelayMs ?? 30_000,
    );
    this.retryMaxAttempts = Math.max(
      1,
      args.retry?.maxAttempts ?? Number.POSITIVE_INFINITY,
    );
    this.retryStableResetMs = Math.max(1, args.retry?.stableResetMs ?? 30_000);
    this.retryRandom = args.retry?.random ?? Math.random;
    this.retrySchedule = args.retry?.schedule ?? systemScheduler.schedule;
    for (const registration of args.bootstrap.registrations) {
      this.profiles.set(registration.profile.id, registration);
      this.registerRuntime(registration.profile);
    }
    this.hosts = new HostConnectionService({
      profiles: () => [...this.profiles.values()].map(({ profile }) => profile),
      saved: () => this.registry?.hosts ?? [],
      status: (id) => this.managerOf(id).status(id),
      defaultId: () => args.manager.defaultId(),
      readOnly: (id) =>
        args.bootstrap.explicitStartupOverride &&
        this.profiles.get(id)?.readOnly === true,
      drop: (hostId, ids) => this.removeProfiles(ids, hostId),
      mutate: (operation) => this.mutate(operation),
      discover: args.discoverHost,
      wantsConnection: (id) => this.retryStates.get(id)?.wanted === true,
      start: (id, resetRetry = true) =>
        this.startManaged(id, resetRetry || !this.retryStates.get(id)?.enabled),
      stop: async (id, preserveIntent = false) => {
        this.disableRetry(id, preserveIntent);
        await this.managerOf(id).stop(id);
      },
      persist: async (hosts, additions) => {
        this.requireWritableRegistryState();
        this.registry = await persistHostCatalogue({
          hosts,
          additions,
          previous: this.registry,
          profiles: this.profiles,
          explicitStartupOverride: args.bootstrap.explicitStartupOverride,
          manager: args.manager,
          store: args.store,
          register: (profile) => this.registerRuntime(profile),
          managerOf: (id) => this.managerOf(id),
          disableMutations: () => this.disableMutationsAfterRollbackFailure(),
        });
      },
    });
  }

  /** Herdr (TUI) connections: every existing consumer's catalogue. */
  defaultId(): string {
    return this.args.manager.defaultId();
  }

  list(): ConnectionProfileListItem[] {
    return this.args.manager.list().map((status) => {
      const entry = this.requireProfile(status.id);
      return {
        ...status,
        ...(publicConnectionProfile(
          entry.profile,
          entry.readOnly,
        ) as TuiConnectionProfile & { read_only: boolean }),
      };
    });
  }

  /** Configured profiles by connection ID, for runtime keys (#1152). */
  profilesById(): Map<string, ManagedConnectionProfile> {
    return new Map([...this.profiles].map(([id, e]) => [id, e.profile]));
  }

  /** herdr-core connections with their observation, for the Connections page. */
  coreList(): CoreConnectionListItem[] {
    const core = this.args.core;
    if (!core) return [];
    return core.manager.list().map((status) => {
      const entry = this.requireProfile(status.id);
      return {
        ...status,
        ...(publicConnectionProfile(
          entry.profile,
          entry.readOnly,
        ) as CoreConnectionProfile & { read_only: boolean }),
        observation: core.observation?.(status.id) ?? null,
      };
    });
  }

  private core(): CoreConnectionSupport<CoreRuntime> {
    if (!this.args.core)
      throw new Error("herdr-core connections are not available");
    return this.args.core;
  }

  private managerOf(connectionId: string): RoutedManager {
    const entry = this.profiles.get(connectionId);
    return entry && isCoreProfile(entry.profile)
      ? this.core().manager
      : this.args.manager;
  }

  private hasRuntime(connectionId: string): boolean {
    return (
      this.managerOf(connectionId).has(connectionId) ||
      (this.args.core?.manager.has(connectionId) ?? false)
    );
  }

  private registerRuntime(profile: ManagedConnectionProfile): void {
    const identity = connectionIdentityForProfile(profile);
    if (isCoreProfile(profile)) {
      const core = this.core();
      core.manager.register({
        identity,
        createRuntime: core.createRuntime(profile),
      });
    } else {
      this.args.manager.register({
        identity,
        createRuntime: this.args.createRuntime(profile as TuiManagedProfile),
      });
    }
  }

  private replaceRuntime(profile: ConnectionProfile): Promise<void> {
    const identity = connectionIdentityForProfile(profile);
    if (isCoreProfile(profile)) {
      const core = this.core();
      return core.manager.replace({
        identity,
        createRuntime: core.createRuntime(profile),
      });
    }
    return this.args.manager.replace({
      identity,
      createRuntime: this.args.createRuntime(profile),
    });
  }

  willRetry(connectionId: string, error: unknown): boolean {
    const entry = this.profiles.get(connectionId);
    const state = this.retryStates.get(connectionId);
    return Boolean(
      !this.supervisionStopped &&
        entry &&
        state?.enabled &&
        state.attempt < this.retryMaxAttempts &&
        ((entry.profile.type === "ssh" &&
          error instanceof SshTunnelError &&
          error.retryable) ||
          (error instanceof ConnectionProbeError && error.retryable) ||
          (isCoreProfile(entry.profile)
            ? (error as { retryable?: unknown } | null)?.retryable === true ||
              (entry.profile.type === "ssh" &&
                error instanceof SshTunnelError &&
                error.retryable)
            : entry.profile.type === "local" &&
              retryableLocalSocketError(error))),
    );
  }

  runtimeFailed(connectionId: string, error: unknown): void {
    this.scheduleRetry(connectionId, error);
    void this.managerOf(connectionId).retireFailedRuntime(connectionId);
  }

  stopSupervision(): void {
    this.supervisionStopped = true;
    this.hosts.stop();
    for (const connectionId of this.retryStates.keys()) {
      this.disableRetry(connectionId);
    }
  }

  async startConfigured(): Promise<void> {
    if (this.args.discoverHost && !this.args.bootstrap.explicitStartupOverride)
      return this.hosts.startConfigured();
    const targets = new Set<string>([this.args.manager.defaultId()]);
    for (const { profile } of this.profiles.values()) {
      if (profile.auto_connect) targets.add(profile.id);
    }
    await Promise.all(
      Array.from(targets, (connectionId) =>
        this.startManaged(connectionId, true).catch(() => undefined),
      ),
    );
  }

  create(
    value: unknown,
    options: { makeDefault?: boolean; keepLocalDefault?: boolean } = {},
  ): Promise<ConnectionProfileListItem | CoreConnectionListItem> {
    return this.mutate(async () => {
      this.requireWritableRegistryState();
      if (options.makeDefault && this.args.bootstrap.explicitStartupOverride)
        throw new ProfileInputError(
          "explicit CLI/environment connection remains the process default",
        );
      const profile = validateProfileInput(value);
      if (this.profiles.has(profile.id) || this.hasRuntime(profile.id)) {
        throw new ProfileInputError(`connection already exists: ${profile.id}`);
      }
      const previousRegistry = this.registry;
      const migration =
        !previousRegistry && !this.args.bootstrap.explicitStartupOverride;
      // The first persisted profile retires the synthetic legacy default.
      // Keep the local server as a writable Local profile with the same
      // socket paths, and as the default over a first herdr-core profile,
      // unless this computer has no Herdr TUI: then core is alone (#935).
      const coreOnly =
        migration && isCoreProfile(profile) && this.args.noHerdrTui?.();
      const migrationSeed =
        migration && !coreOnly
          ? localMigrationSeed(this.args.bootstrap, profile.id)
          : null;
      const keepDefault =
        (isCoreProfile(profile) || options.keepLocalDefault) &&
        migration &&
        !coreOnly &&
        !options.makeDefault;
      const defaultId = keepDefault ? migrationSeed?.id : profile.id;
      if (!defaultId)
        throw new ProfileInputError(
          "add a Herdr connection before a herdr-core one",
        );
      const nextRegistry: PersistedConnectionRegistry = previousRegistry
        ? {
            ...previousRegistry,
            version: CONNECTION_PROFILE_FILE_VERSION,
            default_connection_id: options.makeDefault
              ? profile.id
              : previousRegistry.default_connection_id,
            profiles: [...previousRegistry.profiles, profile],
          }
        : {
            version: CONNECTION_PROFILE_FILE_VERSION,
            default_connection_id: defaultId,
            profiles: migrationSeed ? [migrationSeed, profile] : [profile],
          };
      await this.args.store.save(nextRegistry);
      try {
        if (migrationSeed) this.registerRuntime(migrationSeed);
        this.registerRuntime(profile);
      } catch (error) {
        try {
          if (migrationSeed && this.args.manager.has(migrationSeed.id)) {
            await this.args.manager.unregister(migrationSeed.id);
          }
          if (isCoreProfile(profile) && this.args.core?.manager.has(profile.id))
            await this.args.core.manager.unregister(profile.id);
          if (previousRegistry) await this.args.store.save(previousRegistry);
          else await this.args.store.clear();
        } catch (rollbackError) {
          this.disableMutationsAfterRollbackFailure();
          throw new AggregateError(
            [error, rollbackError],
            "connection creation failed and persistence rollback was incomplete",
            { cause: rollbackError },
          );
        }
        throw error;
      }
      if (migrationSeed) {
        this.profiles.set(migrationSeed.id, {
          profile: migrationSeed,
          readOnly: false,
        });
      }
      this.profiles.set(profile.id, { profile, readOnly: false });
      this.registry = nextRegistry;
      if (migration || options.makeDefault)
        this.args.manager.setDefault(defaultId, {
          external: isCoreProfile(profile) && defaultId === profile.id,
        });
      if (migration) {
        this.disableRetry(STARTUP_DEFAULT_CONNECTION_ID);
        await this.args.manager.unregister(STARTUP_DEFAULT_CONNECTION_ID);
        this.profiles.delete(STARTUP_DEFAULT_CONNECTION_ID);
      }
      if (migrationSeed) {
        await this.startManaged(migrationSeed.id, true).catch(() => undefined);
      }
      if (
        profile.auto_connect ||
        this.args.manager.defaultId() === profile.id
      ) {
        await this.startManaged(profile.id, true).catch(() => undefined);
      }
      return this.item(profile.id);
    });
  }

  update(
    connectionId: unknown,
    value: unknown,
  ): Promise<ConnectionProfileListItem | CoreConnectionListItem> {
    return this.mutate(async () => {
      this.requireWritableRegistryState();
      if (typeof connectionId !== "string")
        throw new Error("connection id is required");
      const current = this.requireWritableProfile(connectionId);
      const replacement = validateConnectionProfile(value);
      if (replacement.id !== connectionId) {
        throw new Error("connection profile id cannot be changed");
      }
      if (isCoreProfile(replacement) !== isCoreProfile(current))
        throw new Error(
          "a connection's runtime cannot be changed; add another connection",
        );
      const registry = this.requireRegistry();
      const previousState =
        this.managerOf(connectionId).status(connectionId).state;
      const wasReady = previousState === "ready";
      const shouldRemainConnected =
        wasReady ||
        previousState === "connecting" ||
        previousState === "reconnecting" ||
        this.retryStates.get(connectionId)?.enabled === true;
      if (wasReady) await this.test(replacement);
      const nextRegistry: PersistedConnectionRegistry = {
        ...registry,
        version: CONNECTION_PROFILE_FILE_VERSION,
        profiles: registry.profiles.map((profile) =>
          profile.id === connectionId ? replacement : profile,
        ),
        ...(registry.hosts
          ? { hosts: forgetHostRuntime(registry.hosts, connectionId) }
          : {}),
      };
      await this.args.store.save(nextRegistry);
      this.disableRetry(connectionId);
      try {
        await this.replaceRuntime(replacement);
        this.profiles.set(connectionId, {
          profile: replacement,
          readOnly: false,
        });
        this.registry = nextRegistry;
        if (
          shouldRemainConnected ||
          replacement.auto_connect ||
          this.args.manager.defaultId() === connectionId
        ) {
          await this.startManaged(connectionId, true);
        }
      } catch (error) {
        this.disableRetry(connectionId);
        const rollbackFailures: unknown[] = [];
        let persistenceRolledBack = true;
        try {
          await this.args.store.save(registry);
        } catch (rollbackError) {
          persistenceRolledBack = false;
          rollbackFailures.push(rollbackError);
          this.disableMutationsAfterRollbackFailure();
        }
        if (persistenceRolledBack) {
          this.profiles.set(connectionId, {
            profile: current,
            readOnly: false,
          });
          this.registry = registry;
          try {
            await this.replaceRuntime(current);
            if (shouldRemainConnected) {
              await this.startManaged(connectionId, true);
            }
          } catch (rollbackError) {
            rollbackFailures.push(rollbackError);
          }
        } else {
          // The replacement was durably written before runtime replacement
          // began. If writing the old registry back fails, keep memory aligned
          // with that last known durable value and retire all affected routing.
          this.profiles.set(connectionId, {
            profile: replacement,
            readOnly: false,
          });
          this.registry = nextRegistry;
          try {
            await this.managerOf(connectionId).stop(connectionId);
          } catch (rollbackError) {
            rollbackFailures.push(rollbackError);
          }
        }
        if (rollbackFailures.length > 0) {
          throw new AggregateError(
            [error, ...rollbackFailures],
            "connection update failed and rollback was incomplete",
            { cause: error },
          );
        }
        throw error;
      }
      return this.item(connectionId);
    });
  }

  remove(connectionId: unknown): Promise<{ ok: true }> {
    return this.mutate(async () => {
      if (typeof connectionId !== "string")
        throw new ProfileInputError("connection id is required");
      return this.removeProfiles([connectionId]);
    });
  }

  private async removeProfiles(
    connectionIds: string[],
    removeHostId?: string,
  ): Promise<{ ok: true }> {
    this.requireWritableRegistryState();
    const removed = connectionIds.map((id) => ({
      profile: this.requireWritableProfile(id),
      recover:
        ["ready", "connecting", "reconnecting"].includes(
          this.managerOf(id).status(id).state,
        ) || this.retryStates.get(id)?.enabled === true,
    }));
    if (connectionIds.includes(this.args.manager.defaultId()))
      throw new ProfileInputError("cannot remove the default connection");
    const registry = this.requireRegistry();
    const profiles = registry.profiles.filter(
      (profile) => !connectionIds.includes(profile.id),
    );
    let hosts = registry.hosts;
    for (const id of connectionIds) hosts = forgetHostRuntime(hosts, id);
    if (removeHostId) hosts = hosts?.filter((host) => host.id !== removeHostId);
    const next: PersistedConnectionRegistry | null =
      profiles.length || hosts?.length
        ? {
            ...registry,
            version: CONNECTION_PROFILE_FILE_VERSION,
            profiles,
            ...(hosts ? { hosts } : {}),
            default_connection_id: profiles.some(
              (profile) => profile.id === registry.default_connection_id,
            )
              ? registry.default_connection_id
              : (profiles[0]?.id ?? STARTUP_DEFAULT_CONNECTION_ID),
          }
        : null;
    if (!next && !this.args.bootstrap.explicitStartupOverride)
      throw new ProfileInputError(
        "cannot remove the last persisted connection",
      );
    const retired: typeof removed = [];
    try {
      for (const entry of removed) {
        this.disableRetry(entry.profile.id);
        await this.managerOf(entry.profile.id).unregister(entry.profile.id);
        retired.push(entry);
      }
      if (next) await this.args.store.save(next);
      else await this.args.store.clear();
    } catch (error) {
      const failures: unknown[] = [];
      for (const entry of retired) {
        try {
          this.registerRuntime(entry.profile);
          if (entry.recover) await this.startManaged(entry.profile.id, true);
        } catch (recoveryError) {
          failures.push(recoveryError);
        }
      }
      if (failures.length)
        throw new AggregateError(
          [error, ...failures],
          "connection removal failed and runtime recovery was incomplete",
          { cause: error },
        );
      throw error;
    }
    for (const id of connectionIds) this.profiles.delete(id);
    this.registry = next;
    return { ok: true };
  }

  setDefault(
    connectionId: unknown,
  ): Promise<{ ok: true; default_connection_id: string }> {
    return this.mutate(async () => {
      this.requireWritableRegistryState();
      if (typeof connectionId !== "string")
        throw new ProfileInputError("connection id is required");
      if (this.args.bootstrap.explicitStartupOverride) {
        throw new ProfileInputError(
          "explicit CLI/environment connection remains the process default",
        );
      }
      const core = isCoreProfile(this.requireWritableProfile(connectionId));
      const registry = this.requireRegistry();
      const nextRegistry: PersistedConnectionRegistry = {
        ...registry,
        version: CONNECTION_PROFILE_FILE_VERSION,
        default_connection_id: connectionId,
      };
      await this.args.store.save(nextRegistry);
      try {
        this.args.manager.setDefault(connectionId, { external: core });
      } catch (error) {
        try {
          await this.args.store.save(registry);
        } catch (rollbackError) {
          this.disableMutationsAfterRollbackFailure();
          throw new AggregateError(
            [error, rollbackError],
            "default connection update failed and persistence rollback was incomplete",
            { cause: rollbackError },
          );
        }
        throw error;
      }
      this.registry = nextRegistry;
      return { ok: true, default_connection_id: connectionId };
    });
  }

  connect(
    connectionId: unknown,
  ): Promise<ConnectionProfileListItem | CoreConnectionListItem> {
    if (
      this.args.discoverHost &&
      !this.args.bootstrap.explicitStartupOverride &&
      typeof connectionId === "string"
    ) {
      return this.hosts
        .connectRuntime(connectionId)
        .then(() => this.item(connectionId));
    }
    return this.mutate(async () => {
      if (typeof connectionId !== "string")
        throw new Error("connection id is required");
      this.requireProfile(connectionId);
      await this.startManaged(connectionId, true);
      return this.item(connectionId);
    });
  }

  disconnect(
    connectionId: unknown,
  ): Promise<ConnectionProfileListItem | CoreConnectionListItem> {
    return this.mutate(async () => {
      if (typeof connectionId !== "string")
        throw new Error("connection id is required");
      this.requireProfile(connectionId);
      this.disableRetry(connectionId);
      await this.managerOf(connectionId).stop(connectionId);
      return this.item(connectionId);
    });
  }

  async test(
    value: unknown,
  ): Promise<{ ok: true; version: string | null; protocol: number }> {
    let profile: ManagedConnectionProfile;
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as { id?: unknown }).id === "string" &&
      Object.keys(value).length === 1
    ) {
      profile = this.requireProfile((value as { id: string }).id).profile;
    } else {
      profile = validateConnectionProfile(value);
    }
    if (isCoreProfile(profile)) {
      const test = this.core().test;
      if (!test) throw new Error("herdr-core connections cannot be tested");
      return test(profile);
    }
    return (this.args.testProfile ?? testConnectionProfile)(profile);
  }

  private retryState(connectionId: string): RetryState {
    let state = this.retryStates.get(connectionId);
    if (!state) {
      state = {
        wanted: false,
        enabled: false,
        attempt: 0,
        token: 0,
        retryTimer: null,
        stableTimer: null,
      };
      this.retryStates.set(connectionId, state);
    }
    return state;
  }

  private enableRetry(connectionId: string): void {
    this.requireProfile(connectionId);
    if (this.supervisionStopped) return;
    const state = this.retryState(connectionId);
    state.token += 1;
    state.retryTimer?.cancel();
    state.stableTimer?.cancel();
    state.retryTimer = null;
    state.stableTimer = null;
    state.attempt = 0;
    state.enabled = true;
    state.wanted = true;
  }

  private disableRetry(connectionId: string, preserveIntent = false): void {
    const state = this.retryStates.get(connectionId);
    if (!state) return;
    state.enabled = false;
    if (!preserveIntent) state.wanted = false;
    state.token += 1;
    state.retryTimer?.cancel();
    state.stableTimer?.cancel();
    state.retryTimer = null;
    state.stableTimer = null;
  }

  private markStable(connectionId: string): void {
    const state = this.retryStates.get(connectionId);
    if (!state?.enabled || state.attempt === 0) return;
    state.stableTimer?.cancel();
    const token = state.token;
    state.stableTimer = this.retrySchedule(() => {
      if (!state.enabled || state.token !== token) return;
      state.attempt = 0;
      state.stableTimer = null;
    }, this.retryStableResetMs);
  }

  private async startManaged(
    connectionId: string,
    resetRetry: boolean,
  ): Promise<void> {
    this.requireProfile(connectionId);
    if (resetRetry) {
      this.enableRetry(connectionId);
    }
    const token = this.retryStates.get(connectionId)?.token;
    const generationBeforeStart =
      this.managerOf(connectionId).status(connectionId).generation;
    try {
      await this.managerOf(connectionId).start(connectionId);
      if (this.managerOf(connectionId).status(connectionId).state === "ready") {
        this.markStable(connectionId);
      }
    } catch (error) {
      // A disconnect, replacement or shutdown can finish before a rejected
      // startup settles. Its old continuation must not schedule new work.
      if (
        this.retryStates.get(connectionId)?.token !== token ||
        !this.managerOf(connectionId).has(connectionId)
      )
        throw error;
      // A transport can report its own exit while startup is still awaiting a
      // functional socket probe. That callback advances the generation and
      // marks reconnecting before it queues a retry. Use that durable manager
      // state rather than timer timing to avoid consuming a second attempt.
      const status = this.managerOf(connectionId).status(connectionId);
      const transportAlreadyReported =
        status.state === "reconnecting" &&
        status.generation > generationBeforeStart;
      if (!transportAlreadyReported) this.scheduleRetry(connectionId, error);
      throw error;
    }
  }

  private scheduleRetry(connectionId: string, error: unknown): boolean {
    if (!this.willRetry(connectionId, error)) return false;
    const state = this.retryState(connectionId);
    state.retryTimer?.cancel();
    state.stableTimer?.cancel();
    state.retryTimer = null;
    state.stableTimer = null;
    if (!this.managerOf(connectionId).markReconnecting(connectionId, error))
      return false;

    const windowMs = Math.min(
      this.retryMaxDelayMs,
      this.retryBaseDelayMs * 2 ** state.attempt,
    );
    const random = Math.max(0, Math.min(1, this.retryRandom()));
    const delayMs = Math.floor(windowMs / 2 + random * (windowMs / 2));
    state.attempt += 1;
    const token = state.token;
    const generation =
      this.managerOf(connectionId).status(connectionId).generation;
    state.retryTimer = this.retrySchedule(() => {
      if (!this.retryCurrent(connectionId, state, token, generation)) return;
      state.retryTimer = null;
      void this.runScheduledRetry(connectionId, state, token, generation);
    }, delayMs);
    return true;
  }

  private async runScheduledRetry(
    connectionId: string,
    state: RetryState,
    token: number,
    generation: number,
  ): Promise<void> {
    try {
      // A timer may fire before the failed runtime has finished cleanup. Wait
      // here, then re-check the retry token, instead of queueing an
      // uncancellable manager.start() behind stopTask.
      await this.managerOf(connectionId).retireFailedRuntime(connectionId);
    } catch (cleanupError) {
      if (this.retryCurrent(connectionId, state, token, generation)) {
        this.scheduleRetry(connectionId, cleanupError);
      }
      return;
    }
    if (!this.retryCurrent(connectionId, state, token, generation)) return;
    // startManaged owns failure classification and generation-based duplicate
    // suppression for both initial and timer-triggered startups.
    await this.startManaged(connectionId, false).catch(() => undefined);
    if (
      this.args.discoverHost &&
      !this.args.bootstrap.explicitStartupOverride &&
      this.managerOf(connectionId).has(connectionId)
    ) {
      const ready = this.managerOf(connectionId).status(connectionId);
      if (ready.state === "ready")
        this.hosts.reconnected(
          hostId(this.requireProfile(connectionId).profile),
          () =>
            !this.supervisionStopped &&
            state.enabled &&
            state.token === token &&
            this.managerOf(connectionId).has(connectionId) &&
            this.managerOf(connectionId).status(connectionId).state ===
              "ready" &&
            this.managerOf(connectionId).status(connectionId).generation ===
              ready.generation,
        );
    }
  }

  private retryCurrent(
    connectionId: string,
    state: RetryState,
    token: number,
    generation: number,
  ): boolean {
    return (
      state.enabled &&
      state.token === token &&
      this.managerOf(connectionId).has(connectionId) &&
      this.managerOf(connectionId).status(connectionId).generation ===
        generation &&
      this.managerOf(connectionId).status(connectionId).state === "reconnecting"
    );
  }

  private item(
    connectionId: string,
  ): ConnectionProfileListItem | CoreConnectionListItem {
    const status = this.managerOf(connectionId).status(connectionId);
    const entry = this.requireProfile(connectionId);
    const profile = publicConnectionProfile(entry.profile, entry.readOnly);
    if (isCoreProfile(profile))
      return {
        ...status,
        ...profile,
        observation: this.args.core?.observation?.(connectionId) ?? null,
      };
    return { ...status, ...profile };
  }

  private requireProfile(connectionId: string) {
    const entry = this.profiles.get(connectionId);
    if (!entry)
      throw new ProfileInputError(`unknown connection: ${connectionId}`);
    return entry;
  }

  private requireWritableProfile(connectionId: string): ConnectionProfile {
    const entry = this.requireProfile(connectionId);
    if (entry.readOnly)
      throw new ProfileInputError("connection profile is read-only");
    return entry.profile as ConnectionProfile;
  }

  private requireRegistry(): PersistedConnectionRegistry {
    if (!this.registry) throw new Error("no persisted connection registry");
    return this.registry;
  }

  private requireWritableRegistryState(): void {
    if (this.mutationDisabledError) {
      throw new Error(this.mutationDisabledError);
    }
  }

  private disableMutationsAfterRollbackFailure(): void {
    this.mutationDisabledError =
      "connection profile mutations are disabled because persistence rollback failed; restart the bridge and repair the registry before making further changes";
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.mutationQueue.then(async () => {
      const result = await operation();
      this.args.changed?.();
      return result;
    });
    this.mutationQueue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }
}
