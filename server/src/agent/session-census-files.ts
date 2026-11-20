import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Every transcript a host's harnesses keep, for Apartments' census of past
 * agents (world/apartment-census.ts): Claude Code's projects, Codex's
 * sessions and archived sessions, Pi's and Oh My Pi's sessions. Other
 * harnesses keep sessions only Chat on this machine can read, or in a store
 * of their own, and are not listed.
 */
export type CensusHarness = "claude" | "codex" | "pi" | "omp";

export type CensusFile = {
  harness: CensusHarness;
  path: string;
  mtimeMs: number;
  size: number;
};

const HARNESSES: readonly CensusHarness[] = ["claude", "codex", "pi", "omp"];

/** A name each harness gives its own transcripts; nothing else is listed. */
export function censusName(harness: CensusHarness, name: string): boolean {
  if (harness === "codex") return /^rollout-.+\.jsonl(\.zst)?$/.test(name);
  return name.endsWith(".jsonl");
}

function home(configured: string | undefined, fallback: string) {
  const value = configured?.trim();
  if (!value) return join(homedir(), fallback);
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return resolve(value);
}

async function entries(directory: string) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function file(
  harness: CensusHarness,
  path: string,
): Promise<CensusFile | null> {
  try {
    const info = await stat(path);
    return info.isFile()
      ? { harness, path, mtimeMs: info.mtimeMs, size: info.size }
      : null;
  } catch {
    return null;
  }
}

/** Files directly inside each folder of `root` (projects or cwd folders). */
async function twoDeep(harness: CensusHarness, root: string) {
  const found: CensusFile[] = [];
  for (const folder of await entries(root)) {
    if (!folder.isDirectory() && !folder.isSymbolicLink()) continue;
    for (const entry of await entries(join(root, folder.name))) {
      if (!censusName(harness, entry.name)) continue;
      const listed = await file(harness, join(root, folder.name, entry.name));
      if (listed) found.push(listed);
    }
  }
  return found;
}

/** Codex keeps sessions by day: sessions/YYYY/MM/DD/rollout-….jsonl. */
async function codexFiles(root: string, depth = 0): Promise<CensusFile[]> {
  const found: CensusFile[] = [];
  for (const entry of await entries(root)) {
    const path = join(root, entry.name);
    if (entry.isDirectory() && depth < 4)
      found.push(...(await codexFiles(path, depth + 1)));
    else if (entry.isFile() && censusName("codex", entry.name)) {
      const listed = await file("codex", path);
      if (listed) found.push(listed);
    }
  }
  return found;
}

/** This machine's transcripts. */
export async function listLocalCensusFiles(): Promise<CensusFile[]> {
  const codex = home(process.env.CODEX_HOME, ".codex");
  return [
    ...(await twoDeep(
      "claude",
      join(home(process.env.CLAUDE_CONFIG_DIR, ".claude"), "projects"),
    )),
    ...(await codexFiles(join(codex, "sessions"))),
    ...(await codexFiles(join(codex, "archived_sessions"))),
    ...(await twoDeep(
      "pi",
      join(home(process.env.PI_CODING_AGENT_DIR, ".pi/agent"), "sessions"),
    )),
    ...(await twoDeep(
      "omp",
      // Like Chat's resolver: always a folder under the home directory.
      join(homedir(), process.env.PI_CONFIG_DIR || ".omp", "agent", "sessions"),
    )),
  ];
}

/**
 * The same listing on an SSH host, as one shell script. Each harness's
 * section starts with `@harness`; each file is `mtime size path` (GNU or
 * BSD stat). The host's own environment names the folders.
 */
export const REMOTE_CENSUS_COMMAND = `
set -u
if stat -c '%Y' / >/dev/null 2>&1; then gnu=1; else gnu=0; fi
st() {
  if [ "$gnu" = 1 ]; then xargs -0 stat -c '%Y %s %n' 2>/dev/null
  else xargs -0 stat -f '%m %z %N' 2>/dev/null; fi
}
expand() {
  case "$1" in
    "~") printf '%s' "$HOME" ;;
    "~/"*) printf '%s/%s' "$HOME" "\${1#\\~/}" ;;
    *) printf '%s' "$1" ;;
  esac
}
two() {
  [ -d "$1" ] || return 0
  find -L "$1" -mindepth 2 -maxdepth 2 -type f -name '*.jsonl' -print0 | st
}
printf '@claude\\n'
two "$(expand "\${CLAUDE_CONFIG_DIR:-$HOME/.claude}")/projects"
printf '@codex\\n'
codex="$(expand "\${CODEX_HOME:-$HOME/.codex}")"
for d in "$codex/sessions" "$codex/archived_sessions"; do
  [ -d "$d" ] || continue
  find "$d" -maxdepth 5 -type f \\( -name 'rollout-*.jsonl' -o -name 'rollout-*.jsonl.zst' \\) -print0 | st
done
printf '@pi\\n'
two "$(expand "\${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}")/sessions"
printf '@omp\\n'
two "$HOME/\${PI_CONFIG_DIR:-.omp}/agent/sessions"
exit 0
`;

/** Parses REMOTE_CENSUS_COMMAND's output; malformed lines are skipped. */
export function parseRemoteCensus(output: string): CensusFile[] {
  const found: CensusFile[] = [];
  let harness: CensusHarness | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("@")) {
      const tag = line.slice(1) as CensusHarness;
      harness = HARNESSES.includes(tag) ? tag : null;
      continue;
    }
    const match = /^(\d+) (\d+) (\/.+)$/.exec(line);
    if (!harness || !match) continue;
    const path = match[3]!;
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (!censusName(harness, name)) continue;
    found.push({
      harness,
      path,
      mtimeMs: Number(match[1]) * 1000,
      size: Number(match[2]),
    });
  }
  return found;
}

/**
 * One SSH script that prints, for each plain path, its first `byteLimit`
 * bytes after a line with their count (-1 when the file is gone). A temp
 * copy keeps the count true while a transcript grows.
 */
export function remotePrefixesCommand(
  paths: readonly string[],
  byteLimit: number,
  shQuote: (value: string) => string,
) {
  const limit = Math.max(1, Math.floor(byteLimit));
  return `
set -u
tmp="$(mktemp)" || exit 1
trap 'rm -f "$tmp"' EXIT
for path in ${paths.map(shQuote).join(" ")}; do
  if [ -f "$path" ] && head -c ${limit} "$path" >"$tmp" 2>/dev/null; then
    printf '%s\\n' "$(wc -c <"$tmp" | tr -d ' ')"
    cat "$tmp"
  else
    printf -- '-1\\n'
  fi
done
`;
}

/** Splits remotePrefixesCommand's output back into each path's bytes. */
export function parseRemotePrefixes(
  paths: readonly string[],
  output: Uint8Array,
): Map<string, Uint8Array> {
  const read = new Map<string, Uint8Array>();
  let at = 0;
  for (const path of paths) {
    const newline = output.indexOf(10, at);
    if (newline < 0) break;
    const count = Number(
      new TextDecoder().decode(output.subarray(at, newline)),
    );
    at = newline + 1;
    if (!Number.isSafeInteger(count)) break;
    if (count < 0) continue;
    if (at + count > output.length) break;
    read.set(path, output.subarray(at, at + count));
    at += count;
  }
  return read;
}
