/**
 * The Code view's client for World's installed-IDE integration
 * (`world.ide.*`). Shapes mirror server/src/ide/service.ts; anything the
 * service sends that does not parse is treated as missing, never guessed.
 *
 * Testing switch: open World with `?ideFixture=<state>` and the Code view
 * shows that state from synthetic data instead of the service's:
 * `missing` (no IDE installed), `detected` (installed, not enabled),
 * `ssh` (starting on an SSH host), `downloading` (first start), `failed`
 * (the server exited), `not-installed` (only OpenVSCode Server is enabled
 * and it isn't installed where the project is, so opening is refused; the
 * others are installed and can be enabled instead) or `restored` (World
 * restarted and found the IDE
 * servers it had started still running: one here, one on an SSH host, and
 * one on a host whose connection was removed, which World can't reach).
 * Nothing is detected, started or stored.
 * The page drops the parameter at once; the switch lasts until a reload.
 */
import { bridge } from "../../api";

export type IdeProviderId = "vscode" | "code-server" | "openvscode";

export type IdeDetection =
  | {
      state: "detected";
      path: string;
      version: string | null;
      configured: boolean;
    }
  | {
      state: "missing" | "unsupported";
      reason: string;
      configured: boolean;
    };

export type IdeTerm = { label: string; url: string };

export type IdeProviderStatus = {
  id: IdeProviderId;
  label: string;
  marketplace: string;
  terms: IdeTerm[];
  setupUrl: string;
  detection: IdeDetection;
  /**
   * True for Microsoft's VS Code: its workbench connects only from HTTPS or
   * localhost (it signs with crypto.subtle), never a plain-HTTP address.
   */
  needsSecurePage: boolean;
  enabled: boolean;
  trustedAt: string | null;
  termsAcceptedAt: string | null;
  binary: string | null;
};

export type IdeInstance = {
  id: string;
  provider: IdeProviderId;
  connectionId: string;
  folder: string;
  /**
   * `detached`: it runs on its host, World isn't attached to it (after a
   * restart, a reconnect or a dropped SSH link). Only `failed` ones no
   * longer run.
   */
  state: "starting" | "ready" | "detached" | "failed";
  url: string;
  startedAt: string;
  reason?: string;
  downloading?: boolean;
  /** Set while World is stopping it. */
  stopping?: boolean;
  /** Set when the IDE runs on the project's SSH host. */
  sshDestination?: string;
  /** The host's name when World last reached it. */
  hostLabel?: string;
  /**
   * Why World can't reach its host any more (its connection was removed):
   * it still runs there, can't be stopped from World, and `stopByHand` is
   * what to run on that host. Forget then takes it off the list.
   */
  unreachable?: string;
  stopByHand?: string;
};

export type IdeStatus = {
  providers: IdeProviderStatus[];
  instances: IdeInstance[];
  /** Connections on World's own computer; others run on their SSH host. */
  localConnections: string[];
};

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
  | { ok: true; instance: IdeInstance }
  | { ok: false; refusal: IdeRefusal };

export type IdeOpenRequest = {
  provider?: IdeProviderId;
  connectionId: string;
  generation: number;
  folder: string;
};

/** What the Code view calls; tests and the testing switch supply others. */
export type IdeClient = {
  status(refresh?: boolean): Promise<IdeStatus>;
  enable(provider: IdeProviderId): Promise<IdeStatus>;
  disable(provider: IdeProviderId): Promise<IdeStatus>;
  configure(provider: IdeProviderId, binary: string | null): Promise<IdeStatus>;
  open(request: IdeOpenRequest): Promise<IdeOpenResult>;
  stop(instanceId: string): Promise<IdeStatus>;
  /** Stops listing one World can't reach, once it was stopped by hand. */
  forget(instanceId: string): Promise<IdeStatus>;
  /** Calls back when the service says status or servers changed. */
  subscribe(changed: () => void): () => void;
};

