import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

/**
 * Installed web IDE servers World can call (#1009, design #988). Each is a
 * distinct provider: World never swaps one for another, never installs one
 * and never bundles one. Detection only looks for files and asks the binary
 * for its version; it never starts a server.
 */
export type IdeProviderId = "vscode" | "code-server" | "openvscode";

export const IDE_PROVIDER_IDS: readonly IdeProviderId[] = [
  "vscode",
  "code-server",
  "openvscode",
];

export type IdeProviderInfo = {
  id: IdeProviderId;
  label: string;
  /** Where its extensions come from: the user's expectation differs. */
  marketplace: "Microsoft Marketplace" | "Open VSX";
  /** Upstream terms the owner accepts before the first start, if any. */
  terms: { label: string; url: string }[];
  /** Where to install it when it is missing. */
  setupUrl: string;
  /**
   * Whether its webviews (Markdown preview, extension panels) load inside
   * World. code-server serves them under its own route. Stock VS Code and
   * OpenVSCode Server frame them from `*.vscode-cdn.net`, the template in
   * their product.json; World's frame policy keeps those frames out, since
   * the Code view never admits another origin and World never rewrites the
   * product's own files (#988). The rest of the workbench works.
   */
  webviewsInWorld: boolean;
  /**
   * Whether its workbench connects only from a secure page (HTTPS or
   * localhost). Microsoft's VS Code signs its connection with code that
   * needs the browser's crypto.subtle, which plain-HTTP LAN and Tailscale
   * addresses don't have; its server then refuses the workbench. The open
   * builds don't sign.
   */
  needsSecurePage: boolean;
};

export const IDE_PROVIDERS: Record<IdeProviderId, IdeProviderInfo> = {
  vscode: {
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
    webviewsInWorld: false,
    needsSecurePage: true,
  },
  "code-server": {
    id: "code-server",
    label: "code-server",
    marketplace: "Open VSX",
    terms: [],
    setupUrl: "https://coder.com/docs/code-server/install",
    webviewsInWorld: true,
    needsSecurePage: false,
  },
  openvscode: {
    id: "openvscode",
    label: "OpenVSCode Server",
    marketplace: "Open VSX",
    terms: [],
    setupUrl: "https://github.com/gitpod-io/openvscode-server#getting-started",
    webviewsInWorld: false,
    needsSecurePage: false,
  },
};

export function isIdeProviderId(value: unknown): value is IdeProviderId {
  return (
    typeof value === "string" &&
    (IDE_PROVIDER_IDS as readonly string[]).includes(value)
  );
}

export type IdeDetection =
  | {
      provider: IdeProviderId;
      state: "detected";
      /** The executable World runs; shown so the owner knows which one. */
      path: string;
      version: string | null;
      /** True when the path came from the owner's setting, not discovery. */
      configured: boolean;
    }
  | {
      provider: IdeProviderId;
      state: "missing" | "unsupported";
      reason: string;
      path?: string;
      configured: boolean;
    };

export type IdeDetectEnvironment = {
  platform: string;
  /** PATH lookup in the service's own environment. */
  which(name: string): string | null;
  exists(path: string): boolean;
  realpath(path: string): string;
  isExecutableFile(path: string): boolean;
  /** Runs `<path> --version` with a short timeout; null when it fails. */
  version(path: string): Promise<string | null>;
  homeDir: string;
};

const VERSION_TIMEOUT_MS = 5_000;

export function systemDetectEnvironment(
  environment: Record<string, string | undefined> = process.env,
  homeDir = process.env.HOME ?? "",
): IdeDetectEnvironment {
  return {
    platform: process.platform,
    which: (name) => Bun.which(name, { PATH: environment.PATH ?? "" }),
    exists: (path) => existsSync(path),
    realpath: (path) => realpathSync(path),
    isExecutableFile: (path) => {
      try {
        const stat = statSync(path);
        return stat.isFile() && (stat.mode & 0o111) !== 0;
      } catch {
        return false;
      }
    },
    version: (path) => probeVersion(path, environment),
    homeDir,
  };
}

async function probeVersion(
  path: string,
  environment: Record<string, string | undefined>,
): Promise<string | null> {
  try {
    const child = Bun.spawn([path, "--version"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      env: environment,
    });
    const timer = setTimeout(() => child.kill(), VERSION_TIMEOUT_MS);
    const [text, code] = await Promise.all([
      new Response(child.stdout).text(),
      child.exited,
    ]);
    clearTimeout(timer);
    if (code !== 0) return null;
    return parseIdeVersion(text);
  } catch {
    return null;
  }
}

/**
 * The version line each provider prints: `code 1.146.0 (commit …)` for the
 * VS Code CLI, `4.x.y <commit> with Code 1.z` for code-server and a bare
 * `1.x.y` first line for OpenVSCode Server.
 */
export function parseIdeVersion(text: string): string | null {
  const line = text.split(/\r?\n/).find((entry) => entry.trim() !== "");
  if (!line) return null;
  const match = /\d+\.\d+\.\d+/.exec(line);
  return match ? match[0] : null;
}

/**
 * Where an installed Microsoft VS Code keeps its CLI (`code-tunnel`), which
 * runs `serve-web`. The `code` launcher itself is a script (or, for the
 * snap, the snap runner) that adds desktop flags `serve-web` refuses.
 */
