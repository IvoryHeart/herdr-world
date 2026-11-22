import { shQuote } from "../utils/process-utils";
import {
  type IdeProviderId,
  ideServerArgs,
  isIdeProviderId,
} from "./providers";

/**
 * An IDE server's life on its host (#1009), the same on World's own
 * computer and on an SSH host: these scripts run under `sh` there, locally
 * or through the connection's OpenSSH destination.
 *
 * Going away is not stopping. The server runs detached from World and from
 * the ssh that started it, so closing Code, World restarting or updating,
 * SSH dropping and the host being unreachable leave it and everything under
 * it (builds, terminals, the extension host) running. Only Stop ends it.
 *
 * Identity on the host: one private folder per server under a 0700 root,
 * named with an ID World derives from its own World ID, the connection,
 * host, provider and folder. It holds `record` (which World, provider,
 * folder, connection, since when, and this launch's random nonce), the
 * access token, the server's Unix socket, its log, the supervisor's PID
 * and, once the server exits on its own, its exit code. `mkdir` of that
 * folder is the claim: a second start for the same folder finds it and
 * reports `running`, and World reattaches instead of starting another.
 *
 * Ownership: every process the launch starts inherits HERDR_WORLD_IDE=<nonce>
 * in its environment, including terminal shells in sessions of their own
 * and processes whose parent has already exited. Stop renames the folder
 * first (so a new start can't be mistaken for the old one), then ends every
 * process carrying the nonce and every descendant of one: SIGTERM, a
 * bounded wait, SIGKILL, a last sweep, keeping each process it has seen.
 * A process that clears its own environment and leaves the tree is the
 * only one it can miss.
 *
 * A small supervisor waits on the server. If the server exits on its own
 * the supervisor records the exit code and ends what it left behind; the
 * folder stays so World can say why, until the next start or Stop.
 */

/**
 * Common install places a non-login `sh` on the host may not have on PATH:
 * the standalone CLI and code-server's installer use ~/.local/bin, Homebrew
 * /opt/homebrew/bin.
 */
export const REMOTE_PATH = `PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"`;

/** Where an SSH host keeps World's IDE servers. */
export const REMOTE_IDE_ROOT =
  "${XDG_STATE_HOME:-$HOME/.local/state}/herdr-world/ide";

/** Exit codes of the host scripts, for a plain reason. */
export const HOST_EXIT = {
  dir: 90,
  token: 91,
  folder: 92,
  /** A Stop or a look voided this start before it claimed the folder. */
  voided: 93,
} as const;

/** How long the host lets the server's processes stop after SIGTERM. */
export const HOST_STOP_GRACE_MS = 5_000;

const ID = /^[A-Za-z0-9_-]{16,64}$/;

export function validHostId(id: string) {
  if (!ID.test(id)) throw new Error("invalid IDE server ID");
  return id;
}

/** Where the scripts keep servers: a local absolute path, or the SSH default. */
export type IdeHostRoot = { path: string } | { remote: true };

function rootLine(root: IdeHostRoot) {
  return "path" in root
    ? `root=${shQuote(root.path)}`
    : `root="${REMOTE_IDE_ROOT}"`;
}

/**
 * Shared by every script and the supervisor. `marked` prints the PIDs
 * whose environment carries the nonce in $1 (only the user's own processes
 * are readable). `owned` prints the running PIDs among $1 and all their
 * descendants, never $2 or its own children (the caller and its command
 * substitutions). `end_all` stops them with escalation.
 */
