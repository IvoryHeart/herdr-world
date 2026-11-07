import { readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { SessionFile } from "./session-types";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PREFIX_BYTES = 1024 * 1024;
const MAX_CANDIDATES = 200;
type Files = {
  statFile(path: string): Promise<SessionFile | null>;
  readPrefix(path: string, bytes: number): Promise<Uint8Array>;
};

/** Discovery carries paths only; JSON authority is checked in the service. */
export function claudeSuccessorCandidates(
  path: string,
  quote: (value: string) => string,
) {
  return `f=${quote(path)}
find "$(dirname "$f")" -maxdepth 1 -type f -name '*.jsonl' -newer "$f" -print0`;
}

export function parseClaudeCandidatePaths(output: Buffer) {
  if (!output.length) return [];
  if (output.length > PREFIX_BYTES || output.at(-1) !== 0)
    throw new Error("Invalid Claude successor discovery response.");
  const paths = output.toString("utf8").split("\0");
  paths.pop();
  if (paths.length > MAX_CANDIDATES || new Set(paths).size !== paths.length)
    throw new Error("Claude successor discovery exceeds its bounded scope.");
  return paths;
}

function continuationMetadata(
  bytes: Uint8Array,
  size: number | undefined,
  id: string,
  ownId: string,
) {
  let text = new TextDecoder().decode(bytes);
  if (size !== undefined && size > bytes.length && !text.endsWith("\n"))
    text = text.slice(0, text.lastIndexOf("\n") + 1);
  let found = false;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      return false;
    }
    if (!record || typeof record !== "object" || Array.isArray(record))
      return false;
    const sessionId = (record as Record<string, unknown>).sessionId;
    if (sessionId === undefined) continue;
    if (typeof sessionId !== "string" || !UUID.test(sessionId)) return false;
    if (sessionId !== id && sessionId !== ownId) return false;
    if (sessionId === id) found = true;
  }
  return found;
}

/** Only one structurally proven sibling may replace the reported transcript. */
export async function findClaudeSuccessor(
  files: Files,
  path: string,
  id: string,
  candidates?: () => Promise<string[]>,
): Promise<string | null> {
  if (!UUID.test(id)) return null;
  const original = await files.statFile(path);
  if (!original || original.path !== path) return null;
  const directory = dirname(path);
  const paths = candidates
    ? await candidates()
    : (await readdir(directory)).map((name) => join(directory, name));
  if (paths.length > MAX_CANDIDATES)
    throw new Error("Claude successor discovery exceeds its bounded scope.");
  let found: string | null = null;
  for (const candidate of paths) {
    if (candidate === path || dirname(candidate) !== directory) continue;
    const name = basename(candidate);
    const ownId = name.endsWith(".jsonl") ? name.slice(0, -6) : "";
    if (!UUID.test(ownId)) continue;
    const file = await files.statFile(candidate);
    if (!file) continue;
    if (file.path !== candidate)
      throw new Error("Invalid Claude successor path.");
    // The process port already uses find -newer at native precision. Remote
    // stat metadata may round both files into the same second.
    if (!candidates && file.mtimeMs <= original.mtimeMs) continue;
    const bytes = await files.readPrefix(candidate, PREFIX_BYTES);
    if (!continuationMetadata(bytes, file.size, id, ownId)) continue;
    if (found) return null;
    found = candidate;
  }
  return found;
}
