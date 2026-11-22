import {
  discoverHost,
  HostDiscoveryError,
  RUNTIME_PROVIDERS,
  type DiscoverHost,
  type DiscoveredRuntime,
} from "./host-discovery";
import {
  hostId,
  migrateHosts,
  runtimeKind,
  validateHostProfile,
  type HostProfile,
  type WorldHost,
} from "./hosts";
import { sanitizeConnectionError } from "./manager";
import type { ConnectionProfile } from "./profiles";
import { ProfileInputError } from "./profile-validation";
import type { ConnectionStatus } from "./types";

export type HostServicePorts = {
  profiles(): ConnectionProfile[];
  saved(): readonly HostProfile[];
  hasLegacyRegistry?(): boolean;
  status(id: string): ConnectionStatus;
  defaultId(): string;
  readOnly?(id: string): boolean;
  drop?(hostId: string, connectionIds: string[]): Promise<{ ok: true }>;
  /** Uses the profile service's same serialized admission queue. */
  mutate<T>(operation: () => Promise<T>): Promise<T>;
  persist(hosts: HostProfile[], additions: ConnectionProfile[]): Promise<void>;
  wantsConnection?(id: string): boolean;
  start(id: string, resetRetry?: boolean): Promise<void>;
  stop(id: string, preserveIntent?: boolean): Promise<void>;
  discover?: DiscoverHost;
};

/** Host ownership groups runtimes; it never issues a downstream operation. */
export class HostConnectionService {
  private readonly errors = new Map<string, string>();
  private readonly observed = new Map<string, HostProfile["discovered"]>();
  private stopped = false;
  private readonly reconnecting = new Set<string>();

  constructor(private readonly ports: HostServicePorts) {}

  catalogue(): HostProfile[] {
    const profiles = this.ports.profiles();
    const owners = new Map(
      profiles.map((profile) => [profile.id, hostId(profile)]),
    );
    const hosts = migrateHosts(profiles, this.ports.saved());
    const ids = new Set(hosts.map((host) => host.id));
    for (const id of this.observed.keys())
      if (!ids.has(id)) this.observed.delete(id);
    return hosts.map((host) => ({
      ...host,
      ...(host.discovered || !this.observed.has(host.id)
        ? {}
        : {
            discovered: structuredClone(
              this.observed
                .get(host.id)
                ?.filter(
                  (record) => owners.get(record.connection_id) === host.id,
                ),
            ),
          }),
    }));
  }

  list(): WorldHost[] {
    return this.catalogue().map((host) => {
      const profiles = this.ports
        .profiles()
        .filter((profile) => hostId(profile) === host.id);
      const runtimes = profiles.map((profile) => {
        const status = this.ports.status(profile.id);
        const found = host.discovered?.find(
          (record) => record.connection_id === profile.id,
        );
        return {
          connection_id: profile.id,
          kind: found?.kind ?? runtimeKind(profile),
          version: found?.version ?? null,
          installed: found?.present ?? true,
          state: found?.present === false ? ("absent" as const) : status.state,
          generation: status.generation,
          ...(status.error ? { error: status.error } : {}),
        };
      });
      const installed = runtimes.filter((runtime) => runtime.installed);
      const ready = installed.filter((runtime) => runtime.state === "ready");
      const error = this.errors.get(host.id);
      const discovery = error
        ? "error"
        : host.discovered
          ? "complete"
          : "pending";
      const state = ready.length
        ? ready.length === runtimes.length && !error
          ? "ready"
          : "degraded"
        : error
          ? "unavailable"
          : !installed.length && discovery === "complete"
            ? "empty"
            : installed.some((runtime) => runtime.state !== "disconnected")
              ? "unavailable"
              : "disconnected";
      return {
        host_id: host.id,
        ...(host.preview_fixture
          ? { preview_fixture: host.preview_fixture }
          : {}),
        label: host.label,
        type: host.type,
        auto_connect: host.auto_connect,
        ...(host.ssh_destination
          ? { ssh_destination: host.ssh_destination }
          : {}),
        ...(host.remote_platform
          ? { remote_platform: host.remote_platform }
          : {}),
        connection_ids: profiles.map((profile) => profile.id),
        state,
        discovery,
        ...(error ? { discovery_error: error } : {}),
        runtimes,
        installable_runtimes:
          state === "empty"
            ? RUNTIME_PROVIDERS.map(({ kind, label }) => ({ kind, label }))
            : [],
      };
    });
  }

  /** Additional runtime choices belong to Integrations, even on a healthy host. */
  integrations() {
    return this.list().map((host) => ({
      host_id: host.host_id,
      label: host.label,
      runtimes: host.runtimes,
      available_runtimes: RUNTIME_PROVIDERS.filter(
        (provider) =>
          !host.runtimes.some(
            (runtime) => runtime.kind === provider.kind && runtime.installed,
          ),
      ).map(({ kind, label }) => ({ kind, label })),
    }));
  }

