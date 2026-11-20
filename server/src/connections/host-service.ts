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
  status(id: string): ConnectionStatus;
  defaultId(): string;
  readOnly?(id: string): boolean;
  drop?(hostId: string, connectionIds: string[]): Promise<{ ok: true }>;
  /** Uses the profile service's same serialized admission queue. */
  mutate<T>(operation: () => Promise<T>): Promise<T>;
  persist(hosts: HostProfile[], additions: ConnectionProfile[]): Promise<void>;
  start(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  discover?: DiscoverHost;
};

/** Host ownership groups runtimes; it never issues a downstream operation. */
export class HostConnectionService {
  private readonly errors = new Map<string, string>();
  private stopped = false;
  private readonly reconnecting = new Set<string>();

  constructor(private readonly ports: HostServicePorts) {}

  catalogue(): HostProfile[] {
    return migrateHosts(this.ports.profiles(), this.ports.saved());
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
      return result;
    });
  }

  async startConfigured(): Promise<void> {
    // A round is bounded and serialized with mutations; transport starts within
    // each host settle independently, so one failed runtime cannot hide another.
    for (const host of this.catalogue()) {
      if (
        host.auto_connect ||
        this.ports
          .profiles()
          .some(
            (profile) =>
              profile.id === this.ports.defaultId() &&
              hostId(profile) === host.id,
          )
      )
        await this.connect(host.id);
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
        if (!this.stopped && current()) await this.discoverAndConnect(id);
      })
      .catch(() => undefined)
      .finally(() => this.reconnecting.delete(id));
  }

  private async discoverAndConnect(id: string): Promise<WorldHost> {
    if (this.stopped) throw new Error("host discovery is stopping");
    const host = this.require(id);
    const profiles = this.ports
      .profiles()
      .filter((profile) => hostId(profile) === id);
    if (profiles.some((profile) => this.ports.readOnly?.(profile.id)))
      throw new ProfileInputError(
        "explicit startup settings pin this runtime; manage saved hosts separately",
      );
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
        // Existing connections still reconnect by their own immutable identities.
        if (!this.stopped)
          await Promise.allSettled(
            profiles
              .filter(
                (profile) =>
                  host.discovered?.find(
                    (record) => record.connection_id === profile.id,
                  )?.present !== false,
              )
              .map((profile) => this.ports.start(profile.id)),
          );
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
        checkedKinds &&
        !checkedKinds.includes(previous?.kind ?? runtimeKind(profile)) &&
        previous?.present !== false
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
    await this.ports.persist(
      this.catalogue().map((entry) => (entry.id === id ? replacement : entry)),
      additions,
    );
    if (discoveryError) this.errors.set(id, discoveryError);
    else this.errors.delete(id);
    await Promise.allSettled(
      profiles
        .filter((profile) => !ids.has(profile.id))
        .map((profile) => this.ports.stop(profile.id)),
    );
    if (!this.stopped)
      await Promise.allSettled(
        found.map(({ profile }) => this.ports.start(profile.id)),
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
