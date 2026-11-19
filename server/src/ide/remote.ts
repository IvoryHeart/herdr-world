import { isAbsolute } from "node:path";
import {
  SSH_NONINTERACTIVE_ARGS,
  validateSshDestination,
} from "../bridge/ssh-command";
import { shQuote } from "../utils/process-utils";
import {
  IDE_PROVIDERS,
  type IdeDetection,
  type IdeProviderId,
  ideServerArgs,
  parseIdeVersion,
} from "./providers";

/**
 * The IDE of the host a project is on, for projects over SSH (#1009). World
 * runs the host's own installed VS Code (or code-server / OpenVSCode Server)
 * there, through the connection's OpenSSH destination, and reaches it the
 * same way as a local one: a private Unix socket World proxies under
 * `/ide/<instance>/` on its one origin. OpenSSH forwards that socket
 * (`-L local.sock:remote.sock`); nothing listens on a TCP port on either
 * side and no other origin is involved.
 *
 * On the host the server's socket and token sit in a folder World creates
 * with mode 0700 under /tmp, named with the instance's random ID; `mkdir`
 * without `-p` refuses a folder someone else made first. The token travels
 * on stdin, never on a command line other users could read. World keeps
 * stdin open: when its ssh ends for any reason, the host sees end of input
 * and stops the server, and the folder is removed.
 */

/**
 * Common install places a non-login `sh` on the host may not have on PATH:
 * the standalone CLI and code-server's installer use ~/.local/bin, Homebrew
 * /opt/homebrew/bin.
 */
const REMOTE_PATH = `PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"`;

/**
 * Prints the program to run and its version line, or exits 3. Read-only:
 * it only looks at files and asks for `--version`. The program-path
 * setting is for World's own computer; on a host World finds it itself.
 */
export function remoteDetectScript(
  provider: IdeProviderId,
  /** Prefix for the fixed install places; tests point it at a scratch root. */
  systemRoot = "",
): string {
  const at = (path: string) => shQuote(`${systemRoot}${path}`);
  const lines = [
    REMOTE_PATH,
    "found=",
    'try_ide() { if [ -z "$found" ] && [ -n "$1" ] && [ -f "$1" ] && [ -x "$1" ]; then found=$1; fi; }',
  ];
  if (provider === "vscode")
    lines.push(
      // The desktop app's CLI runs serve-web; its `code` launcher is a
      // script (or the snap runner) whose desktop flags serve-web refuses.
      'try_ide "$(command -v code-tunnel 2>/dev/null)"',
      "l=$(command -v code 2>/dev/null)",
      `if [ -n "$l" ]; then r=$(readlink -f "$l" 2>/dev/null || printf %s "$l"); case "$r" in */snap) try_ide ${at("/snap/code/current/usr/share/code/bin/code-tunnel")} ;; *) try_ide "$(dirname "$r")/code-tunnel" ;; esac; fi`,
      `try_ide ${at("/usr/share/code/bin/code-tunnel")}`,
      `try_ide ${at("/snap/code/current/usr/share/code/bin/code-tunnel")}`,
      `try_ide ${at("/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code-tunnel")}`,
      `try_ide "$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code-tunnel"`,
      // The standalone VS Code CLI is itself `code`: it says `code 1.x (commit …)`.
      'if [ -z "$found" ] && [ -n "$l" ] && "$l" --version 2>/dev/null | head -n 1 | grep -q "^code "; then found=$l; fi',
    );
  else
    lines.push(
      `try_ide "$(command -v ${provider === "code-server" ? "code-server" : "openvscode-server"} 2>/dev/null)"`,
    );
  lines.push(
    '[ -n "$found" ] || exit 3',
    `printf '%s\\n' "$found"`,
    '"$found" --version 2>/dev/null | head -n 1',
  );
  return lines.join("\n");
}

/** The remote command for detection, run under `sh` whatever the login shell. */
export function remoteDetectCommand(provider: IdeProviderId) {
  return `sh -c ${shQuote(remoteDetectScript(provider))}`;
}