function functions(stopGraceMs: number) {
  const rounds = Math.max(1, Math.ceil(stopGraceMs / 200));
  return [
    "nap() { sleep 0.2 2>/dev/null || sleep 1; }",
    "marked() {",
    '  [ -n "$1" ] || return 0',
    "  if [ -r /proc/self/environ ]; then",
    '    { grep -alF "HERDR_WORLD_IDE=$1" /proc/[0-9]*/environ 2>/dev/null || grep -lF "HERDR_WORLD_IDE=$1" /proc/[0-9]*/environ 2>/dev/null; } | sed -n \'s|^/proc/\\([0-9][0-9]*\\)/environ$|\\1|p\'',
    "  else",
    // macOS: `ps -E` appends the environment. The name and the value go to
    // awk apart so its own command line never matches.
    '    ps -A -E -ww -o pid= -o command= 2>/dev/null | awk -v a="HERDR_WORLD_IDE=" -v b="$1" \'index($0, a b) { print $1 }\'',
    "  fi",
    "}",
    "owned() {",
    '  ps -A -o pid= -o ppid= -o stat= 2>/dev/null | awk -v roots="$1" -v self="$2" \'',
    "    { pid[NR] = $1; parent[NR] = $2; dead[NR] = ($3 ~ /^Z/); n = NR }",
    "    END {",
    '      k = split(roots, r, " "); for (i = 1; i <= k; i++) want[r[i]] = 1',
    "      delete want[self]",
    "      do { more = 0",
    "        for (i = 1; i <= n; i++) if (!(pid[i] in want) && (parent[i] in want) && parent[i] != self) { want[pid[i]] = 1; more = 1 }",
    "      } while (more)",
    '      for (i = 1; i <= n; i++) if ((pid[i] in want) && !dead[i] && pid[i] > 1 && pid[i] != self && parent[i] != self) printf "%s ", pid[i]',
    "    }'",
    "}",
    "end_all() {",
    '  s=$(owned "$(marked "$1")" "$2")',
    '  [ -n "$s" ] && kill -TERM $s 2>/dev/null',
    "  i=0",
    `  while [ -n "$s" ] && [ $i -lt ${rounds} ]; do nap; i=$((i + 1)); s=$(owned "$s $(marked "$1")" "$2"); done`,
    '  if [ -n "$s" ]; then kill -KILL $s 2>/dev/null; nap; s=$(owned "$s $(marked "$1")" "$2"); [ -n "$s" ] && kill -KILL $s 2>/dev/null; fi',
    "  return 0",
    "}",
    "nonce_of() { sed -n 's/^nonce=//p' \"$1/record\" 2>/dev/null; }",
    // starting: claimed, its launch not yet marked; running; exited: nothing left.
    "state_of() {",
    '  if [ ! -f "$1/pid" ]; then echo starting',
    '  elif [ -n "$(marked "$(nonce_of "$1")")" ]; then echo running',
    "  else echo exited; fi",
    "}",
  ].join("\n");
}

/**
 * `missing` is what a script that only looks prints when World has never
 * kept a server on this host; only a start creates the root.
 */
function prelude(
  root: IdeHostRoot,
  stopGraceMs: number,
  missing: string | null = null,
) {
  return [
    "umask 077",
    REMOTE_PATH,
    rootLine(root),
    missing === null
      ? // The user's own private folder, never a link or someone else's.
        'mkdir -p "$root" 2>/dev/null; chmod 700 "$root" 2>/dev/null'
      : `if [ ! -e "$root" ] && [ ! -L "$root" ]; then ${missing || ":"}; exit 0; fi`,
    `if [ ! -d "$root" ] || [ -L "$root" ] || [ ! -O "$root" ]; then exit ${HOST_EXIT.dir}; fi`,
    'printf "root=%s\\n" "$root"',
    functions(stopGraceMs),
    // Begin marks (`.begin-<id>-<pid>`) are starts not yet answered; Stop
    // leaves `.stop-<id>-<pid>` until every process is ended.
    'unbegin() { rmdir "$root"/.begin-"$1"-* 2>/dev/null; return 0; }',
    'stop_left() { for x in "$root"/.stop-"$1"-*; do [ -d "$x" ] && return 0; done; return 1; }',
  ].join("\n");
}

/**
 * Runs as `sh -c <this> hw-ide <folder> <nonce> <program> <args…>`, with
 * the nonce in its environment, detached from World and the ssh session.
 */
