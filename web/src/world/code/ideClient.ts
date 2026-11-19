/**
 * The Code view's client for World's installed-IDE integration
 * (`world.ide.*`). Shapes mirror server/src/ide/service.ts; anything the
 * service sends that does not parse is treated as missing, never guessed.
 *
 * Testing switch: open World with `?ideFixture=<state>` and the Code view
 * shows that state from synthetic data instead of the service's:
 * `missing` (no IDE installed), `detected` (installed, not enabled),
 * `ssh` (the project is on an SSH host), `downloading` (first start) or
 * `failed` (the server exited). Nothing is detected, started or stored.
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
  state: "starting" | "ready" | "failed";
  url: string;
  startedAt: string;
  reason?: string;
  downloading?: boolean;
};

export type IdeStatus = {
  providers: IdeProviderStatus[];
  instances: IdeInstance[];
  /** Connections on World's own computer; others get the SSH handoff. */
  localConnections: string[];
};

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
  handoff?: { command: string; url: string };
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
  /** Calls back when the service says status or servers changed. */
  subscribe(changed: () => void): () => void;
};

const PROVIDERS = new Set<string>(["vscode", "code-server", "openvscode"]);
const INSTANCE_STATES = new Set<string>(["starting", "ready", "failed"]);
const REFUSALS = new Set<string>([
  "remote",
  "windows",
  "stale",
  "unknown-connection",
  "folder",
  "disabled",
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
  const handoff =
    refusal &&
    record(refusal.handoff) &&
    text(refusal.handoff.command) &&
    text(refusal.handoff.url) &&
    refusal.handoff.url.startsWith("vscode://")
      ? { command: refusal.handoff.command, url: refusal.handoff.url }
      : undefined;
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
      ...(handoff ? { handoff } : {}),
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
  | "failed";
const FIXTURES = new Set<string>([
  "missing",
  "detected",
  "ssh",
  "downloading",
  "failed",
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
  enabled: boolean,
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
    enabled,
    trustedAt: enabled ? new Date(0).toISOString() : null,
    termsAcceptedAt: enabled ? new Date(0).toISOString() : null,
    binary: null,
  },
  {
    id: "code-server",
    label: "code-server",
    marketplace: "Open VSX",
    terms: [],
    setupUrl: "https://coder.com/docs/code-server/install",
    detection: {
      state: "missing",
      reason: "code-server isn't installed on this computer.",
      configured: false,
    },
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
  let enabled = kind !== "missing" && kind !== "detected";
  let providers = FIXTURE_PROVIDERS(
    kind === "missing" ? "missing" : "detected",
    enabled,
  );
  let instances: IdeInstance[] = [];
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
    enable: async () => {
      if (kind === "missing") throw new Error("VS Code isn't installed.");
      enabled = true;
      providers = FIXTURE_PROVIDERS("detected", true);
      changed();
      return status();
    },
    disable: async () => {
      enabled = false;
      providers = FIXTURE_PROVIDERS(
        kind === "missing" ? "missing" : "detected",
        false,
      );
      instances = [];
      changed();
      return status();
    },
    configure: async () => status(),
    open: async (request) => {
      if (!enabled)
        return {
          ok: false,
          refusal: {
            code: "disabled",
            message: "Enable an IDE in the Code view first.",
          },
        };
      if (kind === "ssh")
        return {
          ok: false,
          refusal: {
            code: "remote",
            message:
              "This project is on devbox, over SSH. World runs VS Code in the browser only for projects on its own computer for now: open it in desktop VS Code with Remote-SSH.",
            handoff: {
              command: `code --remote ssh-remote+devbox.example '${request.folder}'`,
              url: `vscode://vscode-remote/ssh-remote+devbox.example${request.folder}`,
            },
          },
        };
      const instance: IdeInstance = {
        id: "fixtureFixtureFixture0",
        provider: "vscode",
        connectionId: request.connectionId,
        folder: request.folder,
        state: kind === "failed" ? "failed" : "starting",
        url: "/ide/fixtureFixtureFixture0/",
        startedAt: new Date().toISOString(),
        ...(kind === "failed"
          ? {
              reason:
                "VS Code stopped: error: the server could not bind its socket",
            }
          : kind === "downloading"
            ? { downloading: true }
            : {}),
      };
      instances = [instance];
      changed();
      return { ok: true, instance };
    },
    stop: async () => {
      instances = [];
      changed();
      return status();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

let pageClient: IdeClient | undefined;

/** The client the Code view and Settings use on this page. */
export function pageIdeClient(): IdeClient {
  if (pageClient) return pageClient;
  const kind = ideFixture();
  pageClient = kind ? fixtureIdeClient(kind) : serviceIdeClient;
  return pageClient;
}
