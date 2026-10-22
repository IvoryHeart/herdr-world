import { taskSummarySessionFingerprint } from "../herdr/task-summary";
import {
  conversationMessages,
  latestAssistantMessage,
  type Conversation,
  type ConversationLatest,
  type ConversationSource,
  type ConversationUnavailableReason,
} from "./conversation";
import type { AgentSessionFileAccess } from "./session-file-access";
import type { SessionProjectionCache } from "./session-projection-cache";
import {
  SESSION_AGENTS,
  resolveAgentSessionInfo,
  type AgentSessionResolverContext,
} from "./session-resolver";
import type { AgentSessionResolved, HerdrCall } from "./session-types";
import { isRecord, normalizeAgentName, stringValue } from "./session-utils";

export const CODEX_DAEMON_ISSUE =
  "https://github.com/IvoryHeart/herdr-world/issues/250";

type Unavailable = Extract<Conversation, { status: "unavailable" }>;

function withoutMessages(conversation: Conversation): ConversationLatest {
  const latest: Partial<Conversation> = { ...conversation };
  delete latest.messages;
  return latest as ConversationLatest;
}

/**
 * The Herdr conversation source: the agent and session Herdr reports for a
 * pane (or the Codex thread its title names), read through the shared
 * session resolver and projection cache that History uses.
 */
export function createHerdrConversationSource(args: {
  herdrCall: HerdrCall;
  files: AgentSessionFileAccess;
  context: AgentSessionResolverContext;
  cache: SessionProjectionCache;
  remotePlatform?: string;
}): ConversationSource {
  const agentInfo = async (paneId: string) => {
    let result: unknown;
    try {
      result = await args.herdrCall("agent.get", { target: paneId });
    } catch (error) {
      // A shell pane is not an agent target.
      if (error instanceof Error && /^agent_not_found:/.test(error.message))
        return null;
      throw error;
    }
    return isRecord(result) && isRecord(result.agent) ? result.agent : null;
  };

  const unavailable = (
    base: Omit<Conversation, "status" | "unavailable">,
    reason: ConversationUnavailableReason,
    detail: string,
    extra: { command?: string; issue?: string } = {},
  ): Unavailable => ({
    ...base,
    status: "unavailable",
    unavailable: { reason, detail, ...extra },
  });

  const resolve = async (paneId: string) => {
    const info = await agentInfo(paneId);
    const agent = normalizeAgentName(stringValue(info?.agent));
    const base = {
      conversation_version: 1 as const,
      source: "herdr",
      pane_id: paneId,
      agent: agent || null,
      agent_status: stringValue(info?.agent_status) || null,
      session_fingerprint: null,
      updated_at: null,
      messages: [],
      latest: null,
    };
    if (args.remotePlatform === "windows")
      return unavailable(
        base,
        "unsupported_platform",
        "Chat cannot read conversations on a Windows host yet.",
      );
    if (!info || !agent)
      return unavailable(
        base,
        "no_agent",
        "Herdr does not see an agent in this pane.",
      );
    if (!SESSION_AGENTS.has(agent))
      return unavailable(
        base,
        "unsupported_harness",
        `Chat cannot read ${agent} conversations yet.`,
      );
    const reported = isRecord(info.agent_session) ? info.agent_session : null;
    // ID and directory lookups for these harnesses search this machine. A
    // remote pane must never show a local transcript.
    if (
      args.files.remote &&
      reported?.kind !== "path" &&
      (agent === "grok" ||
        agent === "agy" ||
        (reported && agent !== "pi" && agent !== "codex"))
    )
      return unavailable(
        base,
        "remote_lookup",
        "Herdr did not report a transcript path for this remote agent, so Chat cannot find its conversation.",
      );
    const resolved = await resolveAgentSessionInfo(
      { pane_id: paneId },
      info,
      args.files,
      args.context,
    );
    return { base, resolved };
  };

  const fingerprint = (resolved: AgentSessionResolved) =>
    resolved.session ? taskSummarySessionFingerprint(resolved.session) : null;

  const read = async ({
    pane_id,
  }: {
    pane_id: string;
  }): Promise<Conversation> => {
    const step = await resolve(pane_id);
    if (!("resolved" in step)) return step;
    const { base, resolved } = step;
    if (!resolved.file) {
      args.cache.invalidate(resolved);
      const reason = resolved.reason ?? "no_session";
      return unavailable(base, reason, resolved.detail, {
        ...(resolved.command ? { command: resolved.command } : {}),
        ...(reason === "codex_unlinked" ? { issue: CODEX_DAEMON_ISSUE } : {}),
      });
    }
    try {
      const projection = await args.cache.get(resolved);
      const messages = conversationMessages(projection.entries);
      return {
        ...base,
        status: "ok",
        unavailable: null,
        session_fingerprint: fingerprint(resolved),
        updated_at: new Date(projection.file.mtimeMs).toISOString(),
        messages,
        latest: latestAssistantMessage(messages),
      } satisfies Conversation;
    } catch (error) {
      args.cache.invalidate(resolved);
      return unavailable(
        base,
        "read_failed",
        `Could not read the ${resolved.agent} transcript: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const latest = async (target: { pane_id: string }) =>
    withoutMessages(await read(target));

  return {
    id: "herdr",
    read,
    latest,
    latestAll: async (paneIds) => {
      const ids =
        paneIds ??
        (await (async () => {
          const result = await args.herdrCall("agent.list", {});
          const agents =
            isRecord(result) && Array.isArray(result.agents)
              ? result.agents
              : [];
          return agents
            .filter(isRecord)
            .map((agent) => stringValue(agent.pane_id))
            .filter(Boolean);
        })());
      const results: Conversation[] = [];
      // Bound filesystem and SSH work when many agents are open.
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, ids.length) }, async () => {
          while (next < ids.length) {
            const index = next++;
            const pane_id = ids[index]!;
            results[index] = await read({ pane_id }).catch((error) =>
              unavailable(
                {
                  conversation_version: 1,
                  source: "herdr",
                  pane_id,
                  agent: null,
                  agent_status: null,
                  session_fingerprint: null,
                  updated_at: null,
                  messages: [],
                  latest: null,
                },
                "read_failed",
                error instanceof Error ? error.message : String(error),
              ),
            );
          }
        }),
      );
      return results.map(withoutMessages);
    },
    send: async ({ pane_id, text, session_fingerprint }) => {
      if (!text.trim())
        return {
          status: "refused",
          reason: "empty",
          message: "Write a message first.",
        };
      const step = await resolve(pane_id);
      if (!("resolved" in step) || !step.resolved.file)
        return {
          status: "refused",
          reason: "unavailable",
          message:
            "Chat cannot read this conversation, so nothing was sent. Use the Terminal tab.",
        };
      if (fingerprint(step.resolved) !== session_fingerprint)
        return {
          status: "refused",
          reason: "changed",
          message:
            "The conversation in this pane changed. Nothing was sent; check it and send again.",
        };
      try {
        const result = await args.herdrCall("agent.prompt", {
          target: pane_id,
          text,
        });
        const sent =
          isRecord(result) && isRecord(result.agent) ? result.agent : null;
        if (sent?.pane_id !== pane_id)
          throw new Error(
            "Herdr did not confirm the prompt; check the agent before sending again.",
          );
        return { status: "sent" };
      } catch (error) {
        // Herdr rejects a blocked agent before submitting any input.
        if (error instanceof Error && /^agent_blocked:/.test(error.message))
          return {
            status: "refused",
            reason: "blocked",
            message:
              "The agent is waiting on a question; answer it first. Nothing was sent.",
          };
        throw error;
      }
    },
  };
}
