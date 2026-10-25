import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { sshCommandArgv } from "../bridge/ssh-command";
import type { SessionFile } from "./session-types";
import {
  plainTranscriptPath,
  transcriptPaths,
  transcriptPrefix,
  transcriptText,
} from "./session-transcript";
import {
  listCodexDaemonThreads,
  listCodexDaemonThreadBatch,
  type CodexDaemonThread,
} from "./codex-app-server";

const SESSION_FILE_TIMEOUT_MS = 15_000;
const COMPRESSED_PREFIX_TRANSFER_LIMIT = 1024 * 1024;

type RunBinaryProcessWithTimeout = (
  argv: string[],
  timeoutMs: number,
) => Promise<{ code: number; stdout: Buffer; stderr: string }>;

export type AgentSessionFileAccess = {
  remote: boolean;
  /**
   * The transcript host's clock minus this service's, within
   * `uncertaintyMs`. Absent for this machine, whose clock is ours.
   */
  clockOffset?(): Promise<{ offsetMs: number; uncertaintyMs: number }>;
  statFile(path: string): Promise<SessionFile | null>;
  readText(path: string): Promise<string>;
  readPrefix(path: string, byteLimit: number): Promise<Uint8Array>;
  readDownloadBody(path: string): Promise<BodyInit>;
  findPiSessionById(id: string): Promise<SessionFile | null>;
  /** Optional host-local discovery for a Herdr-reported Claude UUID. */
  findClaudeSessionById?(id: string): Promise<SessionFile | null>;
  findCodexSessionById(id: string): Promise<SessionFile | null>;
  /** Complete interactive-thread evidence for one directory. */
  listCodexThreads?(cwd: string): Promise<CodexDaemonThread[] | null>;
  listCodexThreadBatch?(
    cwds: readonly string[],
  ): Promise<Map<string, CodexDaemonThread[] | null>>;
  /** The one transcript whose ID starts with `prefix`, if exactly one does. */
  findCodexSessionByPrefix(
    prefix: string,
  ): Promise<SessionFile | "ambiguous" | null>;
};

const CODEX_ID_PREFIX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{5,12}$/;

function validateCodexSessionPrefix(prefix: string) {
  if (!CODEX_ID_PREFIX.test(prefix)) {
    throw new Error("Expected a Codex session ID prefix.");
  }
}

export function validateCodexSessionId(id: string) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Enter a complete Codex session ID.");
  }
}

export function codexHome() {
  const configured = process.env.CODEX_HOME?.trim();
  if (!configured) return join(homedir(), ".codex");
  if (configured === "~") return homedir();
  return configured.startsWith("~/")
    ? join(homedir(), configured.slice(2))
    : resolve(configured);
}