function supervisor(stopGraceMs: number) {
  return [
    functions(stopGraceMs),
    "d=$1 n=$2; shift 2",
    // Stopped before it began: the folder is no longer this launch's.
    '[ "$(nonce_of "$d")" = "$n" ] || exit 0',
    '"$@" </dev/null >>"$d/log" 2>&1 &',
    "p=$!",
    'wait "$p"',
    "c=$?",
    'if [ "$(nonce_of "$d")" = "$n" ]; then printf "%s\\n" "$c" > "$d/exit"; rm -f "$d/ide.sock"; fi',
    'end_all "$n" "$$"',
  ].join("\n");
}

const SOCKET = "\u0000socket";
const TOKEN = "\u0000token";

export type IdeHostStart = {
  root: IdeHostRoot;
  id: string;
  worldId: string;
  connectionId: string;
  provider: IdeProviderId;
  /** The program found on the host. */
  binary: string;
  basePath: string;
  folder: string;
  startedAt: string;
  /** Random, fresh for this launch: the processes' ownership mark. */
  nonce: string;
  /** Whether the server's token arrives on stdin. */
  token: boolean;
  /**
   * Leave World's systemd cgroup through a transient user scope, so a
   * restart of World's own service doesn't end the server.
   */
  systemdScope?: boolean;
  stopGraceMs?: number;
};

function recordValue(value: string) {
  if (/[\u0000-\u001f\u007f]/.test(value))
    throw new Error("IDE record values are single-line text");
  return value;
}

/**
 * Claims the folder and launches the server detached, or reports the one
 * already there. Prints `root=` and `result=started|running`.
 */
export function hostStartScript(start: IdeHostStart) {
  const stopGraceMs = start.stopGraceMs ?? HOST_STOP_GRACE_MS;
  validHostId(start.id);
  validHostId(start.nonce);
  const { args } = ideServerArgs(start.provider, {
    basePath: start.basePath,
    socketPath: SOCKET,
    tokenFile: TOKEN,
    folder: start.folder,
  });
  const command = [start.binary, ...args]
    .map((word) =>
      word === SOCKET
        ? '"$d/ide.sock"'
        : word === TOKEN
          ? '"$d/token"'
          : shQuote(word),
    )
    .join(" ");
  const record = [
    ["world", start.worldId],
    ["provider", start.provider],
    ["folder", start.folder],
    ["connection", start.connectionId],
    ["started", start.startedAt],
    ["nonce", start.nonce],
  ]
    .map(
      ([key, value]) =>
        `printf '%s\\n' ${shQuote(`${key}=${recordValue(value)}`)}`,
    )
    .join("; ");
  return [
    prelude(start.root, stopGraceMs),
    `d="$root"/${start.id}`,
    // The begin mark lists this start as pending until it is answered. A
    // Stop or a look voids it, so a start whose answer was lost never
    // launches after them. Another start leaves it: two starts for one
    // folder meet at the claim below, where one launches and the other
    // finds it running.
    `b="$root/.begin-${start.id}-$$"`,
    `mkdir "$b" 2>/dev/null || exit ${HOST_EXIT.voided}`,
    `trap 'rmdir "$b" 2>/dev/null' EXIT`,
    `cd ${shQuote(start.folder)} || exit ${HOST_EXIT.folder}`,
    // An unfinished Stop: report it there, so World looks and says so.
    `if stop_left ${start.id}; then echo result=running; exit 0; fi`,
    'if ! mkdir "$d" 2>/dev/null; then',
    '  if [ "$(state_of "$d")" != exited ]; then echo result=running; exit 0; fi',
    // It exited (or the host restarted): clear it, then claim afresh.
    `  g="$root/.gone-${start.id}-$$"`,
    '  mv "$d" "$g" 2>/dev/null && rm -rf "$g"',
    '  mkdir "$d" 2>/dev/null || { echo result=running; exit 0; }',
    "fi",
    // Claimed; now spend the begin mark. Voided meanwhile: give the claim
    // back (the claim is still empty here).
    `rmdir "$b" 2>/dev/null || { rmdir "$d" 2>/dev/null; exit ${HOST_EXIT.voided}; }`,
    `n=${shQuote(start.nonce)}`,
    // This launch's own files, then the record linked into place: `ln`
    // fails once a record is there, so if another start took the folder
    // over meanwhile exactly one of them launches and the other reports
    // the server running, without either clobbering the other's token.
    ...(start.token
      ? [
          `IFS= read -r t || { rm -rf "$d"; exit ${HOST_EXIT.token}; }`,
          `printf '%s' "$t" > "$d/token.$n" || { [ -d "$d" ] || { echo result=running; exit 0; }; rm -rf "$d"; exit ${HOST_EXIT.token}; }`,
          "t=",
        ]
      : []),
    `{ ${record}; } > "$d/record.$n" || { [ -d "$d" ] || { echo result=running; exit 0; }; rm -rf "$d"; exit ${HOST_EXIT.dir}; }`,
    'if ! ln "$d/record.$n" "$d/record" 2>/dev/null; then rm -f "$d/record.$n" "$d/token.$n"; echo result=running; exit 0; fi',
    'rm -f "$d/record.$n"',
    ...(start.token
      ? [
          `mv "$d/token.$n" "$d/token" || { rm -rf "$d"; exit ${HOST_EXIT.token}; }`,
        ]
      : []),
    // A session of its own (`setsid` doesn't fork here: a background job
    // is never a group leader), else a process group, else as it is.
    "if command -v setsid >/dev/null 2>&1; then set -- setsid",
    "elif command -v perl >/dev/null 2>&1; then set -- perl -e 'setpgrp(0, 0); exec { $ARGV[0] } @ARGV or exit 127'",
    "else set --; fi",
    ...(start.systemdScope
      ? [
          'if command -v systemd-run >/dev/null 2>&1 && systemd-run --user --scope --quiet --collect true >/dev/null 2>&1; then set -- systemd-run --user --scope --quiet --collect -- "$@"; fi',
        ]
      : []),
    `HERDR_WORLD_IDE="$n" "$@" sh -c ${shQuote(supervisor(stopGraceMs))} hw-ide "$d" "$n" ${command} </dev/null >>"$d/log" 2>&1 &`,
    "p=$!",
    // Until the launch carries its mark (fork to exec), a second start
    // would read a written PID with no marked process as exited and take
    // the folder over: write the PID once it is marked or has ended (a
    // zombie too: this script is its parent and never waits for it).
    'i=0; while [ -z "$(marked "$n")" ] && [ $i -lt 25 ]; do case "$(ps -o stat= -p "$p" 2>/dev/null)" in ""|*Z*) break ;; esac; nap; i=$((i + 1)); done',
    'printf "%s\\n" "$p" > "$d/pid"',
    "echo result=started",
  ].join("\n");
}

