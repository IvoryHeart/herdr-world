import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { posix } from "node:path";
import {
  ARTEFACT_LIMIT,
  ARTEFACT_TITLE_LIMIT,
  artefactKindForPath,
  artefactLinkKind,
  artefactLinkTitle,
  type AgentArtefact,
  type ArtefactEvidence,
  type ArtefactMaker,
} from "../../../shared/agentArtefacts";
import { isConversationStep } from "./session-messages";
import type { AtifTrajectory } from "./session-types";
import { isRecord, stringValue } from "./session-utils";

/**
 * Artefact discovery from a bound transcript (Claude Code and Codex share
 * the ATIF projection). Only the harness's own records are read:
 *
 * - Reliable: a file-writing tool call (`Write`, `NotebookEdit`, `create`)
 *   naming its path, and an `apply_patch` "Add File" header (Codex), resolved
 *   against the working directory the transcript records for that call (its
 *   own `workdir`, else the turn's cwd), never a later turn's.
 * - Reliable for links: URLs a publishing command printed (`gh pr create`,
 *   `gh issue create`, `gh gist create`, `gh release create`, deploy/publish).
 * - A guess: URLs the agent wrote in its replies.
 *
 * Files written by shell redirection, edits of existing files and harness
 * bookkeeping (transcripts, memory, settings) are not artefacts.
 */

