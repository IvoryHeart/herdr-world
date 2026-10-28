import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import { enrichAgentActivity } from "./agent-activity";
import { createCodexSessionLinker } from "./codex-session-link";
import { createConversationWatcher } from "./conversation-watch";
import { createHerdrConversationSource } from "./herdr-conversation";
import type { AgentSessionInfo, HerdrCall, SessionFile } from "./session-types";
import {
  createAgentSessionResolverContext,
  type AgentSessionResolverContext,
  resolveAgentSession,
  resolveAgentSessionInfo,
} from "./session-resolver";
import {
  localAgentSessionFiles,
  type AgentSessionFileAccess,
} from "./session-file-access";
import { readAntigravitySessionRecords } from "./antigravity-session";
import {
  createSessionProjectionCache,
  readSessionProjection,
  type SessionProjectionCache,
} from "./session-projection-cache";
import {
  HISTORY_WINDOW_LIMIT,
  historyTextHash,
  redactHistoryEntry,
  redactHistoryUpdate,
} from "./session-history";
import { taskSummarySessionFingerprint } from "../herdr/task-summary";
import { isRecord } from "./session-utils";
import { FULL_REPORT_CHARS, latestTurnReceipt } from "./turn-receipt";
import type { CodexDiscoveryScope } from "./codex-discovery-cache";

const MAX_MESSAGES_PER_AGENT = 200;

