import { isAbsolute } from "node:path";
import { shQuote } from "../utils/process-utils";
import { REMOTE_PATH } from "./host";
import {
  IDE_PROVIDERS,
  type IdeDetection,
  type IdeProviderId,
  parseIdeVersion,
} from "./providers";

/**
 * Detection of the IDE on the host a project is on, for projects over SSH
 * (#1009): read-only, through the connection's OpenSSH destination. World
 * then runs the host's own installed VS Code (or code-server / OpenVSCode
 * Server) there with the host scripts (host.ts) and reaches it the same way
 * as a local one: a private Unix socket World proxies under `/ide/<id>/` on
 * its one origin, which OpenSSH forwards (`-L local.sock:remote.sock`).
 * Nothing listens on a TCP port on either side.
 */

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