  add(value: unknown): Promise<WorldHost> {
    return this.ports.mutate(async () => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new ProfileInputError("host is required");
      const input = value as Record<string, unknown>;
      if (
        Object.keys(input).some(
          (key) =>
            ![
              "type",
              "ssh_destination",
              "remote_platform",
              "label",
              "auto_connect",
              "preview_fixture",
            ].includes(key),
        )
      )
        throw new ProfileInputError(
          "adding a host accepts no runtime settings",
        );
      let host: HostProfile;
      try {
        const target = {
          type: input.type,
          ssh_destination: input.ssh_destination,
        } as HostProfile;
        host = validateHostProfile({
          ...input,
          id: hostId(target),
          label:
            input.label ??
            (input.type === "local"
              ? "This computer"
              : String(input.ssh_destination).slice(0, 80)),
          auto_connect: input.auto_connect ?? true,
        });
      } catch (error) {
        throw new ProfileInputError((error as Error).message);
      }
      if (this.catalogue().some((entry) => entry.id === host.id)) {
        if (host.type === "local") return this.discoverAndConnect(host.id);
        throw new ProfileInputError("host already exists");
      }
      await this.ports.persist([...this.catalogue(), host], []);
      return this.discoverAndConnect(host.id);
    });
  }

  connect(id: unknown): Promise<WorldHost> {
    return this.ports.mutate(() =>
      this.discoverAndConnect(this.require(id).id),
    );
  }

  /** Legacy Connect owns only its named runtime; discovery preserves siblings' intent. */
  connectRuntime(id: string): Promise<void> {
    return this.ports.mutate(async () => {
      if (this.stopped) throw new Error("host discovery is stopping");
      const profile = this.ports
        .profiles()
        .find((profile) => profile.id === id);
      if (!profile) throw new ProfileInputError("unknown connection");
      await this.ports.start(id);
      await this.discoverAndConnect(
        hostId(profile),
        (entry) => this.ports.wantsConnection?.(entry.id) ?? false,
        new Set([id]),
      );
    });
  }

  disconnect(id: unknown): Promise<WorldHost> {
    return this.ports.mutate(async () => {
      const host = this.require(id);
      for (const profile of this.ports
        .profiles()
        .filter((profile) => hostId(profile) === host.id))
        await this.ports.stop(profile.id);
      return this.item(host.id);
    });
  }

  remove(id: unknown): Promise<{ ok: true }> {
    return this.ports.mutate(async () => {
      const host = this.require(id);
      if (!this.ports.drop) throw new Error("host removal is unavailable");
      const result = await this.ports.drop(
        host.id,
        this.ports
          .profiles()
          .filter((profile) => hostId(profile) === host.id)
          .map((profile) => profile.id),
      );
      this.errors.delete(host.id);
      this.observed.delete(host.id);
      return result;
    });
  }

  async startConfigured(): Promise<void> {
    if (this.stopped) return;
    const profiles = this.ports.profiles();
    const targets = new Set(
      profiles
        .filter(
          (profile) =>
            profile.auto_connect || profile.id === this.ports.defaultId(),
        )
        .map((profile) => profile.id),
    );
    // Start saved targets independently before any slow probe or catalogue write.
    // Host discovery still commits through the shared mutation queue.
    await Promise.allSettled([...targets].map((id) => this.ports.start(id)));
    for (const host of this.catalogue()) {
      if (this.stopped) return;
      if (
        !host.auto_connect &&
        !profiles.some(
          (profile) => hostId(profile) === host.id && targets.has(profile.id),
        )
      )
        continue;
      await this.ports
        .mutate(() =>
          this.discoverAndConnect(
            host.id,
            (profile) =>
              targets.has(profile.id) &&
              (this.ports.wantsConnection?.(profile.id) ?? true),
            new Set(targets),
            true,
          ),
        )
        .catch((error) => {
          this.errors.set(host.id, sanitizeConnectionError(error));
        });
    }
  }

  stop(): void {
    this.stopped = true;
  }

  /** Reconnect is an event, not a polling loop; old retry intent cannot revive a host. */
  reconnected(id: string, current: () => boolean): void {
    if (this.stopped || this.reconnecting.has(id)) return;
    this.reconnecting.add(id);
    void this.ports
      .mutate(async () => {
        if (!this.stopped && current())
          await this.discoverAndConnect(
            id,
            (profile) => this.ports.wantsConnection?.(profile.id) ?? false,
            new Set(),
            true,
          );
      })
      .catch(() => undefined)
      .finally(() => this.reconnecting.delete(id));
  }

  private async discoverAndConnect(
    id: string,
    shouldStartExisting: (profile: ConnectionProfile) => boolean = () => true,
    attempted = new Set<string>(),
    automatic = false,
  ): Promise<WorldHost> {
    if (this.stopped) throw new Error("host discovery is stopping");
    const host = this.require(id);
    const profiles = this.ports
      .profiles()
      .filter((profile) => hostId(profile) === id);
    if (profiles.some((profile) => this.ports.readOnly?.(profile.id)))
      throw new ProfileInputError(
        "explicit startup settings pin this runtime; manage saved hosts separately",
      );
    // Saved endpoints can be live even when their executable is off PATH.
    // Admit each through its original transport, never another runtime's probe.
    await Promise.allSettled(
      profiles
        .filter(
          (profile) =>
            shouldStartExisting(profile) && !attempted.has(profile.id),
        )
        .map((profile) => {
          attempted.add(profile.id);
          return this.ports.start(profile.id, false);
        }),
    );
    if (this.stopped) throw new Error("host discovery is stopping");
    let found: DiscoveredRuntime[];
    let checkedKinds: string[] | undefined;
    let discoveryError: string | undefined;
    try {
      found =
        host.preview_fixture === "empty"
          ? []
          : await (this.ports.discover ?? discoverHost)(host, profiles);
    } catch (error) {
      if (error instanceof HostDiscoveryError) {
        found = error.found;
        checkedKinds = error.checkedKinds;
        discoveryError = sanitizeConnectionError(error);
      } else {
        this.errors.set(id, sanitizeConnectionError(error));
        return this.item(id);
      }
    }
    if (this.stopped) throw new Error("host discovery is stopping");
    const ids = new Set<string>();
    for (const { profile } of found) {
      if (
        hostId(profile) !== id ||
        ids.has(profile.id) ||
        this.ports
          .profiles()
          .some(
            (entry) =>
              entry.id === profile.id &&
              (hostId(entry) !== id ||
                runtimeKind(entry) !== runtimeKind(profile)),
          )
      )
        throw new Error("discovered runtime ownership mismatch");
      ids.add(profile.id);
    }
    // A failed provider says nothing about disappearance. Keep its exact
    // historical identities, and still connect newly found healthy siblings.
    for (const profile of profiles) {
      const previous = host.discovered?.find(
        (record) => record.connection_id === profile.id,
      );
      if (
        !ids.has(profile.id) &&
        (this.ports.status(profile.id).state === "ready" ||
          (checkedKinds &&
            !checkedKinds.includes(previous?.kind ?? runtimeKind(profile)) &&
            previous?.present !== false))
      ) {
        ids.add(profile.id);
        found.push({
          profile,
          version: previous?.version ?? null,
          kind: previous?.kind,
        });
      }
    }
    const additions = found
      .filter(
        ({ profile }) => !profiles.some((entry) => entry.id === profile.id),
      )
      .map(({ profile }) => profile);
    const replacement: HostProfile = {
      ...host,
      discovered: [
        ...profiles
          .filter((profile) => !ids.has(profile.id))
          .map((profile) => ({
            ...host.discovered?.find(
              (record) => record.connection_id === profile.id,
            ),
            connection_id: profile.id,
            present: false,
            version:
              host.discovered?.find(
                (record) => record.connection_id === profile.id,
              )?.version ?? null,
          })),
        ...found.map(({ profile, version, kind }) => ({
          connection_id: profile.id,
          present: true,
          version,
          ...(kind ? { kind } : {}),
        })),
      ],
    };
    if (automatic && !additions.length && this.ports.hasLegacyRegistry?.()) {
      // Observing existing runtimes must not rewrite a legacy registry on
      // startup/reconnect. Keep discovery visible in memory; an explicit host
      // edit or a newly discovered runtime commits the schema migration.
      this.observed.set(id, replacement.discovered);
    } else {
      await this.ports.persist(
        this.catalogue().map((entry) =>
          entry.id === id ? replacement : entry,
        ),
        additions,
      );
      this.observed.clear();
    }
    if (discoveryError) this.errors.set(id, discoveryError);
    else this.errors.delete(id);
    await Promise.allSettled(
      profiles
        .filter((profile) => !ids.has(profile.id))
        .map((profile) => this.ports.stop(profile.id, true)),
    );
    if (!this.stopped)
      await Promise.allSettled(
        found
          .filter(
            ({ profile }) =>
              !attempted.has(profile.id) &&
              (!profiles.some((entry) => entry.id === profile.id) ||
                shouldStartExisting(profile)),
          )
          .map(({ profile }) => this.ports.start(profile.id, false)),
      );
    return this.item(id);
  }

  private require(id: unknown): HostProfile {
    const host = this.catalogue().find(
      (host) =>
        host.id === id ||
        (typeof id === "string" && host.ssh_destination === id),
    );
    if (!host) throw new ProfileInputError("unknown host");
    return host;
  }
  private item(id: string): WorldHost {
    return this.list().find((host) => host.host_id === id)!;
  }
}