export function createAgentSessionHandlers(args: {
  herdrCall: HerdrCall;
  files: AgentSessionFileAccess;
  remotePlatform?: string;
  runtimeScope?: CodexDiscoveryScope;
  /** A watched pane's conversation changed; tell these owners. */
  onConversationChanged?: (paneId: string, owners: ReadonlySet<object>) => void;
}) {
  const resolverContext = createAgentSessionResolverContext(args.runtimeScope);
  const cache = createSessionProjectionCache(args.files);
  const linker = createCodexSessionLinker(args.herdrCall, args.files);
  let watcher: ReturnType<typeof createConversationWatcher> | null = null;
  const conversation = createHerdrConversationSource({
    herdrCall: args.herdrCall,
    files: args.files,
    context: resolverContext,
    cache,
    remotePlatform: args.remotePlatform,
    // A new or removed Codex transcript can change which thread a title
    // names; recheck every watched pane.
    onCodexSessionsChanged: () => watcher?.herdrEvent(),
    // A sent message's check ended; browsers showing the pane reread.
    onDeliveriesChanged: () => watcher?.herdrEvent(),
  });
  watcher = createConversationWatcher({
    identity: (paneId) => conversation.identity({ pane_id: paneId }),
    notify: (paneId, owners) => args.onConversationChanged?.(paneId, owners),
  });
  const conversationWatch = {
    ...watcher,
    stop() {
      watcher!.stop();
      conversation.dispose();
    },
  };
  // Entries older than the window, a page at a time, for scrolling back.
  const readOlder = async (params: Record<string, unknown>) => {
    const resolved = await resolveAgentSession(
      params,
      args.herdrCall,
      args.files,
      resolverContext,
    );
    if (!resolved.file) {
      cache.invalidate(resolved);
      throw new Error(resolved.detail || "Agent session is unavailable");
    }
    const before = typeof params.before === "string" ? params.before : "";
    const limit =
      typeof params.limit === "number" && Number.isFinite(params.limit)
        ? Math.min(HISTORY_WINDOW_LIMIT, Math.max(1, Math.floor(params.limit)))
        : HISTORY_WINDOW_LIMIT;
    const { epoch, page } = await cache.older(resolved, before, limit);
    if (!page) {
      throw new Error(
        "That history entry is no longer available; refresh the history and try again",
      );
    }
    return {
      epoch,
      entries: page.entries.map(redactHistoryEntry),
      has_more: page.has_more,
    };
  };
  const handlers = {
    // Objects, not handlers: they report Windows as unavailable themselves.
    conversation,
    conversationWatch,
    previewLink: linker.preview,
    link: linker.link,
    listWithActivity: async (params: Record<string, unknown>) =>
      enrichAgentActivity(
        await args.herdrCall("agent.list", params),
        args.files,
        resolverContext,
      ),
    readHistory: async (params: Record<string, unknown>) => {
      if (params.history_version !== 2) {
        return readAgentMessageHistory(
          params,
          args.herdrCall,
          args.files,
          resolverContext,
          cache,
        );
      }
      const resolved = await resolveAgentSession(
        params,
        args.herdrCall,
        args.files,
        resolverContext,
      );
      if (!resolved.file) {
        cache.invalidate(resolved);
        return {
          ...resolved,
          history_version: 2 as const,
          mode: "snapshot" as const,
          cursor: { epoch: randomUUID(), revision: 1 },
          window_limit: HISTORY_WINDOW_LIMIT,
          entries: [],
        };
      }
      const { projection, update } = await cache.history(
        resolved,
        params.cursor,
      );
      return {
        ...resolved,
        file: projection.file,
        updated_at: new Date(projection.file.mtimeMs).toISOString(),
        ...redactHistoryUpdate(update),
      };
    },
    readOlder,
    readEntry: async (params: Record<string, unknown>) => {
      const resolved = await resolveAgentSession(
        params,
        args.herdrCall,
        args.files,
        resolverContext,
      );
      if (!resolved.file) {
        cache.invalidate(resolved);
        throw new Error(resolved.detail || "Agent session is unavailable");
      }
      const entryId =
        typeof params.entry_id === "string" ? params.entry_id : "";
      const entry = await cache.entry(resolved, entryId);
      if (!entry) {
        throw new Error(
          "That history entry is no longer available; refresh the history and try again",
        );
      }
      return {
        entry_id: entry.id,
        text: entry.text,
        text_hash: historyTextHash(entry.text),
      };
    },
    readTurn: async (params: Record<string, unknown>) => {
      // The caller names the agent session it is showing. The receipt is only
      // published for that session: a replacement session in the same pane,
      // before or during the read, yields no receipt rather than its text.
      const expected =
        typeof params.agent_session_fingerprint === "string" &&
        /^[a-f0-9]{64}$/u.test(params.agent_session_fingerprint)
          ? params.agent_session_fingerprint
          : null;
      const sessionIsCurrent = async () =>
        expected === null ||
        (await paneSessionFingerprint(args.herdrCall, params.pane_id)) ===
          expected;
      const changed = {
        turn: null,
        session_changed: true,
        agent_session_fingerprint: expected,
      };
      const agentResult = await args.herdrCall("agent.get", {
        target: params.pane_id,
      });
      const agentInfo =
        isRecord(agentResult) && isRecord(agentResult.agent)
          ? agentResult.agent
          : null;
      const reportedSession = sessionFromAgentInfo(agentInfo);
      if (
        expected !== null &&
        reportedSession &&
        taskSummarySessionFingerprint(reportedSession) !== expected
      )
        return changed;
      const resolved = await resolveAgentSessionInfo(
        params,
        agentInfo,
        args.files,
        resolverContext,
        { herdrCall: args.herdrCall },
      );
      if (!resolved.file) {
        cache.invalidate(resolved);
        return { ...resolved, turn: null, agent_session_fingerprint: expected };
      }
      if (expected !== null && !reportedSession) return changed;
      if (
        expected !== null &&
        reportedSession?.agent === "codex" &&
        resolved.session?.source === "codex-title" &&
        !sameCodexThread(reportedSession, resolved.session)
      )
        return changed;
      const projection = await cache.get(resolved);
      const turn = latestTurnReceipt(
        projection.file,
        projection.trajectory,
        params.full_report === true ? FULL_REPORT_CHARS : undefined,
      );
      if (!(await sessionIsCurrent())) return changed;
      return {
        ...resolved,
        file: projection.file,
        updated_at: new Date(projection.file.mtimeMs).toISOString(),
        agent_session_fingerprint: expected,
        turn,
      };
    },
    readWorktreeMetadata: async (paneId: string, expected: string) => {
      if ((await paneSessionFingerprint(args.herdrCall, paneId)) !== expected)
        return null;
      const resolved = await resolveAgentSession(
        { pane_id: paneId },
        args.herdrCall,
        args.files,
        resolverContext,
      );
      if (
        !resolved.file ||
        !resolved.session ||
        taskSummarySessionFingerprint(resolved.session) !== expected
      )
        return null;
      const projection = await cache.get(resolved);
      if ((await paneSessionFingerprint(args.herdrCall, paneId)) !== expected)
        return null;
      return projection.worktree;
    },
    readSummary: (params: Record<string, unknown>) =>
      readAgentSessionSummary(
        params,
        args.herdrCall,
        args.files,
        resolverContext,
        cache,
      ),
    downloadFile: (params: Record<string, unknown>) =>
      downloadAgentSessionFile(
        params,
        args.herdrCall,
        args.files,
        resolverContext,
      ),
    downloadAtif: (params: Record<string, unknown>) =>
      downloadAgentSessionAtif(
        params,
        args.herdrCall,
        args.files,
        resolverContext,
        cache,
      ),
  };
  return {
    ...handlers,
    /** agent_history.get: the window, or with `before` an older page. */
    readHistoryRequest: (params: Record<string, unknown>) =>
      typeof params.before === "string"
        ? readOlder(params)
        : handlers.readHistory(params),
  };
}

