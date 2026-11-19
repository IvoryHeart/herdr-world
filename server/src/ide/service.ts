import { statSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";
import { IdeInstances, type IdeInstanceView, IdeLimitError } from "./instances";
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
    | "limit";
  message: string;
  /** For SSH projects: open the same host and folder in desktop VS Code. */
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
    this.retireOrphans();
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
    return { providers, instances: this.instances.list() };
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
      : IDE_PROVIDER_IDS.find((id) => settings.providers[id]?.enabled);
    if (!provider || !settings.providers[provider]?.enabled)
      return refuse("disabled", "Enable an IDE in the Code view first.");
    const detection = await this.detect(provider);
    if (detection.state !== "detected")
      return refuse("disabled", detection.reason);
    try {
      const { instance } = this.instances.open({
        provider,
        binary: detection.path,
        connectionId: connection.id,
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

  /**
   * The proxy target for one route: only while the server is ready, its
   * provider is still enabled and its connection still exists.
   */
  upstream(instanceId: string): IdeUpstream | null {
    const instance = this.instances.get(instanceId);
    if (!instance) return null;
    if (!this.deps.connection(instance.connectionId)) {
      void this.instances.stop(instanceId);
      return null;
    }
    if (!this.deps.settings.read().providers[instance.provider]?.enabled)
      return null;
    return this.instances.upstream(instanceId);
  }

  /** Stop servers whose connection was removed. */
  private retireOrphans() {
    void this.instances.stopWhere(
      (entry) => this.deps.connection(entry.connectionId) === null,
    );
  }

  stopAll() {
    return this.instances.stopAll();
  }
}