function vscodeCliCandidates(env: IdeDetectEnvironment): string[] {
  const candidates: string[] = [];
  const launcher = env.which("code");
  if (launcher) {
    try {
      const real = env.realpath(launcher);
      if (basename(real) === "snap")
        candidates.push("/snap/code/current/usr/share/code/bin/code-tunnel");
      else candidates.push(join(dirname(real), "code-tunnel"));
    } catch {
      // A dangling launcher: try the usual places.
    }
  }
  const tunnel = env.which("code-tunnel");
  if (tunnel) candidates.push(tunnel);
  if (env.platform === "darwin") {
    for (const root of [
      "/Applications",
      env.homeDir ? join(env.homeDir, "Applications") : "",
    ].filter(Boolean))
      candidates.push(
        join(
          root,
          "Visual Studio Code.app/Contents/Resources/app/bin/code-tunnel",
        ),
      );
  } else {
    candidates.push(
      "/usr/share/code/bin/code-tunnel",
      "/snap/code/current/usr/share/code/bin/code-tunnel",
    );
  }
  return [...new Set(candidates)];
}

function candidatesFor(
  provider: IdeProviderId,
  env: IdeDetectEnvironment,
): string[] {
  if (provider === "vscode") return vscodeCliCandidates(env);
  const name = provider === "code-server" ? "code-server" : "openvscode-server";
  const found = env.which(name);
  return found ? [found] : [];
}

/**
 * Find one provider on the service's host. A configured path wins and is
 * never replaced by a discovered one: a broken setting says so.
 */
export async function detectIdeProvider(
  provider: IdeProviderId,
  env: IdeDetectEnvironment,
  configuredPath?: string | null,
): Promise<IdeDetection> {
  if (env.platform === "win32")
    return {
      provider,
      state: "unsupported",
      reason:
        "World can't run web IDE servers on Windows yet: open the folder in your desktop IDE.",
      configured: Boolean(configuredPath),
    };
  if (configuredPath) {
    if (!isAbsolute(configuredPath) || !env.isExecutableFile(configuredPath))
      return {
        provider,
        state: "missing",
        reason: "The configured program isn't an executable file.",
        path: configuredPath,
        configured: true,
      };
    return {
      provider,
      state: "detected",
      path: configuredPath,
      version: await env.version(configuredPath),
      configured: true,
    };
  }
  for (const candidate of candidatesFor(provider, env)) {
    if (!env.exists(candidate) || !env.isExecutableFile(candidate)) continue;
    return {
      provider,
      state: "detected",
      path: candidate,
      version: await env.version(candidate),
      configured: false,
    };
  }
  return {
    provider,
    state: "missing",
    reason: `${IDE_PROVIDERS[provider].label} isn't installed on this computer.`,
    configured: false,
  };
}

export type IdeLaunch = {
  /** Path prefix World serves it under, without a trailing slash. */
  basePath: string;
  socketPath: string;
  tokenFile: string;
  folder: string;
};

/**
 * The fixed argument list per provider: never a template the browser can
 * extend. `acceptTerms` is only passed after the owner accepted them in
 * World's enable dialog.
 */
export function ideServerArgs(
  provider: IdeProviderId,
  launch: IdeLaunch,
): { args: string[]; stripsBasePath: boolean } {
  if (provider === "vscode")
    return {
      args: [
        "serve-web",
        "--socket-path",
        launch.socketPath,
        "--connection-token-file",
        launch.tokenFile,
        "--server-base-path",
        launch.basePath,
        "--default-folder",
        launch.folder,
        "--accept-server-license-terms",
      ],
      stripsBasePath: false,
    };
  if (provider === "openvscode")
    return {
      args: [
        "--socket-path",
        launch.socketPath,
        "--connection-token-file",
        launch.tokenFile,
        "--server-base-path",
        launch.basePath,
        "--default-folder",
        launch.folder,
      ],
      stripsBasePath: false,
    };
  // code-server serves relative URLs under any prefix; the socket sits in a
  // private folder, and World's own sign-in guards every request. Its port
  // proxies (`/proxy/<port>`, `/absproxy/<port>`) are off: the route
  // reaches the IDE only, never other local services.
  return {
    args: [
      "--socket",
      launch.socketPath,
      "--socket-mode",
      "600",
      "--auth",
      "none",
      "--disable-update-check",
      "--disable-proxy",
      launch.folder,
    ],
    stripsBasePath: true,
  };
}

/**
 * Paths World never forwards for a provider, HTTP or WebSocket, whatever
 * its flags: code-server's generic port proxies. Express matches routes
 * case-insensitively and decodes nothing, so compare the decoded, lowered
 * path with repeated slashes collapsed.
 */
export function ideBlockedPath(provider: IdeProviderId, rest: string) {
  if (provider !== "code-server") return false;
  let path: string;
  try {
    path = decodeURIComponent(rest);
  } catch {
    return true;
  }
  path = path.replace(/[\\/]+/g, "/").toLowerCase();
  return /^\/(abs)?proxy(\/|$)/.test(path);
}

/** Whether the provider expects World's connection-token cookie. */
export function ideUsesConnectionToken(provider: IdeProviderId) {
  return provider !== "code-server";
}