export async function readAgentMessageHistory(
  rawParams: Record<string, unknown>,
  herdrCall: HerdrCall,
  files: AgentSessionFileAccess = localAgentSessionFiles,
  resolverContext?: AgentSessionResolverContext,
  cache?: SessionProjectionCache,
) {
  const resolved = await resolveAgentSession(
    rawParams,
    herdrCall,
    files,
    resolverContext,
  );
  if (!resolved.file) {
    cache?.invalidate(resolved);
    return {
      ...resolved,
      messages: [],
    };
  }
  const projected = cache
    ? await cache.get(resolved)
    : await readSessionProjection(resolved.agent, resolved.file, files);
  const messages = projected.messages.slice(-MAX_MESSAGES_PER_AGENT);
  return {
    ...resolved,
    file: projected.file,
    updated_at: new Date(projected.file.mtimeMs).toISOString(),
    messages,
  };
}

export async function readAgentSessionSummary(
  rawParams: Record<string, unknown>,
  herdrCall: HerdrCall,
  files: AgentSessionFileAccess = localAgentSessionFiles,
  resolverContext?: AgentSessionResolverContext,
  cache?: SessionProjectionCache,
) {
  const resolved = await resolveAgentSession(
    rawParams,
    herdrCall,
    files,
    resolverContext,
  );
  if (!resolved.file) {
    cache?.invalidate(resolved);
    return {
      ...resolved,
      stats: { turns: 0, records: 0, token_usage: null },
      text: null,
      truncated: false,
      trajectory: null,
    };
  }
  const projected = cache
    ? await cache.get(resolved)
    : await readSessionProjection(resolved.agent, resolved.file, files);
  const stats = projected.stats;
  const includeText = rawParams.include_text === true;
  const includeTrajectory = rawParams.include_trajectory === true;
  const previewLimit = Math.max(
    1,
    Math.min(Number(rawParams.preview_limit) || 512 * 1024, 2 * 1024 * 1024),
  );
  let text: string | null = null;
  let truncated = false;
  if (includeText) {
    if (resolved.agent === "agy") {
      const records = await readAntigravitySessionRecords(resolved.file.path);
      const ndjson = records.map((r) => JSON.stringify(r)).join("\n");
      truncated = ndjson.length > previewLimit;
      text = truncated ? ndjson.slice(0, previewLimit) : ndjson;
    } else {
      const bytes = await files.readPrefix(
        resolved.file.path,
        previewLimit + 1,
      );
      truncated =
        bytes.length > previewLimit ||
        (projected.file.size ?? 0) > previewLimit;
      text = new TextDecoder("utf-8", { fatal: false }).decode(
        truncated ? bytes.subarray(0, previewLimit) : bytes,
      );
    }
  }
  const trajectory = includeTrajectory ? projected.trajectory : null;
  return {
    ...resolved,
    file: projected.file,
    updated_at: new Date(projected.file.mtimeMs).toISOString(),
    stats,
    text,
    truncated,
    trajectory,
  };
}

