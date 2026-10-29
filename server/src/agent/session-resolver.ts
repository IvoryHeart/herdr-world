import { existsSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type {
  AgentHistoryParams,
  AgentSessionInfo,
  AgentSessionResolved,
  HerdrCall,
  SessionFile,
} from "./session-types";
import {
  localAgentSessionFiles,
  codexHome,
  type AgentSessionFileAccess,
} from "./session-file-access";
import {
  describeGrokSessionPath,
  findGrokSessionById,
  findGrokSessionForCwd,
} from "./grok-session";
import {
  describeAntigravitySessionPath,
  findAntigravitySessionById,
  findAntigravitySessionForCwd,
} from "./antigravity-session";
import { findMuseSession, type MuseMetadataCache } from "./muse-session";
import { normalizeAgentName, SESSION_AGENTS } from "./chat-harnesses";
import {
  codexPanes,
  inferCodexDaemonThread,
  type CodexInferenceBatch,
} from "./codex-daemon-binding";
import {
  createCodexDiscoveryCache,
  type CodexDiscoveryScope,
} from "./codex-discovery-cache";
import {
  integrationInstallCommand,
  isRecord,
  stringValue,
} from "./session-utils";

export { SESSION_AGENTS };

export type AgentSessionResolverContext = {
  pathCache: Map<string, string>;
  museMetadata: MuseMetadataCache;
  /** Codex title ID (or prefix) → the one transcript it resolved to. */
  codexTitles: Map<string, { id: string; path: string }>;
  codexDiscovery: ReturnType<typeof createCodexDiscoveryCache>;
};

const DEFAULT_RESOLVER_CONTEXT = createAgentSessionResolverContext();

export function createAgentSessionResolverContext(
  scope?: CodexDiscoveryScope,
): AgentSessionResolverContext {
  return {
    pathCache: new Map(),
    museMetadata: new Map(),
    codexTitles: new Map(),
    codexDiscovery: createCodexDiscoveryCache(scope),
  };
}

function normalizeParams(raw: Record<string, unknown>): AgentHistoryParams {
  return {
    pane_id: stringValue(raw.pane_id),
    workspace_id: stringValue(raw.workspace_id),
    tab_id: stringValue(raw.tab_id),
    agent: stringValue(raw.agent),
  };
}

export function piAgentDirectory() {
  const configured = process.env.PI_CODING_AGENT_DIR?.trim();
  if (!configured) return join(homedir(), ".pi", "agent");
  if (configured === "~") return homedir();
  if (configured.startsWith("~/")) {
    return join(homedir(), configured.slice(2));
  }
  return resolve(configured);
}

async function walkFiles(root: string, match: (path: string) => boolean) {
  const results: string[] = [];
  async function visit(dir: string, depth: number) {
    if (depth > 8 || results.length > 200) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(path, depth + 1);
      } else if (entry.isFile() && match(path)) {
        results.push(path);
      }
    }
  }
  await visit(root, 0);
  return results;
}

async function resolveCachedSessionPath(
  context: AgentSessionResolverContext,
  cacheKey: string,
  resolvePath: () => Promise<string | null>,
) {
  const cached = context.pathCache.get(cacheKey);
  if (cached && existsSync(cached)) return cached;
  const path = await resolvePath();
  if (path) context.pathCache.set(cacheKey, path);
  return path;
}

async function findCodexSession(
  id: string,
  files: AgentSessionFileAccess,
  context: AgentSessionResolverContext,
) {
  const key = `codex:${files.remote ? "remote" : codexHome()}:${id}`;
  const cached = context.pathCache.get(key);
  if (cached) {
    const file = await files.statFile(cached);
    if (file) return file;
    context.pathCache.delete(key);
  }
  const file = await files.findCodexSessionById(id);
  if (file) context.pathCache.set(key, file.path);
  return file;
}