/** Reads the detect script's answer for one host. */
export function parseRemoteDetection(
  provider: IdeProviderId,
  hostLabel: string,
  result: { code: number; stdout: string },
): IdeDetection {
  const [path = "", versionLine = ""] = result.stdout.split(/\r?\n/);
  if (
    result.code === 0 &&
    isAbsolute(path) &&
    !/[\u0000-\u001f\u007f]/.test(path)
  )
    return {
      provider,
      state: "detected",
      path,
      version: parseIdeVersion(versionLine),
      configured: false,
    };
  if (result.code === 3)
    return {
      provider,
      state: "missing",
      reason: `${IDE_PROVIDERS[provider].label} isn't installed on ${hostLabel}. Install it there (for VS Code, the desktop app or the standalone code CLI), then open the project again.`,
      configured: false,
    };
  return {
    provider,
    state: "missing",
    reason: `World couldn't look for ${IDE_PROVIDERS[provider].label} on ${hostLabel} over SSH (exit ${result.code}). Check the connection, then try again.`,
    configured: false,
  };
}

/** Exit codes of the launch script, for a plain reason. */
export const REMOTE_EXIT = {
  dir: 90,
  token: 91,
  folder: 92,
} as const;

export type SshIdeLaunch = {
  destination: string;
  provider: IdeProviderId;
  /** The program found on the host. */
  binary: string;
  basePath: string;
  folder: string;
  /** World's private socket that OpenSSH forwards. */
  localSocket: string;
  /** Random, URL-safe: the host folder's name. */
  remoteId: string;
  /** Written on stdin; null for providers without a connection token. */
  token: string | null;
};

/** The launch script the host runs under `sh`. */
export function remoteLaunchScript(launch: SshIdeLaunch) {
  const dir = remoteRuntimeDir(launch.remoteId);
  const { args } = ideServerArgs(launch.provider, {
    basePath: launch.basePath,
    socketPath: `${dir}/ide.sock`,
    tokenFile: `${dir}/token`,
    folder: launch.folder,
  });
  const command = [launch.binary, ...args].map(shQuote).join(" ");
  return [
    "umask 077",
    REMOTE_PATH,
    `d=${shQuote(dir)}`,
    `mkdir "$d" || exit ${REMOTE_EXIT.dir}`,
    `trap 'rm -rf "$d"' EXIT`,
    "trap 'exit 143' HUP INT TERM",
    ...(launch.token
      ? [
          `IFS= read -r t || exit ${REMOTE_EXIT.token}`,
          `printf '%s' "$t" > "$d/token" || exit ${REMOTE_EXIT.token}`,
          "t=",
        ]
      : []),
    `cd ${shQuote(launch.folder)} || exit ${REMOTE_EXIT.folder}`,
    // Background lists read /dev/null unless told otherwise: keep World's
    // stdin on fd 3 for the watcher, which stops the server once it ends.
    "exec 3<&0",
    `${command} </dev/null 1>&2 &`,
    "p=$!",
    "trap 'kill \"$p\" 2>/dev/null; exit 143' HUP INT TERM",
    `(cat <&3 >/dev/null; kill "$p" 2>/dev/null) &`,
    'wait "$p"',
  ].join("\n");
}

export function remoteRuntimeDir(remoteId: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(remoteId))
    throw new Error("invalid remote IDE folder ID");
  return `/tmp/hw-ide-${remoteId}`;
}

/**
 * One long-lived ssh per IDE: its own connection (like the Windows
 * bridges, it never takes one of the destination's multiplexed session
 * slots), a single Unix socket forward, and the launch script. The local
 * socket only World's user can open; ssh exits if it cannot bind it.
 */
export function sshIdeArgv(launch: SshIdeLaunch): {
  argv: string[];
  stdin: string;
} {
  const remoteSocket = `${remoteRuntimeDir(launch.remoteId)}/ide.sock`;
  return {
    argv: [
      "ssh",
      ...SSH_NONINTERACTIVE_ARGS,
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "StreamLocalBindUnlink=yes",
      "-o",
      "StreamLocalBindMask=0177",
      "-L",
      `${launch.localSocket}:${remoteSocket}`,
      "--",
      validateSshDestination(launch.destination),
      `sh -c ${shQuote(remoteLaunchScript(launch))}`,
    ],
    stdin: launch.token ? `${launch.token}\n` : "",
  };
}

/** A plain reason for an ssh-launched server that exited. */
export function remoteExitReason(code: number | null, hostLabel: string) {
  if (code === REMOTE_EXIT.dir)
    return `World couldn't make its private folder on ${hostLabel}.`;
  if (code === REMOTE_EXIT.token)
    return `World couldn't hand the IDE its access token on ${hostLabel}.`;
  if (code === REMOTE_EXIT.folder)
    return `The project folder doesn't exist on ${hostLabel}.`;
  if (code === 255)
    return `SSH to ${hostLabel} failed or dropped. Check the connection, then try again.`;
  return null;
}