const PROVIDERS = new Set<string>(["vscode", "code-server", "openvscode"]);
const INSTANCE_STATES = new Set<string>([
  "starting",
  "ready",
  "detached",
  "failed",
]);
const REFUSALS = new Set<string>([
  "windows",
  "stale",
  "unknown-connection",
  "folder",
  "disabled",
  "missing",
  "limit",
]);

const text = (value: unknown): value is string => typeof value === "string";
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
/** The IDE route is always World's own `/ide/<id>/`; nothing else is framed. */
const IDE_URL = /^\/ide\/[A-Za-z0-9_-]{16,64}\/$/;

function parseDetection(value: unknown): IdeDetection {
  if (!record(value))
    return { state: "missing", reason: "Unknown", configured: false };
  const configured = value.configured === true;
  if (value.state === "detected" && text(value.path))
    return {
      state: "detected",
      path: value.path,
      version: text(value.version) ? value.version : null,
      configured,
    };
  return {
    state: value.state === "unsupported" ? "unsupported" : "missing",
    reason: text(value.reason) ? value.reason : "Not found on this computer.",
    configured,
  };
}

function parseProvider(value: unknown): IdeProviderStatus | null {
  if (!record(value) || !text(value.id) || !PROVIDERS.has(value.id))
    return null;
  const terms = Array.isArray(value.terms)
    ? value.terms.flatMap((term) =>
        record(term) &&
        text(term.label) &&
        text(term.url) &&
        /^https:\/\//.test(term.url)
          ? [{ label: term.label, url: term.url }]
          : [],
      )
    : [];
  return {
    id: value.id as IdeProviderId,
    label: text(value.label) ? value.label : value.id,
    marketplace: text(value.marketplace) ? value.marketplace : "",
    terms,
    setupUrl:
      text(value.setupUrl) && /^https:\/\//.test(value.setupUrl)
        ? value.setupUrl
        : "",
    detection: parseDetection(value.detection),
    needsSecurePage: value.needsSecurePage === true,
    enabled: value.enabled === true,
    trustedAt: text(value.trustedAt) ? value.trustedAt : null,
    termsAcceptedAt: text(value.termsAcceptedAt) ? value.termsAcceptedAt : null,
    binary: text(value.binary) ? value.binary : null,
  };
}

export function parseIdeInstance(value: unknown): IdeInstance | null {
  if (
    !record(value) ||
    !text(value.id) ||
    !text(value.provider) ||
    !PROVIDERS.has(value.provider) ||
    !text(value.connectionId) ||
    !text(value.folder) ||
    !text(value.state) ||
    !INSTANCE_STATES.has(value.state) ||
    !text(value.url) ||
    !IDE_URL.test(value.url)
  )
    return null;
  return {
    id: value.id,
    provider: value.provider as IdeProviderId,
    connectionId: value.connectionId,
    folder: value.folder,
    state: value.state as IdeInstance["state"],
    url: value.url,
    startedAt: text(value.startedAt) ? value.startedAt : "",
    ...(text(value.reason) ? { reason: value.reason } : {}),
    ...(value.downloading === true ? { downloading: true } : {}),
    ...(value.stopping === true ? { stopping: true } : {}),
    ...(text(value.sshDestination)
      ? { sshDestination: value.sshDestination }
      : {}),
    ...(text(value.hostLabel) ? { hostLabel: value.hostLabel } : {}),
    ...(text(value.unreachable) ? { unreachable: value.unreachable } : {}),
    ...(text(value.stopByHand) ? { stopByHand: value.stopByHand } : {}),
  };
}

export function parseIdeStatus(value: unknown): IdeStatus {
  const source = record(value) ? value : {};
  return {
    providers: Array.isArray(source.providers)
      ? source.providers.flatMap((entry) => {
          const parsed = parseProvider(entry);
          return parsed ? [parsed] : [];
        })
      : [],
    instances: Array.isArray(source.instances)
      ? source.instances.flatMap((entry) => {
          const parsed = parseIdeInstance(entry);
          return parsed ? [parsed] : [];
        })
      : [],
    localConnections: Array.isArray(source.localConnections)
      ? source.localConnections.filter(text)
      : [],
  };
}