export type IdeHostAttach = {
  root: IdeHostRoot;
  id: string;
  worldId: string;
  provider: IdeProviderId;
  folder: string;
  stopGraceMs?: number;
};

/**
 * Checks that the folder's server is this World's, for this provider and
 * folder, and prints its state, since-when, exit code, the token and how
 * many server downloads VS Code began while it runs, and the end of its
 * log once it has exited. Starts nothing.
 */
export function hostAttachScript(attach: IdeHostAttach) {
  validHostId(attach.id);
  const expect = (key: string, value: string) =>
    `grep -qxF ${shQuote(`${key}=${recordValue(value)}`)} "$d/record"`;
  return [
    prelude(
      attach.root,
      attach.stopGraceMs ?? HOST_STOP_GRACE_MS,
      "echo state=gone",
    ),
    `d="$root"/${attach.id}`,
    // Looking voids an unanswered start: what it shows stays true.
    `unbegin ${attach.id}`,
    `[ -f "$d/record" ] || { if [ -d "$d" ]; then echo state=starting; elif stop_left ${attach.id}; then echo state=stopping; else echo state=gone; fi; exit 0; }`,
    `${expect("world", attach.worldId)} && ${expect("provider", attach.provider)} && ${expect("folder", attach.folder)} || { echo state=foreign; exit 0; }`,
    'st=$(state_of "$d")',
    'echo "state=$st"',
    "sed -n '/^started=/p' \"$d/record\"",
    '[ -f "$d/exit" ] && printf "exit=%s\\n" "$(head -n 1 "$d/exit")"',
    'if [ "$st" != exited ] && [ -f "$d/token" ]; then printf "token=%s\\n" "$(cat "$d/token")"; fi',
    // VS Code's CLI logs one line per attempt to download its web server
    // and never says why one failed: the count shows it retrying.
    'if [ "$st" != exited ]; then printf "downloads=%s\\n" "$(grep -c "Downloading server [0-9a-f]" "$d/log" 2>/dev/null)"; fi',
    'if [ "$st" = exited ]; then tail -n 20 "$d/log" 2>/dev/null | tr -d "\\r" | sed "s/^/log=/"; fi',
  ].join("\n");
}