/** Tools that create a whole file; edits of existing files are not artefacts. */
const WRITE_TOOL = /^(?:write|create|create_file|write_file|notebookedit)$/i;
const PATH_KEYS = ["file_path", "filePath", "path", "notebook_path"];
const ADD_FILE = /\*\*\* Add File: ([^\n\\"]+)/g;
const PUBLISH =
  /\bgh\s+(?:pr|issue|gist|release)\s+create\b|\b(?:deploy|publish)\b/i;
const URL_TEXT = /https?:\/\/[^\s<>()[\]{}"'`|\\^]+/g;
/** Harness records and bookkeeping, never a made thing. */
const IGNORED_PATH =
  /\/(?:\.git|node_modules)\/|\/\.claude\/(?:projects|todos|statsig|shell-snapshots)\/|\/\.codex\/(?:sessions|log)\//;

/**
 * What one transcript shows, before World names its maker: `key` is the
 * place (`file:<path>` or `link:<url>`), unique only on its own host.
 */
export type ArtefactCandidate = Omit<
  AgentArtefact,
  "id" | "exists" | "made_by"
> & {
  key: string;
};
type Candidate = ArtefactCandidate;

/**
 * An artefact's identity: its place on its source connection. The same path
 * on two hosts is two artefacts; the same place on one host is one.
 * @internal
 */
export const artefactId = (connectionId: string, key: string) =>
  `artefact-${createHash("sha256").update(`${connectionId}\0${key}`).digest("hex").slice(0, 16)}`;

/** The working directory a call ran in, by its transcript call ID. */
export type CallWorkingDirectory = (callId: string) => string | undefined;

const absolute = (value: unknown) => {
  const path = stringValue(value);
  return path.startsWith("/") && !path.includes("\0") ? path : undefined;
};

/**
 * The cwd each tool call ran in, from the harness's own records in order:
 * Codex's `session_meta`/`turn_context` cwd before its calls, Claude Code's
 * per-record `cwd` beside its `tool_use` parts. A call the records do not
 * place is answered only when the whole transcript has one cwd.
 */
export function callWorkingDirectories(
  agent: string,
  records: readonly Record<string, unknown>[],
): CallWorkingDirectory {
  const byCall = new Map<string, string>();
  const seen = new Set<string>();
  let current: string | undefined;
  for (const record of records) {
    const payload = isRecord(record.payload) ? record.payload : null;
    if (agent === "codex") {
      if (
        (record.type === "session_meta" || record.type === "turn_context") &&
        payload
      ) {
        current = absolute(payload.cwd) ?? current;
        if (current) seen.add(current);
      } else if (record.type === "response_item" && payload && current) {
        const id = stringValue(payload.call_id) || stringValue(payload.id);
        if (id) byCall.set(id, current);
      }
      continue;
    }
    const cwd = absolute(record.cwd);
    if (!cwd) continue;
    seen.add(cwd);
    const message = isRecord(record.message) ? record.message : null;
    const parts = Array.isArray(message?.content) ? message.content : [];
    for (const part of parts)
      if (isRecord(part) && part.type === "tool_use" && stringValue(part.id))
        byCall.set(stringValue(part.id), cwd);
  }
  const only = seen.size === 1 ? [...seen][0] : undefined;
  return (callId) => byCall.get(callId) ?? only;
}

function clipTitle(title: string) {
  return title.length > ARTEFACT_TITLE_LIMIT
    ? `${title.slice(0, ARTEFACT_TITLE_LIMIT - 1)}…`
    : title;
}

function fileCandidate(
  raw: string,
  cwd: string | undefined,
  made_at: string | null,
  evidence: ArtefactEvidence,
): Candidate | null {
  const value = raw.trim();
  if (!value || value.includes("\0") || value.length > 4096) return null;
  if (!value.startsWith("/") && !cwd) return null;
  const path = posix.resolve(cwd ?? "/", value);
  if (IGNORED_PATH.test(path)) return null;
  const kind = artefactKindForPath(path);
  if (!kind) return null;
  return {
    key: `file:${path}`,
    title: clipTitle(posix.basename(path)),
    kind,
    where: { type: "file", path },
    made_at,
    evidence,
  };
}

function linkCandidates(
  text: string,
  made_at: string | null,
  evidence: ArtefactEvidence,
): Candidate[] {
  const found: Candidate[] = [];
  for (const match of text.matchAll(URL_TEXT)) {
    const raw = match[0].replace(/[.,;:!?*_~]+$/, "");
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.username || url.password || url.href.length > 2048) continue;
    const kind = artefactKindForPath(url.pathname);
    found.push({
      key: `link:${url.href}`,
      title: artefactLinkTitle(url),
      kind: kind ?? "page",
      where: { type: "link", url: url.href, link_kind: artefactLinkKind(url) },
      made_at,
      evidence,
    });
  }
  return found;
}

/** Newest first, one record per place, at most ARTEFACT_LIMIT. */
export function sessionArtefacts(
  trajectory: AtifTrajectory,
  cwdOf?: string | CallWorkingDirectory,
): Candidate[] {
  const callCwd: CallWorkingDirectory =
    typeof cwdOf === "function" ? cwdOf : () => cwdOf;
  const byId = new Map<string, Candidate>();
  const strength: Record<ArtefactEvidence, number> = {
    agent_message: 0,
    publish_command: 1,
    patch_add: 2,
    file_write: 3,
  };
  const add = (candidate: Candidate | null) => {
    if (!candidate) return;
    const known = byId.get(candidate.key);
    // The latest mention dates it; the strongest evidence names it.
    if (known) byId.delete(candidate.key);
    byId.set(
      candidate.key,
      known && strength[known.evidence] > strength[candidate.evidence]
        ? { ...candidate, evidence: known.evidence }
        : candidate,
    );
  };
  const publishing = new Set<string>();
  for (const step of trajectory.steps) {
    const made_at = step.timestamp ?? null;
    for (const call of step.tool_calls ?? []) {
      const args = call.arguments ?? {};
      // A shell call's own working directory wins over its turn's cwd.
      const cwd = absolute(args.workdir) ?? callCwd(call.tool_call_id);
      if (WRITE_TOOL.test(call.function_name))
        for (const key of PATH_KEYS) {
          const value = args[key];
          if (typeof value === "string")
            add(fileCandidate(value, cwd, made_at, "file_write"));
        }
      const raw = JSON.stringify(args);
      if (raw.includes("*** Add File: "))
        for (const match of raw.matchAll(ADD_FILE))
          add(fileCandidate(match[1]!, cwd, made_at, "patch_add"));
      if (PUBLISH.test(raw)) publishing.add(call.tool_call_id);
    }
    for (const result of step.observation?.results ?? []) {
      if (!result.source_call_id || !publishing.has(result.source_call_id))
        continue;
      for (const link of linkCandidates(
        result.content ?? "",
        made_at,
        "publish_command",
      ))
        add(link);
    }
    if (step.source === "agent" && isConversationStep(step))
      for (const link of linkCandidates(step.message, made_at, "agent_message"))
        add(link);
  }
  return [...byId.values()].reverse().slice(0, ARTEFACT_LIMIT);
}

/**
 * Marks each file artefact present or gone. `stat` answers null for a
 * missing file; a failed check leaves the record unknown rather than gone.
 */
export async function withArtefactPresence(
  candidates: readonly Candidate[],
  stat: ((path: string) => Promise<unknown>) | null,
): Promise<(Candidate & Pick<AgentArtefact, "exists">)[]> {
  return Promise.all(
    candidates.map(async (candidate) => {
      if (candidate.where.type !== "file" || !stat)
        return { ...candidate, exists: null };
      try {
        return {
          ...candidate,
          exists: (await stat(candidate.where.path)) !== null,
        };
      } catch {
        return { ...candidate, exists: null };
      }
    }),
  );
}

/**
 * The records an agent's desk shows: each place named on its connection
 * (artefactId) and stamped with the agent and the room that made it.
 */
export function ownedArtefacts(
  found: readonly (Candidate & Pick<AgentArtefact, "exists">)[],
  connectionId: string,
  maker: (id: string) => ArtefactMaker,
): AgentArtefact[] {
  return found.map(({ key, ...artefact }) => {
    const id = artefactId(connectionId, key);
    return { ...artefact, id, made_by: maker(id) };
  });
}

/** Presence on this machine: null when the path is gone or not a file. */
export async function localArtefactStat(path: string) {
  try {
    const info = await stat(path);
    return info.isFile() ? info : null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}
