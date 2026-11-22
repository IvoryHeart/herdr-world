import { randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";
import { hostStopByHand } from "./host";
import {
  type IdeInstanceOptions,
  IdeInstances,
  type IdeInstanceView,
  IdeLimitError,
  IdeStaleError,
  type IdeStopResult,
} from "./instances";
import {
  detectIdeProvider,
  IDE_PROVIDER_IDS,
  IDE_PROVIDERS,
  type IdeDetectEnvironment,
  type IdeDetection,
  type IdeProviderId,
  type IdeProviderInfo,
  isIdeProviderId,
} from "./providers";
import type { IdeUpstream } from "./proxy";
import { type IdeSettingsStore, isValidBinaryPath } from "./settings";

/** What the Code view needs to know about one connection. */
export type IdeConnection = {
  id: string;
  label: string;
  type: "local" | "ssh";
  generation: number;
  sshDestination?: string;
  remotePlatform?: "windows";
  /** False while World isn't connected to it; absent means connected. */
  ready?: boolean;
};

export type IdeProviderStatus = IdeProviderInfo & {
  detection: IdeDetection;
  enabled: boolean;
  trustedAt: string | null;
  termsAcceptedAt: string | null;
  /** The owner's program path, when set. */
  binary: string | null;
};

/**
 * A server as the Code view lists it. `unreachable` says why World can no
 * longer reach its host (its connection was removed or now points at
 * another host): it still runs there, World can't stop it, and
 * `stopByHand` is what to run on that host instead.
 */
export type IdeServerView = IdeInstanceView & {
  unreachable?: string;
  stopByHand?: string;
};

export type IdeStatus = {
  providers: IdeProviderStatus[];
  instances: IdeServerView[];
  /** Connections on World's own computer; the rest run the IDE on their SSH host. */
  localConnections: string[];
};

/** Why World won't start a server for this project, with the way forward. */
export type IdeRefusal = {
  code:
    | "windows"
    | "stale"
    | "unknown-connection"
    | "folder"
    | "disabled"
    | "missing"
    | "limit";
  message: string;
};

export type IdeOpenResult =
  | { ok: true; instance: IdeInstanceView }
  | { ok: false; refusal: IdeRefusal };

export type IdeServiceDeps = {
  settings: IdeSettingsStore;
  environment: IdeDetectEnvironment;
  /** The current record of one connection, or null when it is gone. */
  connection(connectionId: string): IdeConnection | null;
  /** Every connection ID, current; local ones are listed in status. */
  connectionIds?(): string[];
  /** World's private folder for IDE servers and SSH forward sockets. */
  localRoot: string;
  /** Test doubles for host scripts, forwards and probes. */
  instanceOptions?: Omit<
    Partial<IdeInstanceOptions>,
    "localRoot" | "worldId" | "onChange" | "inventory"
  >;
  now?: () => Date;
  /** Detection is a few `--version` calls; repeat at most this often. */
  detectionTtlMs?: number;
  /** Called when status or instances change. */
  onChange?: () => void;
  /**
   * Looks for a provider on an SSH host (read-only, over the connection's
   * OpenSSH destination). Without it, SSH projects are refused.
   */
  remoteDetect?(
    destination: string,
    provider: IdeProviderId,
    hostLabel: string,
  ): Promise<IdeDetection>;
};

const DETECTION_TTL_MS = 30_000;
/** Looking for this World's servers on its own computer: a few file reads. */
const LOCAL_DISCOVERY_TTL_MS = 10_000;

export class IdeService {
  readonly instances: IdeInstances;
  private readonly now: () => Date;
  private readonly ttl: number;
  private detected = new Map<
    IdeProviderId,
    { at: number; binary: string | null; detection: IdeDetection }
  >();
  /** Per SSH host: connection, generation and provider. */
  private remoteDetected = new Map<
    string,
    { at: number; detection: Promise<IdeDetection> }
  >();

  private worldIdValue: string | null = null;
  private localDiscovery: Promise<unknown> | null = null;
  private localDiscoveredAt = Number.NEGATIVE_INFINITY;
  /** SSH hosts already listed, per connection generation and destination. */
  private sshDiscovered = new Set<string>();

  constructor(private readonly deps: IdeServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.ttl = deps.detectionTtlMs ?? DETECTION_TTL_MS;
    this.instances = new IdeInstances({
      ...deps.instanceOptions,
      localRoot: deps.localRoot,
      worldId: () => this.worldId(),
      onChange: deps.onChange,
      admits: (entry) => this.admitted(entry),
      inventory: {
        read: () => deps.settings.read().servers ?? [],
        write: (servers) =>
          deps.settings.update((current) => {
            if (servers.length) current.servers = servers;
            else delete current.servers;
            return current;
          }),
      },
    });
  }

  /** This World's ID on every host; made when it first starts a server. */
  private worldId() {
    if (this.worldIdValue) return this.worldIdValue;
    const existing = this.deps.settings.read().world_id;
    this.worldIdValue =
      existing ??
      this.deps.settings.update((current) =>
        current.world_id
          ? current
          : { ...current, world_id: randomBytes(16).toString("base64url") },
      ).world_id ??
      null;
    if (!this.worldIdValue) throw new Error("World couldn't keep its ID.");
    return this.worldIdValue;
  }

  private async detect(
    provider: IdeProviderId,
    refresh = false,
  ): Promise<IdeDetection> {
    const binary =
      this.deps.settings.read().providers[provider]?.binary ?? null;
    const cached = this.detected.get(provider);
    const at = this.now().getTime();
    if (
      !refresh &&
      cached &&
      cached.binary === binary &&
      at - cached.at < this.ttl
    )
      return cached.detection;
    const detection = await detectIdeProvider(
      provider,
      this.deps.environment,
      binary,
    );
    this.detected.set(provider, { at, binary, detection });
    return detection;
  }

  async status(options: { refresh?: boolean } = {}): Promise<IdeStatus> {
    await this.reconcile(options.refresh === true);
    const settings = this.deps.settings.read();
    const providers = await Promise.all(
      IDE_PROVIDER_IDS.map(async (id) => {
        const setting = settings.providers[id];
        return {
          ...IDE_PROVIDERS[id],
          detection: await this.detect(id, options.refresh),
          enabled: setting?.enabled === true,
          trustedAt: setting?.trusted_at ?? null,
          termsAcceptedAt: setting?.terms_accepted_at ?? null,
          binary: setting?.binary ?? null,
        };
      }),
    );
    const localConnections = (this.deps.connectionIds?.() ?? []).filter(
      (id) => {
        const connection = this.deps.connection(id);
        return (
          connection?.type === "local" &&
          connection.remotePlatform !== "windows"
        );
      },
    );
    return {
      providers,
      instances: this.instances.list().map((instance) => this.listed(instance)),
      localConnections,
    };
  }

  private listed(instance: IdeInstanceView): IdeServerView {
    const unreachable = this.unreachable(instance);
    return unreachable
      ? { ...instance, unreachable, stopByHand: hostStopByHand(instance.id) }
      : instance;
  }

  /**
   * Why World can't reach the host of a server it started, or null: an SSH
   * server whose connection was removed. World never reaches it through
   * another connection. While the connection exists, Stop goes to the
   * destination the server was started on, even if the connection now
   * points elsewhere. A server on World's own computer is always reachable.
   */
  private unreachable(instance: IdeInstanceView): string | null {
    if (!instance.sshDestination || instance.state === "failed") return null;
    if (this.deps.connection(instance.connectionId)) return null;
    return `Its connection was removed, so World can't reach ${instance.hostLabel} to stop it. It runs there until you stop it by hand.`;
  }

  /**
   * Enable after the gate: the owner accepted full shell/write trust and,
   * where the provider has them, its upstream terms. Nothing starts here.
   */
  async enable(
    provider: unknown,
    consent: { trust?: unknown; acceptTerms?: unknown },
  ) {
    if (!isIdeProviderId(provider)) throw new Error("unknown IDE provider");
    if (consent.trust !== true)
      throw new Error("Enabling needs the full-access trust confirmation.");
    if (IDE_PROVIDERS[provider].terms.length && consent.acceptTerms !== true)
      throw new Error(
        `Enabling needs acceptance of the ${IDE_PROVIDERS[provider].label} terms.`,
      );
    // Not installed here is fine: SSH hosts are checked as projects open.
    const detection = await this.detect(provider, true);
    if (detection.state === "unsupported") throw new Error(detection.reason);
    const at = this.now().toISOString();
    this.deps.settings.update((current) => {
      const previous = current.providers[provider] ?? { enabled: false };
      current.providers[provider] = {
        ...previous,
        enabled: true,
        trusted_at: at,
        ...(IDE_PROVIDERS[provider].terms.length
          ? { terms_accepted_at: at }
          : {}),
      };
      return current;
    });
    this.deps.onChange?.();
  }

  /**
   * Disable: nothing more opens with it, and World detaches from its
   * servers. They keep running, listed, until the person stops each one.
   * The recorded consent stays for re-enable.
   */
  async disable(provider: unknown) {
    if (!isIdeProviderId(provider)) throw new Error("unknown IDE provider");
    this.deps.settings.update((current) => {
      const previous = current.providers[provider];
      if (previous)
        current.providers[provider] = { ...previous, enabled: false };
      return current;
    });
    this.instances.detachWhere(
      (entry) => entry.provider === provider,
      `${IDE_PROVIDERS[provider].label} is disabled; it still runs. Stop it, or enable ${IDE_PROVIDERS[provider].label} again to open it.`,
    );
    this.deps.onChange?.();
  }

  /** Set or clear the program path World runs for a provider. */
  async configure(provider: unknown, binary: unknown) {
    if (!isIdeProviderId(provider)) throw new Error("unknown IDE provider");
    if (binary !== null && !isValidBinaryPath(binary))
      throw new Error("Give the program as an absolute path.");
    this.deps.settings.update((current) => {
      const previous = current.providers[provider] ?? { enabled: false };
      const next = { ...previous };
      if (binary === null) delete next.binary;
      else next.binary = normalize(binary);
      current.providers[provider] = next;
      return current;
    });
    // Running servers keep the program they started with until Stop.
    await this.detect(provider, true);
    this.deps.onChange?.();
  }

  /** Start or reuse the IDE server for one project folder of a connection. */
  async open(request: {
    provider?: unknown;
    connectionId?: unknown;
    generation?: unknown;
    folder?: unknown;
  }): Promise<IdeOpenResult> {
    const refuse = (
      code: IdeRefusal["code"],
      message: string,
    ): IdeOpenResult => ({ ok: false, refusal: { code, message } });
    if (typeof request.connectionId !== "string")
      return refuse("unknown-connection", "Choose a project first.");
    const connection = this.deps.connection(request.connectionId);
    if (!connection)
      return refuse("unknown-connection", "That connection is gone.");
    if (request.generation !== connection.generation)
      return refuse(
        "stale",
        "The connection reconnected since this page loaded. Choose the project again.",
      );
    const folder = typeof request.folder === "string" ? request.folder : "";
    if (!isAbsolute(folder) || /[\u0000-\u001f\u007f]/.test(folder))
      return refuse("folder", "This project has no folder on its computer.");
    if (connection.remotePlatform === "windows")
      return refuse(
        "windows",
        `World can't run a web IDE server on ${connection.label}, a Windows host, yet.`,
      );
    const remote =
      connection.type === "ssh" && connection.sshDestination
        ? connection.sshDestination
        : null;
    if (connection.type === "ssh" && !remote)
      return refuse(
        "unknown-connection",
        `World doesn't know the SSH destination of ${connection.label}.`,
      );
    if (!remote) {
      try {
        if (!statSync(folder).isDirectory())
          return refuse("folder", "The project folder isn't a folder.");
      } catch {
        return refuse(
          "folder",
          "The project folder doesn't exist on this computer.",
        );
      }
    }
    const provider = isIdeProviderId(request.provider)
      ? request.provider
      : IDE_PROVIDER_IDS.find((id) => this.enabled(id));
    if (!provider || !this.enabled(provider))
      return refuse("disabled", "Enable an IDE in the Code view first.");
    const detection = remote
      ? await this.detectRemote(connection, remote, provider)
      : await this.detect(provider);
    if (detection.state !== "detected")
      return refuse("missing", detection.reason);
    // Detection awaited: the connection may have reconnected, changed host
    // or gone, or the provider been disabled, and reconcile() has already
    // run. Re-check admission now, synchronously before the open is queued;
    // a change during the host start detaches it (it runs on, listed).
    const admission = {
      provider,
      connectionId: connection.id,
      generation: connection.generation,
      ...(remote ? { sshDestination: remote } : {}),
    };
    if (!this.admitted(admission))
      return this.enabled(provider)
        ? refuse(
            "stale",
            "The connection changed while the IDE was starting. Choose the project again.",
          )
        : refuse("disabled", "Enable an IDE in the Code view first.");
    try {
      const instance = await this.instances.open({
        provider,
        binary: detection.path,
        connectionId: connection.id,
        generation: connection.generation,
        folder: normalize(folder),
        ...(remote
          ? { ssh: { destination: remote, hostLabel: connection.label } }
          : {}),
      });
      return { ok: true, instance };
    } catch (error) {
      if (error instanceof IdeLimitError) return refuse("limit", error.message);
      if (error instanceof IdeStaleError)
        return this.enabled(provider)
          ? refuse("stale", error.message)
          : refuse("disabled", "Enable an IDE in the Code view first.");
      throw error;
    }
  }

  /** One provider on one SSH host, cached like local detection. */
  private detectRemote(
    connection: IdeConnection,
    destination: string,
    provider: IdeProviderId,
  ): Promise<IdeDetection> {
    if (!this.deps.remoteDetect)
      return Promise.resolve({
        provider,
        state: "unsupported",
        reason: "This World can't run IDEs on SSH hosts.",
        configured: false,
      });
    const key = `${connection.id}\u0000${connection.generation}\u0000${destination}\u0000${provider}`;
    const at = this.now().getTime();
    const cached = this.remoteDetected.get(key);
    if (cached && at - cached.at < this.ttl) return cached.detection;
    const detection = this.deps
      .remoteDetect(destination, provider, connection.label)
      .catch(
        (error): IdeDetection => ({
          provider,
          state: "missing",
          reason: `World couldn't look for ${IDE_PROVIDERS[provider].label} on ${connection.label}: ${(error as Error).message}`,
          configured: false,
        }),
      );
    this.remoteDetected.set(key, { at, detection });
    // A failed look is not remembered: the next open asks again.
    void detection.then((result) => {
      if (result.state !== "detected") this.remoteDetected.delete(key);
    });
    return detection;
  }

  /**
   * Stop one completely: the server and every process it started. The only
   * way World ends a server, and only on its host's own connection.
   */
  stop(instanceId: unknown): Promise<IdeStopResult> {
    if (typeof instanceId !== "string")
      return Promise.resolve({ ok: false, reason: "Choose a server." });
    const instance = this.instances.get(instanceId);
    const unreachable = instance && this.unreachable(instance);
    if (unreachable) return Promise.resolve({ ok: false, reason: unreachable });
    return this.instances.stop(instanceId);
  }

  /**
   * Stop listing a server World can't reach, once the person stopped it by
   * hand. Refused for one World can still stop.
   */
  forget(instanceId: unknown): IdeStopResult {
    if (typeof instanceId !== "string")
      return { ok: false, reason: "Choose a server." };
    const instance = this.instances.get(instanceId);
    if (!instance) return { ok: true };
    if (!this.unreachable(instance))
      return {
        ok: false,
        reason: "World can still reach this server: Stop it instead.",
      };
    this.instances.forget(instanceId);
    return { ok: true };
  }

  /**
   * A connection was removed. Its servers keep running and stay listed:
   * on World's own computer still with Stop, on an SSH host as
   * unreachable, with how to stop them by hand.
   */
  connectionRemoved(connectionId: unknown) {
    if (typeof connectionId !== "string") return;
    this.sshDiscovered = new Set(
      [...this.sshDiscovered].filter(
        (key) => !key.startsWith(`${connectionId}\u0000`),
      ),
    );
    this.instances.detachWhere(
      (entry) => entry.connectionId === connectionId,
      "Its connection was removed; it still runs.",
    );
    this.deps.onChange?.();
  }

  private enabled(provider: IdeProviderId) {
    return this.deps.settings.read().providers[provider]?.enabled === true;
  }

  /**
   * Whether an attachment still holds: its provider is enabled and its
   * connection is the same runtime generation, on the same machine (World's
   * own, or the same SSH destination), it was attached under. A reconnect,
   * a change of host or transport, or removal detaches it; the server runs
   * on.
   */
  private admitted(
    instance: Pick<
      IdeInstanceView,
      "provider" | "connectionId" | "generation" | "sshDestination"
    >,
  ) {
    const connection = this.deps.connection(instance.connectionId);
    if (
      connection === null ||
      connection.generation !== instance.generation ||
      connection.remotePlatform === "windows" ||
      !this.enabled(instance.provider)
    )
      return false;
    const destination =
      connection.type === "ssh" ? (connection.sshDestination ?? null) : null;
    return destination === (instance.sshDestination ?? null);
  }

  /**
   * The proxy target for one route: only while the server is ready and its
   * admission still holds; a stale one is detached.
   */
  upstream(instanceId: string): IdeUpstream | null {
    const instance = this.instances.get(instanceId);
    if (!instance) return null;
    if (!this.admitted(instance)) {
      this.instances.detachWhere((entry) => entry.id === instanceId);
      return null;
    }
    return this.instances.upstream(instanceId);
  }

  /**
   * Bring World's view of its IDE servers up to date, without starting or
   * stopping any: detach from those whose connection changed; list this
   * World's servers on its own computer and on each connected SSH host
   * (once per connection generation); reattach to the ones whose
   * connection is back. World calls this whenever a connection changes.
   */
  async reconcile(refresh = false) {
    this.instances.detachWhere(
      (entry) => !this.admitted(entry),
      "World's connection to its host changed; it still runs there.",
    );
    // No ID yet: this World never started a server.
    if (this.deps.settings.read().world_id) {
      for (const connection of this.sshConnections()) {
        const key = `${connection.id}\u0000${connection.generation}\u0000${connection.sshDestination}`;
        if (!refresh && this.sshDiscovered.has(key)) continue;
        this.sshDiscovered.add(key);
        void this.instances
          .discover({
            ssh: {
              destination: connection.sshDestination ?? "",
              hostLabel: connection.label,
            },
          })
          .then((listed) => {
            // Not reached: ask again on the next change or status.
            if (!listed) this.sshDiscovered.delete(key);
            else this.reattachAdmitted();
          });
      }
      const at = this.now().getTime();
      if (
        !this.localDiscovery &&
        (refresh || at - this.localDiscoveredAt >= LOCAL_DISCOVERY_TTL_MS)
      ) {
        this.localDiscoveredAt = at;
        this.localDiscovery = this.instances.discover({}).finally(() => {
          this.localDiscovery = null;
        });
      }
      await this.localDiscovery;
    }
    this.reattachAdmitted();
  }

  private sshConnections() {
    return (this.deps.connectionIds?.() ?? [])
      .map((id) => this.deps.connection(id))
      .filter(
        (connection): connection is IdeConnection =>
          connection?.type === "ssh" &&
          Boolean(connection.sshDestination) &&
          connection.ready !== false &&
          connection.remotePlatform !== "windows",
      );
  }

  /** Reattach, once per generation, to detached servers whose connection is back. */
  private reattachAdmitted() {
    for (const entry of this.instances.list()) {
      if (entry.state !== "detached" || entry.stopping) continue;
      const connection = this.deps.connection(entry.connectionId);
      if (
        !connection ||
        connection.ready === false ||
        connection.remotePlatform === "windows" ||
        !this.enabled(entry.provider)
      )
        continue;
      const destination =
        connection.type === "ssh" ? (connection.sshDestination ?? null) : null;
      if (destination !== (entry.sshDestination ?? null)) continue;
      void this.instances.reattach(
        entry.id,
        connection.generation,
        connection.label,
      );
    }
  }

  /** Called as World detaches from or stops an instance, so its sockets close. */
  onRevoked(listener: (instanceId: string) => void) {
    return this.instances.onRevoked(listener);
  }

  /** World stops: close its attachments. Every server runs on. */
  closeAll() {
    this.instances.closeAll();
  }
}