export function parseIdeOpenResult(value: unknown): IdeOpenResult {
  if (record(value) && value.ok === true) {
    const instance = parseIdeInstance(value.instance);
    if (instance) return { ok: true, instance };
  }
  const refusal =
    record(value) && record(value.refusal) ? value.refusal : undefined;
  return {
    ok: false,
    refusal: {
      code:
        refusal && text(refusal.code) && REFUSALS.has(refusal.code)
          ? (refusal.code as IdeRefusal["code"])
          : "unknown-connection",
      message:
        refusal && text(refusal.message)
          ? refusal.message
          : "World couldn't open this project.",
    },
  };
}

/** The service's client: `world.ide.*` and its change notice. */
export const serviceIdeClient: IdeClient = {
  status: async (refresh) =>
    parseIdeStatus(
      await bridge.call("world.ide.status", refresh ? { refresh: true } : {}),
    ),
  enable: async (provider) =>
    parseIdeStatus(
      await bridge.call("world.ide.enable", {
        provider,
        trust: true,
        acceptTerms: true,
      }),
    ),
  disable: async (provider) =>
    parseIdeStatus(await bridge.call("world.ide.disable", { provider })),
  configure: async (provider, binary) =>
    parseIdeStatus(
      await bridge.call("world.ide.configure", { provider, binary }),
    ),
  open: async (request) =>
    parseIdeOpenResult(await bridge.call("world.ide.open", request)),
  stop: async (instanceId) =>
    parseIdeStatus(await bridge.call("world.ide.stop", { instanceId })),
  forget: async (instanceId) =>
    parseIdeStatus(await bridge.call("world.ide.forget", { instanceId })),
  subscribe: (changed) =>
    bridge.onControl((control) => {
      if (control.type === "world_ide_changed") changed();
    }),
};

export type IdeFixture =
  | "missing"
  | "detected"
  | "ssh"
  | "downloading"
  | "failed"
  | "not-installed"
  | "restored";
const FIXTURES = new Set<string>([
  "missing",
  "detected",
  "ssh",
  "downloading",
  "failed",
  "not-installed",
  "restored",
]);
const PARAM = "ideFixture";
let fixture: IdeFixture | false | undefined;

/** The switch, read once per page load; the parameter is removed. */
export function ideFixture(): IdeFixture | false {
  if (fixture !== undefined) return fixture;
  fixture = false;
  if (typeof location === "undefined") return fixture;
  const url = new URL(location.href);
  if (!url.searchParams.has(PARAM)) return fixture;
  const value = url.searchParams.get(PARAM) ?? "";
  fixture = FIXTURES.has(value) ? (value as IdeFixture) : "detected";
  url.searchParams.delete(PARAM);
  history.replaceState(history.state, "", url);
  return fixture;
}

/** For tests: forget the switch so the next read sees the URL again. */
export function resetIdeFixture() {
  fixture = undefined;
}

const FIXTURE_PROVIDERS = (
  state: "missing" | "detected",
  enabled: ReadonlySet<IdeProviderId>,
): IdeProviderStatus[] =>
  FIXTURE_PROVIDER_ROWS(state).map((provider) => {
    const on = enabled.has(provider.id);
    return {
      ...provider,
      enabled: on,
      trustedAt: on ? new Date(0).toISOString() : null,
      termsAcceptedAt: on ? new Date(0).toISOString() : null,
    };
  });

