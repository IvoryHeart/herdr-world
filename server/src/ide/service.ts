import { statSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";
import { IdeInstances, type IdeInstanceView, IdeLimitError } from "./instances";
import {
  detectIdeProvider,
  ideDesktopOnlyReason,
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
};

export type IdeProviderStatus = IdeProviderInfo & {
  detection: IdeDetection;
  enabled: boolean;
  trustedAt: string | null;
  termsAcceptedAt: string | null;
  /** The owner's program path, when set. */
  binary: string | null;
};

export type IdeStatus = {
  providers: IdeProviderStatus[];
  instances: IdeInstanceView[];
  /** Connections on World's own computer: the ones Code can open here. */
  localConnections: string[];
};

/** Why World won't start a server for this project, with the way forward. */
export type IdeRefusal = {
  code:
    | "remote"
    | "windows"
    | "stale"
    | "unknown-connection"
    | "folder"
    | "disabled"
    | "limit"
    | "origin";
  message: string;
  /** Open the same host and folder in desktop VS Code instead. */
  handoff?: { command: string; url: string };
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
  instances?: IdeInstances;
  now?: () => Date;
  /** Detection is a few `--version` calls; repeat at most this often. */
  detectionTtlMs?: number;
  /** Called when status or instances change. */
  onChange?: () => void;
};

const DETECTION_TTL_MS = 30_000;
/** OpenSSH alias or user@host, as connection profiles already accept. */
const SSH_DESTINATION = /^[A-Za-z0-9._-]+(@[A-Za-z0-9._:-]+)?$/;

/**
 * VS Code's own SSH handoff for a remote folder: its documented
 * `--remote ssh-remote+<host>` CLI form and `vscode-remote` link. World
 * never runs a desktop program on the service host.
 */
export function vscodeRemoteHandoff(
  destination: string,
  folder: string,
): IdeRefusal["handoff"] | undefined {
  if (!SSH_DESTINATION.test(destination) || !isAbsolute(folder))
    return undefined;
  const quoted = `'${folder.replaceAll("'", "'\\''")}'`;
  const encodedPath = folder
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return {
    command: `code --remote ssh-remote+${destination} ${quoted}`,
    url: `vscode://vscode-remote/ssh-remote+${destination}${encodedPath}`,
  };
}

/** Desktop VS Code's link and command for a folder on this computer. */
export function vscodeLocalHandoff(
  folder: string,
): IdeRefusal["handoff"] | undefined {
  if (!isAbsolute(folder)) return undefined;
  const quoted = `'${folder.replaceAll("'", "'\\''")}'`;
  const encodedPath = folder
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return { command: `code ${quoted}`, url: `vscode://file${encodedPath}` };
}

export class IdeService {
  readonly instances: IdeInstances;
  private readonly now: () => Date;
  private readonly ttl: number;
  private detected = new Map<
    IdeProviderId,
    { at: number; binary: string | null; detection: IdeDetection }
  >();

  constructor(private readonly deps: IdeServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.ttl = deps.detectionTtlMs ?? DETECTION_TTL_MS;
    this.instances =
      deps.instances ?? new IdeInstances({ onChange: deps.onChange });
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
    void this.retireStale();
    const settings = this.deps.settings.read();
    const providers = await Promise.all(
      IDE_PROVIDER_IDS.map(async (id) => {
        const setting = settings.providers[id];
        return {
          ...IDE_PROVIDERS[id],
          detection: await this.detect(id, options.refresh),
          enabled: setting?.enabled === true && IDE_PROVIDERS[id].oneOrigin,
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
    return { providers, instances: this.instances.list(), localConnections };
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
    if (!IDE_PROVIDERS[provider].oneOrigin)
      throw new Error(ideDesktopOnlyReason(IDE_PROVIDERS[provider]));
    if (consent.trust !== true)
      throw new Error("Enabling needs the full-access trust confirmation.");
    if (IDE_PROVIDERS[provider].terms.length && consent.acceptTerms !== true)
      throw new Error(
        `Enabling needs acceptance of the ${IDE_PROVIDERS[provider].label} terms.`,
      );
    const detection = await this.detect(provider, true);
    if (detection.state !== "detected") throw new Error(detection.reason);
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

  /** Disable and stop its servers; the recorded consent stays for re-enable. */
  async disable(provider: unknown) {
    if (!isIdeProviderId(provider)) throw new Error("unknown IDE provider");
    this.deps.settings.update((current) => {
      const previous = current.providers[provider];
      if (previous)
        current.providers[provider] = { ...previous, enabled: false };
      return current;
    });
    await this.instances.stopWhere((entry) => entry.provider === provider);
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
    await this.instances.stopWhere((entry) => entry.provider === provider);
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
      handoff?: IdeRefusal["handoff"],
    ): IdeOpenResult => ({
      ok: false,
      refusal: { code, message, ...(handoff ? { handoff } : {}) },
    });
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
        "World can't run a web IDE server on a Windows host. Open the folder in desktop VS Code with Remote-SSH.",
      );
    if (connection.type === "ssh")
      return refuse(
        "remote",
        `This project is on ${connection.label}, over SSH. World runs VS Code in the browser only for projects on its own computer for now: open it in desktop VS Code with Remote-SSH.`,
        connection.sshDestination
          ? vscodeRemoteHandoff(connection.sshDestination, folder)
          : undefined,
      );
    try {
      if (!statSync(folder).isDirectory())
        return refuse("folder", "The project folder isn't a folder.");
    } catch {
      return refuse(
        "folder",
        "The project folder doesn't exist on this computer.",
      );
    }
    const settings = this.deps.settings.read();
    const provider = isIdeProviderId(request.provider)
      ? request.provider
      : IDE_PROVIDER_IDS.find((id) => this.enabled(id));
    if (provider && !IDE_PROVIDERS[provider].oneOrigin)
      return refuse(
        "origin",
        ideDesktopOnlyReason(IDE_PROVIDERS[provider]),
        vscodeLocalHandoff(normalize(folder)),
      );
    if (!provider || !settings.providers[provider]?.enabled)
      return refuse("disabled", "Enable an IDE in the Code view first.");
    const detection = await this.detect(provider);
    if (detection.state !== "detected")
      return refuse("disabled", detection.reason);
    // Detection awaited: the connection may have reconnected, turned to SSH or
    // gone, or the provider been disabled, and retireStale() has already run.
    // Re-check admission now, synchronously before the spawn, so no stale
    // server starts after its retirement.
    const admission = {
      provider,
      connectionId: connection.id,
      generation: connection.generation,
    };
    if (!this.admitted(admission))
      return this.enabled(provider)
        ? refuse(
            "stale",
            "The connection changed while the IDE was starting. Choose the project again.",
          )
        : refuse("disabled", "Enable an IDE in the Code view first.");
    try {
      const { instance } = this.instances.open({
        provider,
        binary: detection.path,
        connectionId: connection.id,
        generation: connection.generation,
        folder: normalize(folder),
      });
      return { ok: true, instance };
    } catch (error) {
      if (error instanceof IdeLimitError) return refuse("limit", error.message);
      throw error;
    }
  }

  stop(instanceId: unknown) {
    if (typeof instanceId !== "string") return Promise.resolve(false);
    return this.instances.stop(instanceId);
  }

  private enabled(provider: IdeProviderId) {
    return (
      IDE_PROVIDERS[provider].oneOrigin &&
      this.deps.settings.read().providers[provider]?.enabled === true
    );
  }

  /**
   * Whether an instance's admission still holds: its provider is enabled
   * and its connection is the same local runtime generation it was opened
   * under. A reconnect, a change to SSH or removal ends it.
   */
  private admitted(
    instance: Pick<IdeInstanceView, "provider" | "connectionId" | "generation">,
  ) {
    const connection = this.deps.connection(instance.connectionId);
    return (
      connection !== null &&
      connection.generation === instance.generation &&
      connection.type === "local" &&
      connection.remotePlatform !== "windows" &&
      this.enabled(instance.provider)
    );
  }

  /**
   * The proxy target for one route: only while the server is ready and its
   * admission still holds; a stale one is stopped.
   */
  upstream(instanceId: string): IdeUpstream | null {
    const instance = this.instances.get(instanceId);
    if (!instance) return null;
    if (!this.admitted(instance)) {
      void this.instances.stop(instanceId);
      return null;
    }
    return this.instances.upstream(instanceId);
  }

  /**
   * Stop servers whose admission no longer holds, revoking their streams.
   * World calls this whenever a connection changes.
   */
  retireStale() {
    return this.instances.stopWhere((entry) => !this.admitted(entry));
  }

  /** Called as an instance starts to stop, so its sockets can close. */
  onRevoked(listener: (instanceId: string) => void) {
    return this.instances.onRevoked(listener);
  }

  stopAll() {
    return this.instances.stopAll();
  }
}
