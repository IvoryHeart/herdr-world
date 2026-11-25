/** Process evidence for already-running headless agents; never directory recency. */
export type ProcessAgentSession = { kind: "path" | "id"; value: string };

export const PROCESS_TRANSCRIPT_LIMIT = 262_144;
const FD_LIMIT = 512;
const UUID = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
const CODEX = new RegExp(
  `^rollout-\\d{4}-\\d{2}-\\d{2}T[\\d-]+-(${UUID})(?:_${UUID})?\\.jsonl$`,
  "i",
);
const CLAUDE = new RegExp(`^(${UUID})\\.jsonl$`, "i");

/** The session ID a Codex rollout path names (`codex resume <id>`), if any. */
export function codexRolloutId(path: string): string | null {
  return CODEX.exec(path.split("/").at(-1) ?? "")?.[1] ?? null;
}
const CLAUDE_DEBUG = new RegExp(`^(${UUID})\\.txt$`, "i");

/**
 * Linux exposes writable descriptors through procfs. macOS exposes the same
 * evidence through lsof's NUL-delimited field format (f/a/t/n). Fence both
 * reads with the process start time. No descendant search: a shell wrapper
 * is not evidence for any particular agent. Exit 44 means no evidence.
 */
export function processTranscriptCommand(pid: number): string {
  if (!Number.isSafeInteger(pid) || pid <= 1)
    throw new Error("Expected a process ID.");
  return `set -eu
set -f
pid=${pid}
start() {
  if [ -r /proc/self/stat ]; then
    stat="$(cat "/proc/$pid/stat" 2>/dev/null)" || return 0
    set -- \${stat##*) }
    [ "$#" -ge 20 ] && shift 19 && printf '%s' "$1"
  else
    LC_ALL=C TZ=UTC ps -o lstart= -p "$pid" 2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
  fi
  return 0
}
before="$(start)"
[ -n "$before" ] || exit 44
printf '%s\\0' "$before"
config="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
if [ -d "$config" ]; then
  config="$(cd -P "$config" && printf '%s.' "$PWD")"
  config=\${config%.}
else
  config=''
fi
printf 'c%s\\0' "$config"
if [ -d /proc/self/fd ]; then
  [ -r "/proc/$pid/fd" ] || exit 44
  set +f
  count=0
  {
  for fd in /proc/"$pid"/fd/*; do
    count=$((count + 1))
    [ "$count" -le ${FD_LIMIT} ] || { printf '!overflow\\0'; break; }
    [ -f "$fd" ] || continue
    flags="$(sed -n 's/^flags:[[:space:]]*//p' "/proc/$pid/fdinfo/\${fd##*/}" 2>/dev/null)" || continue
    case "$flags" in ''|*[!0-7]*) continue ;; esac
    mode=$((0$flags & 3))
    [ "$mode" -eq 1 ] || [ "$mode" -eq 2 ] || continue
    # The marker preserves trailing newlines in a filename.
    path="$(readlink -n "$fd" 2>/dev/null && printf '.')" || continue
    path=\${path%.}
    printf 'f%s\\0au\\0tREG\\0n%s\\0' "\${fd##*/}" "$path"
  done
  } | head -c ${PROCESS_TRANSCRIPT_LIMIT + 1}
else
  command -v lsof >/dev/null 2>&1 || exit 44
  lsof -nP -a -p "$pid" -F0fatn 2>/dev/null | head -c ${PROCESS_TRANSCRIPT_LIMIT + 1}
fi
printf 's%s\\0' "$(start)"
`;
}

/**
 * Only one native session may own the writable files. Multiple descriptors
 * for the same transcript are fine; multiple sessions, truncated output,
 * deleted files, read-only history and a disappearing/reused pid are not.
 * A canonical Claude debug file can name an ID even between transcript writes.
 */
export function processTranscriptSession(
  agent: "claude" | "codex",
  output: Buffer,
): ProcessAgentSession | null {
  if (output.length > PROCESS_TRANSCRIPT_LIMIT) return null;
  const fields = output.toString("utf8").split("\0");
  if (fields.pop() !== "") return null;
  const before = fields.shift();
  const config = fields.shift();
  if (!config?.startsWith("c")) return null;
  const claudeRoot = config.slice(1);
  if (!before || fields.pop()?.replace(/^\n(?=s)/, "") !== `s${before}`)
    return null;
  const sessions = new Map<string, ProcessAgentSession>();
  let access = "",
    type = "",
    path = "",
    descriptors = 0;
  const save = () => {
    if (!["w", "u"].includes(access) || type !== "REG" || !path.startsWith("/"))
      return;
    const parts = path.split("/");
    if (parts.some((part) => part === "." || part === "..")) return;
    const name = parts.at(-1)!;
    const id =
      agent === "codex"
        ? CODEX.exec(name)?.[1]
        : parts.at(-3) === "projects"
          ? CLAUDE.exec(name)?.[1]
          : claudeRoot.startsWith("/") && path === `${claudeRoot}/debug/${name}`
            ? CLAUDE_DEBUG.exec(name)?.[1]
            : undefined;
    if (!id) return;
    const session: ProcessAgentSession =
      agent === "claude" && parts.at(-2) === "debug"
        ? { kind: "id", value: id }
        : { kind: "path", value: path };
    const previous = sessions.get(id);
    // Two distinct rollout files for one ID are ambiguous too.
    if (
      previous?.kind === "path" &&
      session.kind === "path" &&
      previous.value !== path
    )
      sessions.set(path, session);
    else if (!previous || session.kind === "path") sessions.set(id, session);
  };
  for (const raw of fields) {
    // lsof inserts a newline before the next file/process record.
    const field = raw.replace(/^\n(?=[fp])/, "");
    if (field.startsWith("f")) {
      save();
      access = "";
      type = "";
      path = "";
      if (++descriptors > FD_LIMIT) return null;
    } else if (field.startsWith("a")) access = field.slice(1);
    else if (field.startsWith("t")) type = field.slice(1);
    else if (field.startsWith("n")) path = field.slice(1);
    else if (!/^p\d+$/.test(field) && field !== "\n") return null;
  }
  save();
  return sessions.size === 1 ? sessions.values().next().value! : null;
}