const FIXTURE_PROVIDER_ROWS = (
  state: "missing" | "detected",
): IdeProviderStatus[] => [
  {
    id: "vscode",
    label: "Visual Studio Code",
    marketplace: "Microsoft Marketplace",
    terms: [
      {
        label: "Visual Studio Code Server License Terms",
        url: "https://aka.ms/vscode-server-license",
      },
      {
        label: "Microsoft Privacy Statement",
        url: "https://privacy.microsoft.com/privacystatement",
      },
    ],
    setupUrl: "https://code.visualstudio.com/download",
    detection:
      state === "detected"
        ? {
            state: "detected",
            path: "/opt/example/vscode/bin/code-tunnel",
            version: "1.99.0",
            configured: false,
          }
        : {
            state: "missing",
            reason: "VS Code isn't installed on this computer.",
            configured: false,
          },
    needsSecurePage: true,
    enabled: false,
    trustedAt: null,
    termsAcceptedAt: null,
    binary: null,
  },
  {
    id: "code-server",
    label: "code-server",
    marketplace: "Open VSX",
    terms: [],
    setupUrl: "https://coder.com/docs/code-server/install",
    detection:
      state === "detected"
        ? {
            state: "detected",
            path: "/opt/example/code-server/bin/code-server",
            version: "4.99.0",
            configured: false,
          }
        : {
            state: "missing",
            reason: "code-server isn't installed on this computer.",
            configured: false,
          },
    needsSecurePage: false,
    enabled: false,
    trustedAt: null,
    termsAcceptedAt: null,
    binary: null,
  },
  {
    id: "openvscode",
    label: "OpenVSCode Server",
    marketplace: "Open VSX",
    terms: [],
    setupUrl: "https://github.com/gitpod-io/openvscode-server#getting-started",
    detection: {
      state: "missing",
      reason: "OpenVSCode Server isn't installed on this computer.",
      configured: false,
    },
    needsSecurePage: false,
    enabled: false,
    trustedAt: null,
    termsAcceptedAt: null,
    binary: null,
  },
];

/**
 * A synthetic client for one state. It keeps its state in memory; enabling
 * works so the gate can be tried, and a started server never becomes ready
 * (there is none), so the view stays on the state being shown.
 */
