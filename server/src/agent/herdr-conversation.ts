import { createHash } from "node:crypto";
import { taskSummarySessionFingerprint } from "../herdr/task-summary";
import {
  conversationMessages,
  latestAssistantMessage,
  type Conversation,
  type ConversationBinding,
  type ConversationLatest,
  type ConversationSource,
  type ConversationUnavailableReason,
} from "./conversation";
import type { AgentSessionFileAccess } from "./session-file-access";
import type { SessionProjectionCache } from "./session-projection-cache";
import {
  SESSION_AGENTS,
  codexTitleBinding,
  resolveAgentSessionInfo,
  type AgentSessionResolverContext,
} from "./session-resolver";
import type { HerdrCall } from "./session-types";
import { isRecord, normalizeAgentName, stringValue } from "./session-utils";

export const CODEX_DAEMON_ISSUE =
  "https://github.com/IvoryHeart/herdr-world/issues/250";

type Unavailable = Extract<Conversation, { status: "unavailable" }>;

/**
 * The session Herdr ties to a pane, from its `agent.get` reply alone: the
 * thread a Codex title names, else the session the integration reported.
 * Directory guesses are never a binding. No file access, so a send can check
 * it immediately before prompting. A Codex title binds a complete thread ID
 * only: a truncated ID this context has not resolved to one transcript, or a
 * title naming two threads, binds the pane to its title with no fingerprint,
 * so nothing can be sent.
 */
export function paneBinding(
  agent: string,
  info: Record<string, unknown>,
  context: AgentSessionResolverContext,
): {
  binding: Exclude<ConversationBinding, "guessed">;
  fingerprint: string | null;
} | null {
  if (agent === "codex") {
    const title = codexTitleBinding(stringValue(info.terminal_title), context);
    if (title.kind === "id")
      return {
        binding: "title",
        fingerprint: createHash("sha256")
          .update(JSON.stringify(["codex-title", title.id]))
          .digest("hex"),
      };
    // The title decides whenever it names a thread.
    if (title.kind !== "none") return { binding: "title", fingerprint: null };
  }
  const session = isRecord(info.agent_session) ? info.agent_session : null;
  if (
    !session ||
    ["source", "agent", "kind", "value"].some(
      (key) => typeof session[key] !== "string" || !session[key],
    )
  )
    return null;
  return {
    binding: "reported",
    fingerprint: taskSummarySessionFingerprint(
      session as { source: string; agent: string; kind: string; value: string },
    ),
  };
}

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

  const resolve = async (paneId: string, reuseCodexTitle = false) => {
    const info = await agentInfo(paneId);
    const agent = normalizeAgentName(stringValue(info?.agent));
    const base: Omit<Conversation, "status" | "unavailable"> = {
      conversation_version: 1,
      source: "herdr",
      pane_id: paneId,
      agent: agent || null,
      agent_status: stringValue(info?.agent_status) || null,
      session_binding: null,
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
    // The Grok and Antigravity readers, and Claude and Kimi ID lookups, only
    // open files on this machine. A remote pane must never show a local
    // transcript, so these are refused rather than read.
    if (
      args.files.remote &&
      (agent === "grok" ||
        agent === "agy" ||
        (reported &&
          reported.kind !== "path" &&
          agent !== "pi" &&
          agent !== "codex"))
    )
      return unavailable(
        base,
        "remote_lookup",
        "Chat cannot read this agent's conversation on an SSH host yet.",
      );
    const resolved = await resolveAgentSessionInfo(
      { pane_id: paneId },
      info,
      args.files,
      args.context,
      { reuseCodexTitle },
    );
    // A session found by searching the pane's directory may belong to
    // another agent in the same folder: show it, but never send to it.
    const bound = resolved.session?.source.endsWith("-local")
      ? null
      : paneBinding(agent, info, args.context);
    return {
      base: {
        ...base,
        session_binding:
          bound?.binding ?? (resolved.session ? ("guessed" as const) : null),
        session_fingerprint: bound?.fingerprint ?? null,
      },
      resolved,
    };
  };

  const read = async ({
    pane_id,
  }: {
    pane_id: string;
  }): Promise<Conversation> => {
    const step = await resolve(pane_id);
    if (!("resolved" in step)) return step;
    const { base, resolved } = step;
    // A new Codex thread has no transcript until its first message; it is
    // still the pane's conversation, so Chat keeps its composer.
    if (
      resolved.reason === "no_messages_yet" &&
      base.session_binding === "title"
    )
      return { ...base, status: "ok", unavailable: null };
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
    identity: async ({ pane_id }) => {
      // Watching runs on every Herdr event; it need not search Codex
      // transcripts again for a title it already resolved.
      const step = await resolve(pane_id, true);
      if (!("resolved" in step))
        return {
          key: JSON.stringify([step.agent, step.unavailable.reason]),
          path: null,
        };
      const { base, resolved } = step;
      const file = resolved.file;
      return {
        key: JSON.stringify([
          base.agent_status,
          base.session_binding,
          base.session_fingerprint,
          resolved.reason ?? null,
          resolved.session?.value ?? null,
          file?.path ?? null,
          file?.mtimeMs ?? null,
          file?.size ?? null,
          file?.changeToken ?? null,
        ]),
        path: file && !args.files.remote ? file.path : null,
      };
    },
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
                  session_binding: null,
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
      // Re-read the pane immediately before prompting, with no other await
      // in between. Herdr's prompt takes no expected session, so a switch
      // after this reply and before the prompt lands is still possible.
      const info =
        args.remotePlatform === "windows" ? null : await agentInfo(pane_id);
      const agent = normalizeAgentName(stringValue(info?.agent));
      const bound =
        info && SESSION_AGENTS.has(agent)
          ? paneBinding(agent, info, args.context)
          : null;
      if (!bound?.fingerprint)
        return {
          status: "refused",
          reason: "unavailable",
          message:
            "Herdr has not tied one conversation to this pane, so nothing was sent. Use the Terminal tab.",
        };
      if (bound.fingerprint !== session_fingerprint)
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
