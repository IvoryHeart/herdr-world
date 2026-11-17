import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { shQuote } from "../utils/process-utils";
import { CoreUnavailableError } from "./client";

/** Core writes the live socket path into `<state>/core.lock` when it serves. */
export const CORE_LOCK_FILE = "core.lock";
const MAX_LOCK_BYTES = 4096;

export class CoreEndpointRefusedError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = "CoreEndpointRefusedError";
  }
}

/** Where a core keeps its state: `$XDG_STATE_HOME/herdr-core/<session>`. */
export function defaultCoreStateDir(
  session: string,
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): string {
  const stateHome = env.XDG_STATE_HOME || join(home, ".local", "state");
  return join(stateHome, "herdr-core", session);
}

function parseLock(text: string, where: string): string {
  // The lock holds raw path bytes, no newline; tolerate one trailing newline.
  const path = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (
    !path ||
    !isAbsolute(path) ||
    path.includes("\0") ||
    /[\r\n]/.test(path) ||
    Buffer.byteLength(path) > 1024
  )
    throw new CoreEndpointRefusedError(`${where} does not name a socket`);
  return path;
}

/**
 * Reads the endpoint a local core last served on. The lock persists after a
 * stop, so a named socket that is gone simply means the core is not running.
 * The socket's directory must be ours and private, or the endpoint is refused.
 */
export function resolveLocalCoreEndpoint(
  stateDir: string,
  dependencies: {
    lstat?: typeof lstatSync;
    readFile?: (path: string) => Buffer;
    uid?: number;
  } = {},
): string {
  const lstat = dependencies.lstat ?? lstatSync;
  const read = dependencies.readFile ?? ((path: string) => readFileSync(path));
  const uid = dependencies.uid ?? process.getuid?.() ?? -1;
  const lock = join(stateDir, CORE_LOCK_FILE);
  let lockStat: ReturnType<typeof lstatSync>;
  try {
    lockStat = lstat(lock);
  } catch (error) {
    throw new CoreUnavailableError(
      "no herdr-core has run with this state directory",
      { cause: error },
    );
  }
  if (!lockStat.isFile() || lockStat.size > MAX_LOCK_BYTES)
    throw new CoreEndpointRefusedError("core.lock is not a regular file");
  if (uid >= 0 && lockStat.uid !== uid)
    throw new CoreEndpointRefusedError("core.lock belongs to another user");
  const socket = parseLock(read(lock).toString("utf8"), "core.lock");
  const directory = dirname(socket);
  let directoryStat: ReturnType<typeof lstatSync>;
  try {
    directoryStat = lstat(directory);
  } catch (error) {
    throw new CoreUnavailableError("herdr-core is not running", {
      cause: error,
    });
  }
  if (
    !directoryStat.isDirectory() ||
    (uid >= 0 && directoryStat.uid !== uid) ||
    (directoryStat.mode & 0o077) !== 0
  )
    throw new CoreEndpointRefusedError(
      "the core socket directory must be private to this user (mode 0700)",
    );
  let socketStat: ReturnType<typeof lstatSync>;
  try {
    socketStat = lstat(socket);
  } catch (error) {
    throw new CoreUnavailableError("herdr-core is not running", {
      cause: error,
    });
  }
  if (!socketStat.isSocket())
    throw new CoreEndpointRefusedError("core.lock does not name a socket");
  return socket;
}

/**
 * One plain POSIX shell command that reads the remote lock and checks the
 * socket directory. It runs `cat`, `ls` and `id` only: never `hc`, whose
 * `connect` and `server status` start a core.
 */
export function remoteCoreEndpointCommand(
  session: string,
  stateDir: string,
): string {
  if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/.test(session))
    throw new CoreEndpointRefusedError("invalid core session");
  const lock = stateDir
    ? shQuote(`${stateDir}/${CORE_LOCK_FILE}`)
    : `"\${XDG_STATE_HOME:-$HOME/.local/state}"/herdr-core/${session}/${CORE_LOCK_FILE}`;
  return [
    `lock=${lock}`,
    `[ -f "$lock" ] && [ ! -L "$lock" ] || exit 3`,
    `sock=$(cat -- "$lock") || exit 3`,
    `dir=$(dirname -- "$sock")`,
    `[ -d "$dir" ] && [ ! -L "$dir" ] || exit 5`,
    `set -- $(ls -ldn -- "$dir")`,
    `[ "$3" = "$(id -u)" ] || exit 4`,
    `case "$1" in drwx------*) ;; *) exit 4;; esac`,
    `[ -S "$sock" ] || exit 5`,
    `printf '%s' "$sock"`,
  ].join("; ");
}

/** Maps the remote command's exit status to World's endpoint errors. */
export function remoteCoreEndpointResult(code: number, stdout: string): string {
  if (code === 3)
    throw new CoreUnavailableError(
      "no herdr-core has run with this state directory on the host",
    );
  if (code === 4)
    throw new CoreEndpointRefusedError(
      "the remote core socket directory must be private (mode 0700)",
    );
  if (code === 5)
    throw new CoreUnavailableError("herdr-core is not running on the host");
  if (code !== 0)
    throw new CoreUnavailableError(
      `reading the remote core.lock failed (${code})`,
    );
  const socket = parseLock(stdout, "the remote core.lock");
  if (!/^\/[\x21-\x7e]+$/.test(socket) || /[:\\\s]/.test(socket))
    throw new CoreEndpointRefusedError(
      "the remote core socket path cannot be forwarded",
    );
  return socket;
}
