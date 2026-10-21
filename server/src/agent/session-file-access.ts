import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { sshCommandArgv } from "../bridge/ssh-command";
import type { SessionFile } from "./session-types";

const SESSION_FILE_TIMEOUT_MS = 15_000;

type RunBinaryProcessWithTimeout = (
  argv: string[],
  timeoutMs: number,
) => Promise<{ code: number; stdout: Buffer; stderr: string }>;

export type AgentSessionFileAccess = {
  remote: boolean;
  statFile(path: string): Promise<SessionFile | null>;
  readText(path: string): Promise<string>;
  readPrefix(path: string, byteLimit: number): Promise<Uint8Array>;
  readDownloadBody(path: string): Promise<BodyInit>;
  findPiSessionById(id: string): Promise<SessionFile | null>;
  /** Up to two Codex rollout paths whose name contains `fragment`. */
  findCodexSessions(fragment: string): Promise<string[]>;
};

/** Two results are enough to tell a unique match from an ambiguous one. */
const CODEX_MATCH_LIMIT = 2;

async function findLocalCodexSessions(fragment: string) {
  const codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
  const root = join(codexHome, "sessions");
  let names: string[];
  try {
    names = await readdir(root, { recursive: true });
  } catch {
    return [];
  }
  return names
    .filter(
      (name) => name.endsWith(".jsonl") && basename(name).includes(fragment),
    )
    .slice(0, CODEX_MATCH_LIMIT)
    .map((name) => join(root, name));
}

async function localSessionFile(path: string): Promise<SessionFile | null> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    return {
      path,
      mtimeMs: info.mtimeMs,
      size: info.size,
      identity: `${info.dev}:${info.ino}`,
      changeToken: String(info.ctimeMs),
    };
  } catch {
    return null;
  }
}

export const localAgentSessionFiles: AgentSessionFileAccess = {
  remote: false,
  statFile: localSessionFile,
  readText: (path) => Bun.file(path).text(),
  async readPrefix(path, byteLimit) {
    return new Uint8Array(
      await Bun.file(path).slice(0, byteLimit).arrayBuffer(),
    );
  },
  async readDownloadBody(path) {
    return Bun.file(path);
  },
  async findPiSessionById() {
    return null;
  },
  findCodexSessions: findLocalCodexSessions,
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
    const command = `
set -eu
path=${args.shQuote(path)}
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

  return {
    remote: true,
    statFile,
    async readText(path) {
      return (await runRemote(`set -eu\ncat ${args.shQuote(path)}`)).toString(
        "utf8",
      );
    },
    async readPrefix(path, byteLimit) {
      return runRemote(
        `set -eu\nhead -c ${Math.max(1, Math.floor(byteLimit))} ${args.shQuote(path)}`,
      );
    },
    async readDownloadBody(path) {
      const bytes = await runRemote(`set -eu\ncat ${args.shQuote(path)}`);
      return Uint8Array.from(bytes).buffer;
    },
    async findCodexSessions(fragment) {
      const output = await runRemote(`
set -eu
fragment=${args.shQuote(fragment)}
root="\${CODEX_HOME:-$HOME/.codex}/sessions"
[ -d "$root" ] || exit 0
find "$root" -type f -name "*$fragment*.jsonl" | head -n ${CODEX_MATCH_LIMIT} | while IFS= read -r path; do
  printf '%s' "$path" | base64 | tr -d '\\n'
  printf '\\n'
done
`);
      return output
        .toString("utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => Buffer.from(line, "base64").toString("utf8"));
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