async function findLocalCodexSessionByPrefix(prefix: string) {
  validateCodexSessionPrefix(prefix);
  const matches = new Set<string>();
  for (const directory of ["sessions", "archived_sessions"]) {
    const root = join(codexHome(), directory);
    try {
      for await (const path of new Bun.Glob(
        `**/*-${prefix}*.jsonl{,.zst}`,
      ).scan({
        cwd: root,
        absolute: true,
        onlyFiles: true,
      })) {
        matches.add(plainTranscriptPath(path));
        if (matches.size > 1) return "ambiguous";
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const [only] = matches;
  return only ? localSessionFile(only) : null;
}

async function findLocalCodexSession(id: string) {
  validateCodexSessionId(id);
  let found: string | null = null;
  for (const directory of ["sessions", "archived_sessions"]) {
    const root = join(codexHome(), directory);
    try {
      for await (const path of new Bun.Glob("**/*.jsonl{,.zst}").scan({
        cwd: root,
        absolute: true,
        onlyFiles: true,
      })) {
        const plain = plainTranscriptPath(path);
        if (!basename(plain).endsWith(`-${id}.jsonl`)) continue;
        if (found && found !== plain)
          throw new Error("Multiple transcripts match this Codex session ID.");
        found = plain;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return found ? localSessionFile(found) : null;
}

async function localSessionFile(path: string): Promise<SessionFile | null> {
  for (const candidate of transcriptPaths(path)) {
    try {
      const info = await stat(candidate);
      if (!info.isFile()) continue;
      return {
        path: candidate,
        mtimeMs: info.mtimeMs,
        size: info.size,
        identity: `${info.dev}:${info.ino}`,
        changeToken: String(info.ctimeMs),
      };
    } catch {
      // Compression/materialization can replace a transcript representation.
    }
  }
  return null;
}

async function localReadFile(path: string) {
  const file = await localSessionFile(path);
  return Bun.file(file?.path ?? path);
}

export const localAgentSessionFiles: AgentSessionFileAccess = {
  remote: false,
  statFile: localSessionFile,
  async readText(path) {
    const file = await localReadFile(path);
    return transcriptText(file.name!, file.stream());
  },
  async readPrefix(path, byteLimit) {
    const file = await localReadFile(path);
    return transcriptPrefix(file.name!, file.stream(), byteLimit);
  },
  async readDownloadBody(path) {
    return Bun.file(path);
  },
  async findPiSessionById() {
    return null;
  },
  findCodexSessionById: findLocalCodexSession,
  findCodexSessionByPrefix: findLocalCodexSessionByPrefix,
  listCodexThreads: listCodexDaemonThreads,
  listCodexThreadBatch: listCodexDaemonThreadBatch,
};

function parseRemoteFileMetadata(stdout: string): SessionFile | null {
  const [rawSize, rawMtime, rawPath, identity, changeToken] = stdout
    .trim()
    .split("\t");
  if (!rawPath) return null;
  const path = Buffer.from(rawPath, "base64").toString("utf8");
  if (!path) return null;
  const size = Number(rawSize);
  const mtimeSeconds = Number(rawMtime);
  if (!Number.isFinite(size) || !Number.isFinite(mtimeSeconds)) return null;
  return { path, size, mtimeMs: mtimeSeconds * 1000, identity, changeToken };
}

export function createAgentSessionFileAccess(args: {
  sshHost?: string;
  runBinaryProcessWithTimeout: RunBinaryProcessWithTimeout;
  shQuote: (value: string) => string;
}): AgentSessionFileAccess {
  if (!args.sshHost) return localAgentSessionFiles;
  const host = args.sshHost;

  async function runRemote(command: string) {
    const result = await args.runBinaryProcessWithTimeout(
      sshCommandArgv(host, `bash -lc ${args.shQuote(command)}`),
      SESSION_FILE_TIMEOUT_MS,
    );
    if (result.code !== 0) {
      throw new Error(
        (
          result.stderr ||
          result.stdout.toString("utf8") ||
          `remote session command exited ${result.code}`
        )
          .trim()
          .slice(0, 1000),
      );
    }
    return result.stdout;
  }

  async function statFile(path: string) {
    const candidates = transcriptPaths(path);
    const select =
      candidates.length === 1
        ? ""
        : `
if [ -f ${args.shQuote(candidates[0])} ]; then
  path=${args.shQuote(candidates[0])}
elif [ -f ${args.shQuote(candidates[1])} ]; then
  path=${args.shQuote(candidates[1])}
fi
`;
    const command = `
set -eu
path=${args.shQuote(path)}
${select}
[ -f "$path" ] || exit 44
size="$(stat -c %s "$path" 2>/dev/null || stat -f %z "$path")"
mtime="$(stat -c %Y "$path" 2>/dev/null || stat -f %m "$path")"
path64="$(printf '%s' "$path" | base64 | tr -d '\\n')"
identity="$(stat -c '%d:%i' "$path" 2>/dev/null || stat -f '%d:%i' "$path")"
change="$(stat -c '%y:%z' "$path" 2>/dev/null || stat -f '%Fm:%Fc' "$path")"
printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$size" "$mtime" "$path64" "$identity" "$change"
`;
    const result = await args.runBinaryProcessWithTimeout(
      sshCommandArgv(host, `bash -lc ${args.shQuote(command)}`),
      SESSION_FILE_TIMEOUT_MS,
    );
    if (result.code === 44) return null;
    if (result.code !== 0) {
      throw new Error(
        (
          result.stderr ||
          result.stdout.toString("utf8") ||
          `remote session stat exited ${result.code}`
        )
          .trim()
          .slice(0, 1000),
      );
    }
    return parseRemoteFileMetadata(result.stdout.toString("utf8"));
  }

  async function readPath(path: string) {
    // Ordinary provider reads keep their existing single SSH request.
    if (!path.endsWith(".jsonl.zst") && !basename(path).startsWith("rollout-"))
      return path;
    return (await statFile(path))?.path ?? path;
  }

  return {
    remote: true,
    listCodexThreads: (cwd) => listCodexDaemonThreads(cwd, { sshHost: host }),
    listCodexThreadBatch: (cwds) =>
      listCodexDaemonThreadBatch(cwds, { sshHost: host }),
    statFile,
    async findClaudeSessionById(id) {
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
        throw new Error("Expected a complete Claude session ID.");
      const output = await runRemote(`
set -eu
root="$HOME/.claude/projects"
[ -d "$root" ] || exit 0
# A marker preserves trailing newlines in the physical directory name.
root="$(cd -P "$root" && printf '%s.' "$PWD")"
root="\${root%.}"
printf '%s\\0' "$root"
find "$root" -mindepth 2 -maxdepth 2 -type f -name ${args.shQuote(`${id}.jsonl`)} -print0
`);
      if (!output.length) return null;
      if (output[output.length - 1] !== 0)
        throw new Error("Invalid Claude session lookup response.");
      const records = output.toString("utf8").split("\0");
      records.pop();
      const root = records.shift();
      if (
        !root?.startsWith("/") ||
        (root !== "/" && root.endsWith("/")) ||
        root.split("/").some((part) => part === "." || part === "..")
      )
        throw new Error("Invalid Claude session lookup root.");
      const paths = records;
      if (paths.length > 1)
        throw new Error("Multiple transcripts match this Claude session ID.");
      if (!paths.length) return null;
      const path = paths[0];
      const prefix = root === "/" ? root : `${root}/`;
      const [project, name, ...nested] = path?.startsWith(prefix)
        ? path.slice(prefix.length).split("/")
        : [];
      if (
        !project ||
        project === "." ||
        project === ".." ||
        name !== `${id}.jsonl` ||
        nested.length
      )
        throw new Error("Invalid Claude session lookup path.");
      const file = await statFile(path!);
      if (file && file.path !== path)
        throw new Error("Invalid Claude session lookup path.");
      return file;
    },
    async clockOffset() {
      const before = Date.now();
      const output = (await runRemote("date +%s%N")).toString().trim();
      const after = Date.now();
      const halfTrip = (after - before) / 2;
      // GNU date prints nanoseconds; BSD date prints a literal "N".
      if (/^\d{19}$/.test(output))
        return {
          offsetMs: Number(output) / 1e6 - (before + after) / 2,
          uncertaintyMs: halfTrip + 1,
        };
      const seconds = /^(\d{9,11})N?$/.exec(output)?.[1];
      if (!seconds) throw new Error("The SSH host did not report its time.");
      // Whole seconds: the host's time was within [seconds, seconds + 1)
      // at some point during the round trip.
      return {
        offsetMs: Number(seconds) * 1000 + 500 - (before + after) / 2,
        uncertaintyMs: halfTrip + 500,
      };
    },
    async findCodexSessionById(id) {
      validateCodexSessionId(id);
      const command = `
set -eu
id=${args.shQuote(id)}
root="\${CODEX_HOME:-$HOME/.codex}"
case "$root" in
  "~") root="$HOME" ;;
  "~/"*) root="$HOME/\${root:2}" ;;
esac
[ -d "$root" ] || exit 0
root="$(cd -P "$root" && pwd)"
match=""
for directory in "$root/sessions" "$root/archived_sessions"; do
  [ -d "$directory" ] || continue
  while IFS= read -r -d '' candidate; do
    case "$candidate" in *.jsonl.zst) [ ! -f "\${candidate%.zst}" ] || continue ;; esac
    if [ -n "$match" ]; then
      printf '%s\\n' 'Multiple transcripts match this Codex session ID.' >&2
      exit 1
    fi
    match="$candidate"
  done < <(find "$directory" -type f \\( -name "*-$id.jsonl" -o -name "*-$id.jsonl.zst" \\) -print0)
done
[ -z "$match" ] || printf '%s\\n' "$match"
`;
      const path = (await runRemote(command)).toString("utf8").trim();
      return path ? statFile(path) : null;
    },
    async findCodexSessionByPrefix(prefix) {
      validateCodexSessionPrefix(prefix);
      const command = `
set -eu
prefix=${args.shQuote(prefix)}
root="\${CODEX_HOME:-$HOME/.codex}"
case "$root" in
  "~") root="$HOME" ;;
  "~/"*) root="$HOME/\${root:2}" ;;
esac
[ -d "$root" ] || exit 0
root="$(cd -P "$root" && pwd)"
match=""
for directory in "$root/sessions" "$root/archived_sessions"; do
  [ -d "$directory" ] || continue
  while IFS= read -r -d '' candidate; do
    case "$candidate" in *.jsonl.zst) [ ! -f "\${candidate%.zst}" ] || continue ;; esac
    # Paths are absolute, so this marker cannot be one.
    if [ -n "$match" ]; then printf 'ambiguous\\n'; exit 0; fi
    match="$candidate"
  done < <(find "$directory" -type f \\( -name "*-$prefix*.jsonl" -o -name "*-$prefix*.jsonl.zst" \\) -print0)
done
[ -z "$match" ] || printf '%s\\n' "$match"
`;
      const path = (await runRemote(command)).toString("utf8").trim();
      if (path === "ambiguous") return "ambiguous";
      return path ? statFile(path) : null;
    },
    async readText(path) {
      const actual = await readPath(path);
      const bytes = await runRemote(`set -eu\ncat ${args.shQuote(actual)}`);
      return transcriptText(actual, new Response(Uint8Array.from(bytes)).body!);
    },
    async readPrefix(path, byteLimit) {
      const actual = await readPath(path);
      const compressed = actual.endsWith(".jsonl.zst");
      const transferLimit = compressed
        ? COMPRESSED_PREFIX_TRANSFER_LIMIT
        : Math.max(1, Math.floor(byteLimit));
      const bytes = await runRemote(
        `set -eu\nhead -c ${transferLimit} ${args.shQuote(actual)}`,
      );
      try {
        return await transcriptPrefix(
          actual,
          new Response(Uint8Array.from(bytes)).body!,
          byteLimit,
        );
      } catch (error) {
        if (compressed && bytes.length === COMPRESSED_PREFIX_TRANSFER_LIMIT)
          throw new Error(
            "Compressed transcript prefix exceeds the 1 MiB transfer budget.",
            { cause: error },
          );
        throw error;
      }
    },
    async readDownloadBody(path) {
      const bytes = await runRemote(`set -eu\ncat ${args.shQuote(path)}`);
      return Uint8Array.from(bytes).buffer;
    },
    async findPiSessionById(id) {
      const command = `
set -eu
id=${args.shQuote(id)}
root="\${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/sessions"
[ -d "$root" ] || exit 44
latest=""
latest_mtime=0
while IFS= read -r -d '' candidate; do
  mtime="$(stat -c %Y "$candidate" 2>/dev/null || stat -f %m "$candidate")"
  if [ "$mtime" -ge "$latest_mtime" ]; then
    latest="$candidate"
    latest_mtime="$mtime"
  fi
done < <(find "$root" -type f \\( -name "$id.jsonl" -o -name "*_$id.jsonl" \\) -print0)
[ -n "$latest" ] || exit 44
size="$(stat -c %s "$latest" 2>/dev/null || stat -f %z "$latest")"
path64="$(printf '%s' "$latest" | base64 | tr -d '\\n')"
printf '%s\\t%s\\t%s\\n' "$size" "$latest_mtime" "$path64"
`;
      const result = await args.runBinaryProcessWithTimeout(
        sshCommandArgv(host, `bash -lc ${args.shQuote(command)}`),
        SESSION_FILE_TIMEOUT_MS,
      );
      if (result.code === 44) return null;
      if (result.code !== 0) {
        throw new Error(
          (
            result.stderr ||
            result.stdout.toString("utf8") ||
            `remote Pi session search exited ${result.code}`
          )
            .trim()
            .slice(0, 1000),
        );
      }
      return parseRemoteFileMetadata(result.stdout.toString("utf8"));
    },
  };
}