const CODEX_TITLE_ID =
  /(?<![0-9a-f-])([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-(?:[0-9a-f]{12}(?![0-9a-f-])|[0-9a-f]{5,11}(?:\.\.\.|\u2026)))/gi;

/**
 * UUID-shaped tokens in a Codex pane title. Codex truncates each title item to
 * 32 characters, so its `thread-id` item shows 29 ID characters and "...":
 * `truncated` marks those. A full UUID may be a thread or, say, a project name.
 */
export function codexIdsFromTitle(title: string) {
  return [...title.matchAll(CODEX_TITLE_ID)].map(([, token]) => {
    const truncated = /(?:\.\.\.|\u2026)$/.test(token);
    return {
      prefix: token.replace(/(?:\.\.\.|\u2026)$/, "").toLowerCase(),
      truncated,
    };
  });
}

type CodexTitleThread =
  | { kind: "none" }
  | { kind: "pending" }
  | { kind: "ambiguous" }
  | { kind: "found"; file: SessionFile; id: string };

/** The thread IDs a Codex title offers, by the rule the resolver uses. */
function codexTitleCandidates(title: string) {
  const ids = codexIdsFromTitle(title);
  // Codex truncates its thread item today, so a truncated ID is the thread;
  // full UUIDs are candidates only when no truncated ID is present.
  const truncated = ids.filter((id) => id.truncated);
  return truncated.length ? truncated : ids;
}

/**
 * The complete thread ID a Codex title binds the pane to, without file
 * access: a full UUID in the title, or a truncated one this context already
 * resolved to exactly one transcript. A prefix that is not yet resolved, or a
 * title naming two threads, binds nothing.
 */
export function codexTitleBinding(
  title: string,
  context: AgentSessionResolverContext,
  /** When given, only these just-searched prefix matches count. */
  verified?: ReadonlyMap<string, string>,
):
  | { kind: "none" }
  | { kind: "unresolved" }
  | { kind: "ambiguous" }
  | { kind: "id"; id: string } {
  const candidates = codexTitleCandidates(title);
  if (candidates.length === 0) return { kind: "none" };
  const distinct = new Map(candidates.map((id) => [id.prefix, id]));
  if (distinct.size > 1) return { kind: "ambiguous" };
  const [only] = distinct.values();
  if (!only!.truncated) return { kind: "id", id: only!.prefix };
  const id = verified
    ? verified.get(only!.prefix)
    : context.codexTitles.get(only!.prefix)?.id;
  return id ? { kind: "id", id } : { kind: "unresolved" };
}

/**
 * Search the transcripts a Codex title names now, ignoring remembered
 * matches: a send must not trust a match made before another transcript
 * with the same prefix appeared. Returns each title prefix that matched
 * exactly one transcript, with its complete ID.
 */
export async function searchCodexTitle(
  title: string,
  files: AgentSessionFileAccess,
  context: AgentSessionResolverContext,
): Promise<Map<string, string>> {
  const thread = await codexThreadFromTitle(title, files, context);
  const verified = new Map<string, string>();
  if (thread.kind !== "found") return verified;
  for (const { prefix } of codexTitleCandidates(title))
    if (thread.id.startsWith(prefix)) verified.set(prefix, thread.id);
  return verified;
}

/**
 * Codex 0.157+ hosts threads in a shared daemon, so hooks cannot say which
 * pane shows which thread. With Thread ID in `tui.terminal_title`, the pane's
 * own front end names its thread. Accept only an ID that matches exactly one
 * transcript. Each read searches again, so a later colliding transcript is
 * never missed, and remembers a unique match. A caller that only needs to
 * notice changes (`reuse`) stats the remembered transcript instead. That is
 * safe only while something forgets remembered matches whenever a Codex
 * transcript is created or removed (see the Herdr conversation source);
 * without that, it searches only while the thread has no transcript or
 * matches several, or when the title names another thread.
 */
async function codexThreadFromTitle(
  title: string,
  files: AgentSessionFileAccess,
  context: AgentSessionResolverContext,
  reuse = false,
): Promise<CodexTitleThread> {
  const candidates = codexTitleCandidates(title);
  const forget = () => {
    for (const { prefix } of candidates) context.codexTitles.delete(prefix);
  };
  const found = new Map<string, SessionFile>();
  for (const { prefix } of candidates) {
    const cached = reuse ? context.codexTitles.get(prefix) : undefined;
    const known = cached ? await files.statFile(cached.path) : null;
    if (known) {
      found.set(known.path, known);
      continue;
    }
    const file = await files.findCodexSessionByPrefix(prefix);
    if (file === "ambiguous") {
      forget();
      return { kind: "ambiguous" };
    }
    if (file) found.set(file.path, file);
  }
  if (found.size > 1) {
    forget();
    return { kind: "ambiguous" };
  }
  const [file] = found.values();
  if (file) {
    const id = CODEX_FULL_ID.exec(basename(file.path))?.[0]?.toLowerCase();
    if (!id) return { kind: "ambiguous" };
    for (const { prefix } of candidates)
      if (id.startsWith(prefix))
        context.codexTitles.set(prefix, { id, path: file.path });
    return { kind: "found", file, id };
  }
  forget();
  // A thread ID without a transcript is a thread with no messages yet. A bare
  // UUID in another title item lands here too: hiding a report beats showing
  // a stale one.
  return candidates.length ? { kind: "pending" } : { kind: "none" };
}

const CODEX_FULL_ID =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\.jsonl(?:\.zst)?$)/i;