export function fixtureIdeClient(kind: IdeFixture): IdeClient {
  const listeners = new Set<() => void>();
  const detection = kind === "missing" ? "missing" : "detected";
  const enabled = new Set<IdeProviderId>(
    kind === "missing" || kind === "detected"
      ? []
      : kind === "not-installed"
        ? ["openvscode"]
        : ["code-server"],
  );
  let providers = FIXTURE_PROVIDERS(detection, enabled);
  let started = 0;
  let instances: IdeInstance[] = kind === "restored" ? RESTORED() : [];
  // Unknown to the switch: the view then prefers no host over another.
  const status = (): IdeStatus => ({
    providers,
    instances,
    localConnections: [],
  });
  const changed = () => {
    for (const listener of listeners) listener();
  };
  return {
    status: async () => status(),
    enable: async (provider) => {
      // As the service: enabling doesn't need it on World's computer.
      enabled.add(provider);
      providers = FIXTURE_PROVIDERS(detection, enabled);
      changed();
      return status();
    },
    disable: async (provider) => {
      enabled.delete(provider);
      providers = FIXTURE_PROVIDERS(detection, enabled);
      const label =
        providers.find((entry) => entry.id === provider)?.label ?? provider;
      // As the service: its servers keep running, listed, until Stop.
      instances = instances.map((instance) =>
        instance.provider === provider &&
        (instance.state === "ready" || instance.state === "starting")
          ? {
              ...instance,
              state: "detached",
              reason: `${label} is disabled; it still runs.`,
            }
          : instance,
      );
      changed();
      return status();
    },
    configure: async () => status(),
    open: async (request) => {
      const provider =
        request.provider ?? providers.find((entry) => entry.enabled)?.id;
      if (!provider || !enabled.has(provider))
        return {
          ok: false,
          refusal: {
            code: "disabled",
            message: "Enable an IDE in the Code view first.",
          },
        };
      const using = providers.find((entry) => entry.id === provider);
      // Not installed where the project is: the refusal being shown. Other
      // states treat a missing one as installed on the SSH host.
      if (
        kind === "not-installed" &&
        using &&
        using.detection.state !== "detected"
      )
        return {
          ok: false,
          refusal: {
            code: "missing",
            message: `${using.label} isn't installed on the project's computer. Install it there, then open the project again.`,
          },
        };
      const known = instances.find(
        (entry) =>
          entry.connectionId === request.connectionId &&
          entry.folder === request.folder &&
          entry.provider === provider,
      );
      if (known) {
        // Reattaching: there is no server to reach, so it stays starting.
        const instance: IdeInstance = {
          ...known,
          state: "starting",
          reason: undefined,
        };
        instances = instances.map((entry) =>
          entry.id === known.id ? instance : entry,
        );
        changed();
        return { ok: true, instance };
      }
      // One server per IDE and folder, as the service: each its own id.
      const id = `fixtureInstance${String(++started).padStart(4, "0")}`;
      const instance: IdeInstance = {
        id,
        provider,
        connectionId: request.connectionId,
        folder: request.folder,
        state: kind === "failed" ? "failed" : "starting",
        url: `/ide/${id}/`,
        startedAt: new Date().toISOString(),
        ...(kind === "failed"
          ? {
              reason: `${using?.label ?? provider} stopped: error: the server could not bind its socket`,
            }
          : kind === "downloading"
            ? { downloading: true }
            : kind === "ssh"
              ? { sshDestination: "devbox.example" }
              : {}),
      };
      instances = [...instances, instance];
      changed();
      return { ok: true, instance };
    },
    stop: async (instanceId) => {
      instances = instances.filter(
        (instance) => instance.id !== instanceId || instance.unreachable,
      );
      changed();
      return status();
    },
    forget: async (instanceId) => {
      instances = instances.filter(
        (instance) => instance.id !== instanceId || !instance.unreachable,
      );
      changed();
      return status();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * What a restarted World finds: servers it started earlier, still running
 * and not yet attached. Synthetic folders and host.
 */
const RESTORED = (): IdeInstance[] => {
  const earlier = (hours: number) =>
    new Date(Date.now() - hours * 3_600_000).toISOString();
  return [
    {
      id: "fixtureRestoredLocal00",
      provider: "code-server",
      connectionId: "fixture-local",
      folder: "/srv/example/web-app",
      state: "detached",
      url: "/ide/fixtureRestoredLocal00/",
      startedAt: earlier(3),
    },
    {
      id: "fixtureRestoredRemote0",
      provider: "code-server",
      connectionId: "fixture-ssh",
      folder: "/srv/example/api",
      state: "detached",
      url: "/ide/fixtureRestoredRemote0/",
      startedAt: earlier(26),
      sshDestination: "devbox.example",
      hostLabel: "devbox",
      reason:
        "SSH to devbox.example dropped; the IDE still runs there. Open it to reconnect.",
    },
    {
      id: "fixtureRestoredGone000",
      provider: "code-server",
      connectionId: "fixture-removed",
      folder: "/srv/example/old-service",
      state: "detached",
      url: "/ide/fixtureRestoredGone000/",
      startedAt: earlier(50),
      sshDestination: "oldbox.example",
      hostLabel: "oldbox",
      unreachable:
        "Its connection was removed, so World can't reach oldbox to stop it. It runs there until you stop it by hand.",
      stopByHand:
        'd="${XDG_STATE_HOME:-$HOME/.local/state}/herdr-world/ide/fixtureRestoredGone000"; kill -TERM -- -"$(cat "$d/pid")" && rm -rf "$d"',
    },
  ];
};

let pageClient: IdeClient | undefined;

/** The client the Code view and Settings use on this page. */
export function pageIdeClient(): IdeClient {
  if (pageClient) return pageClient;
  const kind = ideFixture();
  pageClient = kind ? fixtureIdeClient(kind) : serviceIdeClient;
  return pageClient;
}