/** Lists this World's servers on the host. Starts nothing. */
export function hostListScript(
  root: IdeHostRoot,
  worldId: string,
  stopGraceMs = HOST_STOP_GRACE_MS,
) {
  return [
    prelude(root, stopGraceMs, ""),
    // `pending=` names one that may yet run: a start not yet answered or
    // a claim without its record, or a Stop not finished.
    'for x in "$root"/.begin-* "$root"/.stop-*; do',
    '  [ -d "$x" ] || continue',
    '  y=${x##*/}; y=${y#.begin-}; y=${y#.stop-}; printf "pending=%s\\n" "${y%-*}"',
    "done",
    'for d in "$root"/*; do',
    '  [ -f "$d/record" ] || { [ -d "$d" ] && printf "pending=%s\\n" "${d##*/}"; continue; }',
    `  grep -qxF ${shQuote(`world=${recordValue(worldId)}`)} "$d/record" || continue`,
    '  printf "id=%s\\n" "${d##*/}"',
    "  grep -E '^(provider|folder|connection|started)=' \"$d/record\"",
    '  printf "state=%s\\n" "$(state_of "$d")"',
    '  [ -f "$d/exit" ] && printf "exit=%s\\n" "$(head -n 1 "$d/exit")"',
    "  echo end",
    "done",
    "exit 0",
  ].join("\n");
}

/**
 * Stops one server completely, and finishes any Stop of it that didn't.
 * Prints `result=stopped`, or `result=gone` when there is nothing (left)
 * to stop.
 */
export function hostStopScript(
  root: IdeHostRoot,
  id: string,
  worldId: string,
  stopGraceMs = HOST_STOP_GRACE_MS,
) {
  validHostId(id);
  return [
    prelude(root, stopGraceMs, "echo result=gone"),
    `d="$root"/${id}`,
    `unbegin ${id}`,
    `if [ -f "$d/record" ] && ! grep -qxF ${shQuote(`world=${recordValue(worldId)}`)} "$d/record"; then echo result=foreign; exit 0; fi`,
    `[ -d "$d" ] && mv "$d" "$root/.stop-${id}-$$" 2>/dev/null`,
    "r=gone",
    `for g in "$root"/.stop-${id}-*; do`,
    '  [ -d "$g" ] || continue',
    '  n=$(nonce_of "$g")',
    '  [ -n "$n" ] && end_all "$n" "$$"',
    '  rm -rf "$g"; r=stopped',
    "done",
    'echo "result=$r"',
  ].join("\n");
}

/**
 * What a person runs on the SSH host to stop one server World can no longer
 * reach (its connection was removed): it ends the
 * supervisor's process group, which holds the server and what it started
 * there, then removes World's folder for it. Terminals the IDE opened in
 * sessions of their own may need closing too.
 */
export function hostStopByHand(id: string) {
  validHostId(id);
  // `-s TERM --` works in dash, bash and zsh alike. Without a group of its
  // own (a host with neither setsid nor perl) only the supervisor gets the
  // signal, and the IDE under it needs ending by name.
  // It voids an unanswered start first and covers an unfinished Stop too.
  return `r="${REMOTE_IDE_ROOT}"; rmdir "$r"/.begin-${id}-* 2>/dev/null; for d in "$r/${id}" "$r"/.stop-${id}-*; do [ -d "$d" ] || continue; p=$(cat "$d/pid" 2>/dev/null) && { kill -s TERM -- "-$p" 2>/dev/null || kill -s TERM "$p"; }; rm -rf "$d"; done`;
}