async function findClaudeSession(
  id: string,
  context: AgentSessionResolverContext,
) {
  return resolveCachedSessionPath(context, `claude:${id}`, async () => {
    const root = join(homedir(), ".claude", "projects");
    const files = await walkFiles(
      root,
      (path) => basename(path) === `${id}.jsonl`,
    );
    return newestFile(files);
  });
}

async function findKimiSession(
  id: string,
  context: AgentSessionResolverContext,
) {
  return resolveCachedSessionPath(context, `kimi:${id}`, async () => {
    const root = join(homedir(), ".kimi-code", "sessions");
    const suffix = join(id, "agents", "main", "wire.jsonl");
    const files = await walkFiles(
      root,
      (path) =>
        path.endsWith(suffix) || path.includes(`/${id}/agents/main/wire.jsonl`),
    );
    return newestFile(files);
  });
}

async function findPiSession(id: string, context: AgentSessionResolverContext) {
  return resolveCachedSessionPath(context, `pi:${id}`, async () => {
    const root = join(piAgentDirectory(), "sessions");
    const files = await walkFiles(root, (path) => {
      const name = basename(path);
      return name === `${id}.jsonl` || name.endsWith(`_${id}.jsonl`);
    });
    return newestFile(files);
  });
}

function newestFile(paths: string[]) {
  return (
    paths
      .map((path) => {
        try {
          return { path, mtimeMs: statSync(path).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter((file): file is SessionFile => !!file)
      .toSorted((a, b) => b.mtimeMs - a.mtimeMs)[0]?.path ?? null
  );
}

async function sessionFileFor(
  agent: string,
  session: AgentSessionInfo,
  cwd: string,
  files: AgentSessionFileAccess,
  context: AgentSessionResolverContext,
) {
  // The Grok and Antigravity readers only open files on this machine.
  if ((agent === "grok" || agent === "agy") && files.remote) return null;
  if (agent === "grok") {
    const descriptor =
      session.kind === "path"
        ? await describeGrokSessionPath(resolve(session.value))
        : await findGrokSessionById(session.value, cwd);
    return descriptor?.file ?? null;
  }
  if (agent === "agy") {
    const descriptor =
      session.kind === "path"
        ? await describeAntigravitySessionPath(resolve(session.value))
        : await findAntigravitySessionById(session.value, cwd);
    return descriptor?.file ?? null;
  }
  if (session.kind === "path") {
    const path = resolve(session.value);
    return files.statFile(path);
  }
  if (agent === "muse") {
    // A remote ID must never resolve to this machine's unrelated transcript.
    return files.remote ? null : findMuseSession({ id: session.value });
  }
  if (agent === "pi" && files.remote) {
    return files.findPiSessionById(session.value);
  }
  if (agent === "claude" && files.remote) {
    return files.findClaudeSessionById?.(session.value) ?? null;
  }
  if (agent === "codex") return findCodexSession(session.value, files, context);
  let path: string | null = null;
  if (agent === "claude")
    path = await findClaudeSession(session.value, context);
  if (agent === "kimi") path = await findKimiSession(session.value, context);
  if (agent === "pi") path = await findPiSession(session.value, context);
  if (path) return files.statFile(path);
  return null;
}

function parseAgentInfo(result: unknown) {
  return isRecord(result) && isRecord(result.agent) ? result.agent : null;
}

function parseAgentSession(agentInfo: Record<string, unknown> | null) {
  const raw = agentInfo?.agent_session;
  if (!isRecord(raw)) return null;
  const kind = stringValue(raw.kind).toLowerCase();
  const value = stringValue(raw.value);
  if ((kind !== "id" && kind !== "path") || !value) return null;
  return {
    source: stringValue(raw.source),
    agent: stringValue(raw.agent),
    kind,
    value,
  } satisfies AgentSessionInfo;
}

/** A daemon hook can report its starter pane's ID for another TUI's thread. */
export async function codexReportContradicted(
  paneId: string,
  info: Record<string, unknown>,
  herdrCall: HerdrCall,
  listed?: readonly Record<string, unknown>[],
) {
  const session = parseAgentSession(info);
  if (!session || codexIdsFromTitle(stringValue(info.terminal_title)).length)
    return false;
  try {
    const panes = await codexPanes(herdrCall, listed);
    if (!panes) return false; // No contradiction has been observed.
    if (!panes.some((pane) => pane.pane_id === paneId)) return true;
    return panes.some(
      (pane) =>
        pane.pane_id !== paneId &&
        (parseAgentSession(pane)?.value === session.value ||
          (session.kind === "id" &&
            codexIdsFromTitle(stringValue(pane.terminal_title)).some((id) =>
              session.value.toLowerCase().startsWith(id.prefix),
            ))),
    );
  } catch {
    return false;
  }
}

export async function resolveAgentSession(
  rawParams: Record<string, unknown>,
  herdrCall: HerdrCall,
  files: AgentSessionFileAccess = localAgentSessionFiles,
  context: AgentSessionResolverContext = DEFAULT_RESOLVER_CONTEXT,
): Promise<AgentSessionResolved> {
  const params = normalizeParams(rawParams);
  if (!params.pane_id) throw new Error("agent session requires pane_id");

  const result = await herdrCall("agent.get", { target: params.pane_id });
  return resolveAgentSessionInfo(
    rawParams,
    parseAgentInfo(result),
    files,
    context,
    { herdrCall },
  );
}

/** Resolve an existing agent snapshot without another Herdr request. */
export async function resolveAgentSessionInfo(
  rawParams: Record<string, unknown>,
  agentInfo: Record<string, unknown> | null,
  files: AgentSessionFileAccess,
  context: AgentSessionResolverContext,
  /** Change detection may reuse a remembered Codex title match. */
  options: {
    reuseCodexTitle?: boolean;
    herdrCall?: HerdrCall;
    listedCodexPanes?: readonly Record<string, unknown>[];
    codexInferenceBatch?: CodexInferenceBatch;
  } = {},
): Promise<AgentSessionResolved> {
  const params = normalizeParams(rawParams);
  if (!params.pane_id) throw new Error("agent session requires pane_id");
  const session = parseAgentSession(agentInfo);
  const agent = normalizeAgentName(
    stringValue(agentInfo?.agent) || session?.agent || params.agent || "",
  );
  if (!SESSION_AGENTS.has(agent)) {
    throw new Error(
      `agent session only supports codex, claude, kimi, grok, pi, muse, and agy`,
    );
  }
  // Native session files follow the agent process, which may have been
  // launched after `cd`. Herdr's `cwd` remains the pane's identity directory.
  const cwd =
    stringValue(agentInfo?.foreground_cwd) || stringValue(agentInfo?.cwd);
  const base = {
    version: 1 as const,
    agent,
    pane_id: params.pane_id,
    workspace_id:
      stringValue(agentInfo?.workspace_id) || params.workspace_id || "",
    tab_id: stringValue(agentInfo?.tab_id) || params.tab_id || "",
  };
  let resolvedSession = session;
  let file: SessionFile | null = null;
  if (agent === "codex") {
    const title = await codexThreadFromTitle(
      stringValue(agentInfo?.terminal_title),
      files,
      context,
      options.reuseCodexTitle,
    );
    if (title.kind === "found") {
      // The title follows thread switches; a Herdr report may be stale.
      file = title.file;
      resolvedSession = {
        source: "codex-title",
        agent: "codex",
        kind: "id",
        value: title.id,
      };
    } else if (title.kind !== "none") {
      // Never let a possibly stale report stand in for the shown thread.
      return {
        ...base,
        status: "missing_file",
        reason: title.kind === "pending" ? "no_messages_yet" : "ambiguous",
        detail:
          title.kind === "pending"
            ? "This Codex conversation has no saved messages yet."
            : "More than one Codex transcript matches this pane's title.",
        updated_at: new Date(0).toISOString(),
        path: "",
        session: null,
        file: null,
      };
    } else if (
      agentInfo &&
      options.herdrCall &&
      (await codexReportContradicted(
        params.pane_id,
        agentInfo,
        options.herdrCall,
        options.listedCodexPanes,
      ))
    ) {
      return {
        ...base,
        status: "missing_session",
        reason: "ambiguous",
        detail:
          "Conflicting Codex panes claim this session. Add Thread ID in /title or link the intended session explicitly.",
        updated_at: new Date(0).toISOString(),
        path: "",
        session: null,
        file: null,
      };
    } else if (!resolvedSession && agentInfo && options.herdrCall) {
      const thread = await inferCodexDaemonThread({
        paneId: params.pane_id,
        info: agentInfo,
        files,
        herdrCall: options.herdrCall,
        discovery: context.codexDiscovery,
        batch: options.codexInferenceBatch,
      });
      if (thread) {
        // Inference is never reported back to Herdr or promoted to Send authority.
        resolvedSession = {
          source: "codex-daemon",
          agent: "codex",
          kind: "id",
          value: thread.id,
        };
      }
    }
  }
  if (agent === "grok" && !resolvedSession && !files.remote) {
    const descriptor = await findGrokSessionForCwd(cwd);
    if (descriptor) {
      file = descriptor.file;
      resolvedSession = {
        source: "grok-local",
        agent: "grok",
        kind: "id",
        value: descriptor.session.sessionId,
      };
    }
  }
  if (agent === "agy" && !resolvedSession && !files.remote) {
    const descriptor = await findAntigravitySessionForCwd(cwd);
    if (descriptor) {
      file = descriptor.file;
      resolvedSession = {
        source: "agy-local",
        agent: "agy",
        kind: "id",
        value: descriptor.session.sessionId,
      };
    }
  }
  if (agent === "muse" && !resolvedSession && !files.remote) {
    file = await findMuseSession({ cwd, metadataCache: context.museMetadata });
    if (file?.sessionId) {
      resolvedSession = {
        source: "muse-local",
        agent: "muse",
        kind: "id",
        value: file.sessionId,
      };
    }
  }
  if (!resolvedSession) {
    return {
      ...base,
      status: "missing_session",
      reason: agent === "codex" ? "codex_unlinked" : "no_session",
      detail:
        agent === "muse"
          ? files.remote
            ? "Muse session inspection over SSH requires a Herdr-reported transcript path. Local session discovery is not used for remote panes."
            : cwd
              ? `No local Muse Code session was found for ${cwd}. Start Muse Code in this directory without --no-session-log, then refresh.`
              : "Herdr did not report a working directory for this Muse Code pane."
          : (agent === "grok" || agent === "agy") && files.remote
            ? "World cannot read this agent's sessions on an SSH host yet."
            : agent === "grok"
              ? cwd
                ? `No local Grok Build session was found for ${cwd}. Start Grok Build in this directory, then refresh.`
                : "Herdr did not report a working directory for this Grok Build pane."
              : agent === "agy"
                ? cwd
                  ? `No local Antigravity session was found for ${cwd}. Start Antigravity in this directory, then refresh.`
                  : "Herdr did not report a working directory for this Antigravity pane."
                : agent === "codex"
                  ? "Herdr has not received this pane's Codex session. Install or update the Codex integration on the agent's machine, then start or resume Codex with --no-daemon so its hooks use this pane's environment. For an existing conversation, use /title and add Thread ID to identify it without restarting."
                  : "Herdr has not received an agent session id for this pane. Install the Herdr integration for this agent and start a new agent session.",
      command:
        agent === "grok" || agent === "muse"
          ? undefined
          : integrationInstallCommand(agent),
      updated_at: new Date(0).toISOString(),
      path: "",
      session: null,
      file: null,
    };
  }

  file ??= await sessionFileFor(agent, resolvedSession, cwd, files, context);
  if (!file) {
    return {
      ...base,
      status: "missing_file",
      reason: "file_missing",
      detail: `Could not find the ${agent} session transcript for ${resolvedSession.value}.`,
      updated_at: new Date(0).toISOString(),
      path: "",
      session: resolvedSession,
      file: null,
    };
  }
  return {
    ...base,
    status: "ok",
    detail: "",
    updated_at: new Date(file.mtimeMs).toISOString(),
    path: file.path,
    session: resolvedSession,
    file,
  };
}