function contentDispositionFilename(path: string) {
  const isDb = path.endsWith(".db");
  const fallbackDefault = isDb ? "session.db" : "session.jsonl";
  const fallback =
    basename(path).replace(/[^\x20-\x7e]|["\r\n]/g, "_") || fallbackDefault;
  return `attachment; filename="${fallback}"`;
}

function contentDispositionAtifFilename(file: SessionFile) {
  const name = (file.sessionId || basename(file.path))
    .replace(/\.[^.]+$/, "")
    .replace(/[^\x20-\x7e]|["\r\n]/g, "_");
  const filename = `${name || "session"}.atif.json`;
  return `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function downloadAgentSessionFile(
  rawParams: Record<string, unknown>,
  herdrCall: HerdrCall,
  files: AgentSessionFileAccess = localAgentSessionFiles,
  resolverContext?: AgentSessionResolverContext,
) {
  const resolved = await resolveAgentSession(
    rawParams,
    herdrCall,
    files,
    resolverContext,
  );
  const expectedSession = rawParams.expected_session;
  if (
    expectedSession !== undefined &&
    expectedSession !== null &&
    (typeof expectedSession !== "string" ||
      !expectedSession ||
      resolved.session?.value !== expectedSession)
  )
    return new Response("Agent session changed", { status: 409 });
  if (!resolved.file) {
    return new Response(resolved.detail || "session file unavailable", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const body = await files.readDownloadBody(resolved.file.path);
  if (typeof expectedSession === "string") {
    const current = await resolveAgentSession(
      rawParams,
      herdrCall,
      files,
      resolverContext,
    );
    if (current.session?.value !== expectedSession)
      return new Response("Agent session changed", { status: 409 });
  }
  const isDb = resolved.file.path.endsWith(".db");
  return new Response(body, {
    headers: {
      "content-type": isDb
        ? "application/vnd.sqlite3"
        : resolved.file.path.endsWith(".jsonl.zst")
          ? "application/zstd"
          : "application/x-ndjson; charset=utf-8",
      "content-length": String(resolved.file.size ?? 0),
      "content-disposition": contentDispositionFilename(resolved.file.path),
      "x-agent-session-path": encodeURIComponent(resolved.file.path),
    },
  });
}

export async function downloadAgentSessionAtif(
  rawParams: Record<string, unknown>,
  herdrCall: HerdrCall,
  files: AgentSessionFileAccess = localAgentSessionFiles,
  resolverContext?: AgentSessionResolverContext,
  cache?: SessionProjectionCache,
) {
  const resolved = await resolveAgentSession(
    rawParams,
    herdrCall,
    files,
    resolverContext,
  );
  const expectedSession = rawParams.expected_session;
  if (
    expectedSession !== undefined &&
    expectedSession !== null &&
    (typeof expectedSession !== "string" ||
      !expectedSession ||
      resolved.session?.value !== expectedSession)
  )
    return new Response("Agent session changed", { status: 409 });
  if (!resolved.file) {
    return new Response(resolved.detail || "session file unavailable", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const { trajectory } = cache
    ? await cache.get(resolved)
    : await readSessionProjection(resolved.agent, resolved.file, files);
  if (typeof expectedSession === "string") {
    const current = await resolveAgentSession(
      rawParams,
      herdrCall,
      files,
      resolverContext,
    );
    if (current.session?.value !== expectedSession)
      return new Response("Agent session changed", { status: 409 });
  }
  return new Response(`${JSON.stringify(trajectory, null, 2)}\n`, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": contentDispositionAtifFilename(resolved.file),
      "x-agent-session-path": encodeURIComponent(resolved.file.path),
    },
  });
}

function sessionFromAgentInfo(
  agentInfo: Record<string, unknown> | null,
): AgentSessionInfo | null {
  const raw = agentInfo?.agent_session;
  if (!isRecord(raw)) return null;
  const { source, agent, kind, value } = raw;
  if (
    typeof source !== "string" ||
    !source ||
    typeof agent !== "string" ||
    !agent ||
    (kind !== "id" && kind !== "path") ||
    typeof value !== "string" ||
    !value
  )
    return null;
  return { source, agent, kind, value };
}

/** A resolved Codex title may name the full ID for a reported ID prefix. */
function sameCodexThread(
  reported: AgentSessionInfo,
  resolved: AgentSessionInfo,
) {
  if (reported.kind !== "id" || resolved.kind !== "id") return false;
  const a = reported.value.toLowerCase();
  const b = resolved.value.toLowerCase();
  return a.startsWith(b) || b.startsWith(a);
}

/** The fingerprint of the agent session Herdr currently reports for a pane. */
async function paneSessionFingerprint(
  herdrCall: HerdrCall,
  paneId: unknown,
): Promise<string | null> {
  if (typeof paneId !== "string" || !paneId) return null;
  const result = (await herdrCall("pane.get", { pane_id: paneId })) as Record<
    string,
    unknown
  > | null;
  const pane =
    result && typeof result.pane === "object" && result.pane
      ? (result.pane as Record<string, unknown>)
      : result;
  const session = pane?.agent_session as Record<string, unknown> | undefined;
  if (
    !session ||
    pane?.pane_id !== paneId ||
    ["source", "agent", "kind", "value"].some(
      (key) => typeof session[key] !== "string" || !session[key],
    )
  )
    return null;
  return taskSummarySessionFingerprint(
    session as { source: string; agent: string; kind: string; value: string },
  );
}