/** `key=value` lines into a map; later keys win, `log=` lines collect. */
export function parseHostLines(stdout: string) {
  const values = new Map<string, string>();
  const log: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index);
    const value = line.slice(index + 1);
    if (key === "log") log.push(value);
    else values.set(key, value);
  }
  return { values, log };
}

export type IdeHostState = "starting" | "running" | "exited";

export type IdeHostRecord = {
  id: string;
  provider: IdeProviderId;
  folder: string;
  connectionId: string;
  startedAt: string;
  state: IdeHostState;
  exitCode?: number;
};

export function parseHostList(stdout: string): IdeHostRecord[] {
  const records: IdeHostRecord[] = [];
  let current: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    if (line === "end") {
      const { id, provider, folder, connection, started, state } = current;
      if (
        id &&
        ID.test(id) &&
        provider &&
        isIdeProviderId(provider) &&
        folder?.startsWith("/") &&
        connection &&
        (state === "starting" || state === "running" || state === "exited")
      )
        records.push({
          id,
          provider,
          folder,
          connectionId: connection,
          startedAt: started ?? "",
          state,
          ...(current.exit && /^\d+$/.test(current.exit)
            ? { exitCode: Number(current.exit) }
            : {}),
        });
      current = {};
      continue;
    }
    const index = line.indexOf("=");
    if (index > 0) current[line.slice(0, index)] = line.slice(index + 1);
  }
  return records;
}

/** IDs a list names as possibly running without a record yet (`pending=`). */
export function parseHostPending(stdout: string) {
  const pending = new Set<string>();
  for (const line of stdout.split(/\r?\n/))
    if (line.startsWith("pending=") && ID.test(line.slice(8)))
      pending.add(line.slice(8));
  return pending;
}

export function plainExitReason(lines: string[], code: number | null) {
  const last = [...lines]
    .reverse()
    .find((line) => /error|fail|denied|unable|not /i.test(line));
  const suffix = last ? `: ${last.trim().slice(0, 240)}` : ".";
  return `The IDE server stopped${code === null ? "" : ` (exit ${code})`}${suffix}`;
}

/**
 * Why World stopped waiting for a server that still runs. VS Code's CLI
 * retries a failed download of its web server on the next request and
 * never says why it failed; `downloads` counts its attempts.
 */
export function startWaitReason(
  hostLabel: string,
  why: "timeout" | "downloading" | { downloads: number },
) {
  if (why === "timeout")
    return `It didn't answer in time and still runs on ${hostLabel}. Open it to try again, or Stop it.`;
  if (why === "downloading")
    return `It is still downloading VS Code's web server on ${hostLabel} (about 300 MB). Open it again in a minute, or Stop it.`;
  return `VS Code couldn't download its web server on ${hostLabel}; it tried ${why.downloads} times. It needs about 1 GB free in your home folder and access to update.code.visualstudio.com. Check both, then Open it to try again.`;
}

/** Exit codes a start script gives only before it launches anything. */
export const definiteStartFailure = (code: number | null) =>
  [HOST_EXIT.dir, HOST_EXIT.token, HOST_EXIT.folder, HOST_EXIT.voided].some(
    (c) => c === code,
  );

export function hostFailure(
  code: number | null,
  hostLabel: string,
  remote: boolean,
) {
  if (code === HOST_EXIT.dir)
    return `World couldn't use its private folder on ${hostLabel}.`;
  if (code === HOST_EXIT.token)
    return `World couldn't hand the IDE its access token on ${hostLabel}.`;
  if (code === HOST_EXIT.folder)
    return `The project folder doesn't exist on ${hostLabel}.`;
  if (code === HOST_EXIT.voided)
    return `It was stopped or looked at on ${hostLabel} before it started. Open it again.`;
  if (remote && (code === 255 || code === null))
    return `World couldn't reach ${hostLabel} over SSH. Check the connection, then try again.`;
  return `World couldn't run its IDE helper on ${hostLabel}${code === null ? "" : ` (exit ${code})`}.`;
}
