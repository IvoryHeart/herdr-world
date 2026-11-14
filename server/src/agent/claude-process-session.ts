import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Claude Code's own record of the session one process runs, for Chat on a
 * runtime that reports no session (herdr-core).
 *
 * Claude Code registers every interactive process in
 * `${CLAUDE_CONFIG_DIR:-~/.claude}/sessions/<pid>.json` with its `pid`, the
 * `sessionId` it runs now (rewritten on every switch: `/clear`, `/resume`)
 * and `procStart`, the process's start time as the OS reports it: field 22
 * of `/proc/<pid>/stat` on Linux, `ps -o lstart=` (C locale, UTC) elsewhere.
 * A record is evidence for a process only while that start time is still
 * the live process's: a record left by a killed agent whose pid was reused
 * never names the new process's conversation.
 */

/**
 * This machine's Claude configuration directory as the host command below
 * resolves it in a child of this service: `$CLAUDE_CONFIG_DIR` when set and
 * non-empty, else `$HOME/.claude`. A transcript found by the record's ID is
 * looked up under the same directory.
 */
export function claudeConfigDirectory(
  env: Record<string, string | undefined> = process.env,
): string {
  return resolve(
    env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), ".claude"),
  );
}

/** Claude Code reads no more of a record than this. */
export const CLAUDE_PROCESS_RECORD_LIMIT = 262_144;

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/**
 * A POSIX shell program printing the live process's start time, the start
 * time again after reading its record, then the record: one line each for
 * the times, the rest is the record. Exit 44: no record. The pid is an
 * integer checked before it is formatted into the program.
 */
export function claudeProcessRecordCommand(pid: number): string {
  if (!Number.isSafeInteger(pid) || pid <= 1)
    throw new Error("Expected a process ID.");
  return `set -eu
set -f
pid=${pid}
file="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}/sessions/$pid.json"
[ -f "$file" ] || exit 44
start() {
  if [ -r /proc/self/stat ]; then
    stat="$(cat "/proc/$pid/stat" 2>/dev/null)" || return 0
    # The name in parentheses may hold spaces and ")": skip past the last.
    set -- \${stat##*) }
    [ "$#" -ge 20 ] && shift 19 && printf '%s' "$1"
  else
    LC_ALL=C TZ=UTC ps -o lstart= -p "$pid" 2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
  fi
  return 0
}
before="$(start)"
record="$(head -c ${CLAUDE_PROCESS_RECORD_LIMIT + 1} "$file")"
after="$(start)"
printf '%s\\n%s\\n%s' "$before" "$after" "$record"
`;
}

/**
 * The session ID the record names for `pid`, or null unless the live
 * process's start time was the same before and after the read and equals
 * the record's `procStart`. Anything missing, torn or contradicting is no
 * evidence: Chat then asks for a link rather than guess.
 */
export function claudeProcessSession(
  pid: number,
  output: string,
): string | null {
  const first = output.indexOf("\n");
  const second = output.indexOf("\n", first + 1);
  if (first < 0 || second < 0) return null;
  const before = output.slice(0, first);
  const after = output.slice(first + 1, second);
  const text = output.slice(second + 1);
  if (!before || before !== after || text.length > CLAUDE_PROCESS_RECORD_LIMIT)
    return null;
  let record: unknown;
  try {
    record = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof record !== "object" || record === null) return null;
  const {
    pid: owner,
    procStart,
    sessionId,
  } = record as Record<string, unknown>;
  return owner === pid &&
    procStart === before &&
    typeof sessionId === "string" &&
    UUID.test(sessionId)
    ? sessionId
    : null;
}
