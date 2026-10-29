import { createPromptActions } from "./prompt-answer";
import { isSlashCommand } from "../../../shared/conversationInput";
import { existsSync, type FSWatcher, watch } from "node:fs";
import { basename, join } from "node:path";
import {
  conversationMessages,
  runningTool,
  latestAssistantMessage,
  type AgentQuest,
  type Conversation,
  type ConversationLatest,
  type ConversationSource,
  type ConversationUnavailableReason,
} from "./conversation";
import {
  createDeliveryLedger,
  DELIVERY_CHECK_MS,
  type DeliveryClock,
  type DeliveryView,
} from "./conversation-delivery";
import {
  parseCommandMenu,
  parsePendingPrompt,
  PROMPT_SCREEN_LINES,
  type PendingPrompt,
} from "./pending-prompt";
import { stepsFromEntries, type ConversationStep } from "./conversation-steps";
import { codexHome, type AgentSessionFileAccess } from "./session-file-access";
import type { SessionProjectionCache } from "./session-projection-cache";
import {
  SESSION_AGENTS,
  codexReportContradicted,
  searchCodexTitle,
  resolveAgentSessionInfo,
  type AgentSessionResolverContext,
} from "./session-resolver";
import type { AgentSessionResolved, HerdrCall } from "./session-types";
import { isRecord, normalizeAgentName, stringValue } from "./session-utils";

import { paneBinding, sessionLabel } from "./conversation-binding";
import {
  prepareCodexInferenceBatch,
  type CodexInferenceBatch,
} from "./codex-daemon-binding";
export { paneBinding, sessionLabel } from "./conversation-binding";

/** Herdr states in which a harness's own command menu can be open. */
const MENU_STATUSES = new Set(["idle", "done"]);
/** An unreadable transcript, or one with a call still open, may be asking. */
const hasOpenTool = (shown: Conversation) =>
  shown.status !== "ok" || shown.running_tool !== null;

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
  /** A Codex transcript was created or removed on this machine. */
  onCodexSessionsChanged?: () => void;
  /** A sent message's check ended without a read; recheck watched panes. */
  onDeliveriesChanged?: () => void;
}): ConversationSource & { dispose(): void } {
  const deliveries = createDeliveryLedger();
  // Sessions this pane has shown, so a sent message can still be checked in
  // its own transcript after the pane moves on, and in the ones it moved to.
  const sessions = new Map<
    string,
    { resolved: AgentSessionResolved; label: string }
  >();
  const remember = (
    fingerprint: string,
    resolved: AgentSessionResolved,
    label: string,
  ) => {
    sessions.delete(fingerprint);
    sessions.set(fingerprint, { resolved, label });
    if (sessions.size > 64) sessions.delete(sessions.keys().next().value!);
  };
  // An SSH host's clock is measured, and measured again after ten minutes.
  // A failed measurement is not remembered.
  let measured: { clock: DeliveryClock; at: number } | null = null;
  const clock = async (): Promise<DeliveryClock | null> => {
    if (!args.files.clockOffset) return { offsetMs: 0, uncertaintyMs: 0 };
    if (!measured || Date.now() - measured.at > 10 * 60_000) {
      try {
        measured = { clock: await args.files.clockOffset(), at: Date.now() };
      } catch {
        return null;
      }
    }
    return measured.clock;
  };
  // Each sent message's check ends at its deadline even if nothing reads
  // the pane: a last read settles what it can, the rest becomes unverified,
  // and watched panes are rechecked so browsers showing them reread.
  const deadlines = new Set<ReturnType<typeof setTimeout>>();
  const scheduleDeadline = (paneId: string) => {
    const timer = setTimeout(async () => {
      deadlines.delete(timer);
      await read({ pane_id: paneId }).catch(() => {});
      deliveries.expire(paneId);
      args.onDeliveriesChanged?.();
    }, DELIVERY_CHECK_MS + 1000);
    (timer as { unref?: () => void }).unref?.();
    deadlines.add(timer);
  };
  // Change detection may reuse a remembered Codex title match only while
  // every Codex session root is watched: any created or removed transcript
  // can change which transcripts a title prefix matches, so it forgets them
  // all. Remote hosts and unwatchable roots always search.
  let codexWatch: { ok: boolean; close(): void } | null = null;
  const watchCodexSessions = () => {
    if (args.files.remote) return false;
    if (codexWatch) return codexWatch.ok;
    const watchers: FSWatcher[] = [];
    let ok = true;
    const forget = () => {
      args.context.codexTitles.clear();
      args.onCodexSessionsChanged?.();
    };
    const home = codexHome();
    const roots = ["sessions", "archived_sessions"];
    for (const name of roots) {
      const root = join(home, name);
      if (!existsSync(root)) continue;
      try {
        const watcher = watch(
          root,
          { recursive: true, persistent: false },
          (type) => {
            if (type === "rename") forget();
          },
        );
        watcher.on("error", () => {
          watcher.close();
          if (codexWatch) codexWatch.ok = false;
          args.context.codexTitles.clear();
        });
        watchers.push(watcher);
      } catch {
        ok = false;
      }
    }
    // A root created later (Codex archives a thread for the first time) is
    // seen through the home directory, and the roots are watched afresh.
    try {
      const watcher = watch(home, { persistent: false }, (_type, name) => {
        if (!roots.includes(String(name))) return;
        codexWatch?.close();
        codexWatch = null;
        forget();
      });
      watcher.on("error", () => {
        watcher.close();
        if (codexWatch) codexWatch.ok = false;
      });
      watchers.push(watcher);
    } catch {
      ok = false;
    }
    codexWatch = {
      ok,
      close: () => watchers.forEach((watcher) => watcher.close()),
    };
    return ok;
  };

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

  const resolve = async (
    paneId: string,
    reuseCodexTitle = false,
    // An agent record already listed (`agent.list`), or null for none.
    listed?: {
      info: Record<string, unknown> | null;
      agents?: readonly Record<string, unknown>[];
      inference?: CodexInferenceBatch;
    },
  ) => {
    const info = listed ? listed.info : await agentInfo(paneId);
    const agent = normalizeAgentName(stringValue(info?.agent));
    const base: Omit<Conversation, "status" | "unavailable"> = {
      conversation_version: 1,
      source: "herdr",
      pane_id: paneId,
      agent: agent || null,
      agent_status: stringValue(info?.agent_status) || null,
      terminal_title: stringValue(info?.terminal_title).trim() || null,
      running_tool: null,
      session_binding: null,
      session_fingerprint: null,
      session_label: null,
      updated_at: null,
      messages: [],
      latest: null,
      quest: null,
      deliveries: deliveries.list(paneId),
      pending_prompt: null,
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
    // A remote pane must never use local-only readers or ID discovery.
    // Claude UUIDs are supported only by an adapter with host-local lookup.
    if (
      args.files.remote &&
      (agent === "grok" ||
        agent === "agy" ||
        (reported &&
          reported.kind !== "path" &&
          agent !== "pi" &&
          agent !== "codex" &&
          !(agent === "claude" && args.files.findClaudeSessionById)))
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
      {
        reuseCodexTitle,
        herdrCall: args.herdrCall,
        listedCodexPanes: listed?.agents,
        codexInferenceBatch: listed?.inference,
      },
    );
    // A session found by searching the pane's directory may belong to
    // another agent in the same folder: show it, but never send to it.
    const inferred = resolved.session?.source === "codex-daemon";
    const bound =
      inferred ||
      resolved.reason === "ambiguous" ||
      resolved.session?.source.endsWith("-local")
        ? null
        : paneBinding(agent, info, args.context);
    return {
      base: {
        ...base,
        session_binding:
          bound?.binding ?? (resolved.session ? ("guessed" as const) : null),
        session_fingerprint: bound?.fingerprint ?? null,
        session_label: resolved.session
          ? bound
            ? sessionLabel(agent, info, args.context)
            : `${agent} session ${resolved.session.kind === "path" ? basename(resolved.session.value) : resolved.session.value}`
          : bound
            ? sessionLabel(agent, info, args.context)
            : null,
      },
      resolved,
    };
  };

  const readShown = async (pane_id: string): Promise<Conversation> => {
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
      if (base.session_fingerprint)
        remember(
          base.session_fingerprint,
          resolved,
          base.session_label ?? "a session Herdr does not identify",
        );
      return {
        ...base,
        status: "ok",
        unavailable: null,
        updated_at: new Date(projection.file.mtimeMs).toISOString(),
        messages,
        latest: latestAssistantMessage(messages),
        quest: projection.quest,
        running_tool: runningTool(projection.entries),
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

  /**
   * Settle this pane's sent messages against the conversation it shows and
   * the transcripts of the sessions they were sent to or seen in since.
   */
  const settle = async (paneId: string, shown: Conversation) => {
    const current = shown.session_fingerprint;
    const views: DeliveryView[] =
      current && shown.status === "ok"
        ? [
            {
              fingerprint: current,
              label: shown.session_label ?? "a session Herdr does not identify",
              messages: shown.messages,
            },
          ]
        : [];
    for (const fingerprint of deliveries.watching(paneId)) {
      if (fingerprint === current) continue;
      const session = sessions.get(fingerprint);
      if (!session) {
        views.push({ fingerprint, label: "", messages: null });
        continue;
      }
      try {
        const projection = await args.cache.get(session.resolved);
        views.push({
          fingerprint,
          label: session.label,
          messages: conversationMessages(projection.entries),
        });
      } catch {
        // A session Chat can no longer read cannot settle the message.
        views.push({ fingerprint, label: session.label, messages: null });
      }
    }
    deliveries.evaluate(paneId, current, views);
  };

  /** The session and Herdr state a prompt is read under. */
  const promptContext = (info: Record<string, unknown> | null) => ({
    session: info
      ? JSON.stringify([
          isRecord(info.agent_session) ? info.agent_session.value : null,
          stringValue(info.terminal_title),
        ])
      : null,
    seq:
      typeof info?.state_change_seq === "number" ? info.state_change_seq : null,
  });

  /** The prompt a blocked agent shows at the bottom of its screen. */
  const readPrompt = async (
    paneId: string,
    info: Record<string, unknown> | null,
  ): Promise<PendingPrompt | null> => {
    const result = await args.herdrCall("pane.read", {
      pane_id: paneId,
      source: "recent",
      lines: PROMPT_SCREEN_LINES,
      format: "text",
      strip_ansi: true,
    });
    const text = screenText(result);
    return text === null
      ? null
      : parsePendingPrompt(
          normalizeAgentName(stringValue(info?.agent)),
          text,
          promptContext(info),
        );
  };

  /**
   * A command menu the harness shows. Herdr reports it idle or done, or
   * blocked when its screen rules take the menu for a form (Claude Code's
   * `/permissions` list). A blocked pane shows a menu only when the prompt
   * parser reads no question there and the transcript has no open tool call:
   * questions, approvals and plans are tool calls; command menus are not.
   */
  const readMenu = async (
    paneId: string,
    info: Record<string, unknown> | null,
    openTool?: boolean,
  ): Promise<PendingPrompt | null> => {
    const status = stringValue(info?.agent_status);
    if (!MENU_STATUSES.has(status) && status !== "blocked") return null;
    const text = screenText(
      await args.herdrCall("pane.read", {
        pane_id: paneId,
        source: "recent",
        lines: PROMPT_SCREEN_LINES,
        format: "text",
        strip_ansi: true,
      }),
    );
    if (text === null) return null;
    const agent = normalizeAgentName(stringValue(info?.agent));
    const context = promptContext(info);
    if (status === "blocked") {
      if (parsePendingPrompt(agent, text, context)?.options.length) return null;
      if (openTool ?? (await readShown(paneId).then(hasOpenTool))) return null;
    }
    return parseCommandMenu(agent, text, context);
  };

  const read = async ({
    pane_id,
    menus = false,
  }: {
    pane_id: string;
    menus?: boolean;
  }): Promise<Conversation> => {
    const shown = await readShown(pane_id);
    await settle(pane_id, shown);
    const status = shown.agent_status ?? "";
    // A blocked agent's question is on its screen, not in its transcript,
    // and so is a command menu, which Chat asks for.
    const pending_prompt =
      (status === "blocked" || (menus && MENU_STATUSES.has(status))) &&
      shown.session_binding !== "guessed" &&
      (shown.agent !== "codex" || Boolean(shown.session_fingerprint))
        ? await agentInfo(pane_id)
            .then(async (info) => {
              const asked =
                stringValue(info?.agent_status) === "blocked"
                  ? await readPrompt(pane_id, info)
                  : null;
              if (asked?.options.length || !menus || !shown.session_fingerprint)
                return asked;
              return (
                (await readMenu(pane_id, info, hasOpenTool(shown))) ?? asked
              );
            })
            .catch(() => null)
        : null;
    return { ...shown, deliveries: deliveries.list(pane_id), pending_prompt };
  };

  const latest = async (target: { pane_id: string; menus?: boolean }) =>
    withoutMessages(await read(target));

  // Steps per projection, so repeated asks while nothing changed do not
  // rebuild them.
  const projectedSteps = new WeakMap<object, Map<string, ConversationStep>>();
  const steps = async ({
    pane_id,
    call_ids,
  }: {
    pane_id: string;
    call_ids: readonly string[];
  }): Promise<ConversationStep[]> => {
    const step = await resolve(pane_id);
    if (!("resolved" in step) || !step.resolved.file) return [];
    const projection = await args.cache.get(step.resolved);
    let byCall = projectedSteps.get(projection);
    if (!byCall) {
      byCall = new Map();
      for (const item of stepsFromEntries(projection.entries))
        if (item.call_id) byCall.set(item.call_id, item);
      projectedSteps.set(projection, byCall);
    }
    return call_ids.flatMap((id) => byCall.get(id) ?? []);
  };

  /** Run `each` for the named panes, or every agent pane, four at a time. */
  const eachPane = async <T>(
    paneIds: readonly string[] | undefined,
    each: (paneId: string) => Promise<T>,
  ) => {
    const ids =
      paneIds ??
      (await (async () => {
        const result = await args.herdrCall("agent.list", {});
        const agents =
          isRecord(result) && Array.isArray(result.agents) ? result.agents : [];
        return agents
          .filter(isRecord)
          .map((agent) => stringValue(agent.pane_id))
          .filter(Boolean);
      })());
    const results: T[] = [];
    // Bound filesystem and SSH work when many agents are open.
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, ids.length) }, async () => {
        while (next < ids.length) {
          const index = next++;
          results[index] = await each(ids[index]!);
        }
      }),
    );
    return results;
  };

  return {
    id: "herdr",
    ...createPromptActions({
      herdrCall: args.herdrCall,
      agentInfo,
      readPrompt,
      readMenu,
      isCodexBound: async (paneId) => {
        const step = await resolve(paneId);
        return "resolved" in step && Boolean(step.base.session_fingerprint);
      },
      sessionFingerprint: async (paneId) => {
        const step = await resolve(paneId);
        return "resolved" in step ? step.base.session_fingerprint : null;
      },
    }),
    dismiss: ({ pane_id, delivery_id }) =>
      deliveries.dismiss(pane_id, delivery_id),
    dispose: () => {
      for (const timer of deadlines) clearTimeout(timer);
      deadlines.clear();
      codexWatch?.close();
      codexWatch = null;
      args.context.codexDiscovery.clear();
    },
    read,
    latest,
    steps,
    identity: async ({ pane_id }) => {
      // Watching runs on every Herdr event; it need not search Codex
      // transcripts again for a title it already resolved, while creations
      // and removals of Codex transcripts are being watched.
      const step = await resolve(pane_id, watchCodexSessions());
      // Every branch carries the receipts' states, so a check that ends
      // with no agent in the pane still reaches the browsers showing it.
      const receipts = deliveries
        .list(pane_id)
        .map((delivery) => [delivery.id, delivery.state]);
      if (!("resolved" in step))
        return {
          key: JSON.stringify([step.agent, step.unavailable.reason, receipts]),
          paths: [],
        };
      const { base, resolved } = step;
      const file = resolved.file;
      // Transcripts on this machine that can still settle a sent message.
      const others = args.files.remote
        ? []
        : [...deliveries.watching(pane_id)]
            .filter((fingerprint) => fingerprint !== base.session_fingerprint)
            .map((fingerprint) => sessions.get(fingerprint)?.resolved.file)
            .filter((other): other is NonNullable<typeof other> => !!other);
      const otherStats = await Promise.all(
        others.map((other) =>
          args.files.statFile(other.path).catch(() => null),
        ),
      );
      return {
        key: JSON.stringify([
          base.agent_status,
          // A change of task in the title is news; its spinner turning is not.
          base.terminal_title?.replace(/^[^\p{L}\p{N}]+/u, "") ?? null,
          base.session_binding,
          base.session_fingerprint,
          resolved.reason ?? null,
          resolved.session?.value ?? null,
          file?.path ?? null,
          file?.mtimeMs ?? null,
          file?.size ?? null,
          file?.changeToken ?? null,
          otherStats.map((stat) => [stat?.mtimeMs, stat?.size]),
          receipts,
        ]),
        paths: [
          ...(file && !args.files.remote ? [file.path] : []),
          ...others.map((other) => other.path),
        ],
      };
    },
    latestAll: async (paneIds) =>
      (
        await eachPane(paneIds, (pane_id) =>
          read({ pane_id }).catch((error) =>
            unavailable(
              {
                conversation_version: 1,
                source: "herdr",
                pane_id,
                agent: null,
                agent_status: null,
                session_binding: null,
                session_fingerprint: null,
                session_label: null,
                terminal_title: null,
                running_tool: null,
                updated_at: null,
                messages: [],
                latest: null,
                quest: null,
                deliveries: [],
                pending_prompt: null,
              },
              "read_failed",
              error instanceof Error ? error.message : String(error),
            ),
          ),
        )
      ).map(withoutMessages),
    // One agent.list for every pane, not an agent.get each: a busy World
    // asks for hundreds of panes, and per-pane calls would queue ahead of
    // terminal input on the same Herdr connection.
    quests: async (paneIds) => {
      const listed = new Map<string, Record<string, unknown>>();
      let listFailed = false;
      try {
        const result = await args.herdrCall("agent.list", {});
        const agents =
          isRecord(result) && Array.isArray(result.agents) ? result.agents : [];
        for (const agent of agents.filter(isRecord)) {
          const id = stringValue(agent.pane_id);
          if (id) listed.set(id, agent);
        }
      } catch (error) {
        if (!paneIds) throw error;
        listFailed = true;
      }
      const listedAgents = [...listed.values()];
      const inference = await prepareCodexInferenceBatch({
        listed: listedAgents,
        files: args.files,
        herdrCall: args.herdrCall,
        discovery: args.context.codexDiscovery,
      });
      return eachPane(
        paneIds ?? [...listed.keys()],
        async (pane_id): Promise<AgentQuest> => {
          const empty = {
            pane_id,
            agent: null,
            session_binding: null,
            session_fingerprint: null,
            quest: null,
          };
          if (listFailed) return { ...empty, read_failed: true };
          let step: Awaited<ReturnType<typeof resolve>>;
          try {
            step = await resolve(pane_id, true, {
              info: listed.get(pane_id) ?? null,
              agents: listedAgents,
              inference,
            });
          } catch {
            return { ...empty, read_failed: true };
          }
          if (!("resolved" in step)) return { ...empty, agent: step.agent };
          const { base, resolved } = step;
          const found = {
            pane_id,
            agent: base.agent,
            session_binding: base.session_binding,
            session_fingerprint: base.session_fingerprint,
          };
          try {
            return {
              ...found,
              quest: resolved.file ? await args.cache.quest(resolved) : null,
            };
          } catch {
            // The session is known: say which, so a browser keeps the last
            // quest only if it came from this session.
            return { ...found, quest: null, read_failed: true };
          }
        },
      );
    },
    send: async ({ pane_id, text, session_fingerprint, baseline }) => {
      if (!text.trim())
        return {
          status: "refused",
          reason: "empty",
          message: "Write a message first.",
        };
      if (args.remotePlatform === "windows")
        return {
          status: "refused",
          reason: "unavailable",
          message: "Chat cannot send on a Windows host yet.",
        };
      // All slash commands use the same qualified admission, with unchecked
      // receipts because changing sessions can be their intended effect.
      const command = isSlashCommand(text);
      if (deliveries.full(pane_id))
        return {
          status: "refused",
          reason: "unsettled",
          message:
            "Chat is still checking earlier messages from this pane. Nothing was sent; dismiss the notices you have read, or use the Terminal tab.",
        };
      const notBound =
        "Herdr has not tied one conversation to this pane, so nothing was sent. Use the Terminal tab.";
      const changed = {
        status: "refused",
        reason: "changed",
        message:
          "The conversation in this pane changed. Nothing was sent; check it and send again.",
      } as const;
      // What Chat showed is the baseline a delivery is checked against. Over
      // SSH the browser's own read is used rather than reading again.
      let shown: Conversation | null = null;
      if (!(args.files.remote && baseline)) {
        shown = await read({ pane_id });
        if (
          shown.session_fingerprint &&
          shown.session_fingerprint !== session_fingerprint
        )
          return changed;
        if (shown.status !== "ok")
          return {
            status: "refused",
            reason: "unavailable",
            message: `${shown.unavailable.detail} Nothing was sent.`,
          };
        if (!shown.session_fingerprint)
          return {
            status: "refused",
            reason: "unavailable",
            message: notBound,
          };
      }
      const shownIds =
        shown?.messages
          .filter((message) => message.role === "user")
          .map((message) => message.id) ?? baseline!;
      // Times in the transcripts are compared on their host's clock.
      const transcriptClock = await clock();
      if (!transcriptClock)
        return {
          status: "refused",
          reason: "unavailable",
          message:
            "Chat could not read the SSH host's clock, so it could not check where the message goes. Nothing was sent; try again, or use the Terminal tab.",
        };
      // Read the pane immediately before prompting, with no other await in
      // between. Herdr's prompt takes no expected session (#4764), so a
      // switch after this reply and before the prompt lands is still
      // possible; the prompt's reply and the transcripts detect it below.
      let info = await agentInfo(pane_id);
      let verified: Map<string, string> | undefined;
      if (normalizeAgentName(stringValue(info?.agent)) === "codex") {
        // A truncated Codex title ID is searched afresh, never taken from a
        // remembered match; then the pane is read again for the prompt.
        verified = await searchCodexTitle(
          stringValue(info?.terminal_title),
          args.files,
          args.context,
        );
        if (
          info &&
          (await codexReportContradicted(pane_id, info, args.herdrCall))
        )
          return changed;
        info = await agentInfo(pane_id);
      }
      const agent = normalizeAgentName(stringValue(info?.agent));
      const bound =
        info && SESSION_AGENTS.has(agent)
          ? paneBinding(agent, info, args.context, verified)
          : null;
      if (!bound?.fingerprint)
        return { status: "refused", reason: "unavailable", message: notBound };
      if (bound.fingerprint !== session_fingerprint) return changed;
      // Claude Code runs “!” as a shell command and “#” as a memory note.
      if (agent === "claude" && /^[!#]/.test(text.trimStart()))
        return {
          status: "refused",
          reason: "command",
          message:
            "Claude Code treats text that starts with “!” or “#” as a command, which Chat cannot check. Nothing was sent; use the Terminal tab.",
        };
      let result: unknown;
      const startedAt = Date.now();
      try {
        result = await args.herdrCall("agent.prompt", {
          target: pane_id,
          text,
        });
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
      const endedAt = Date.now();
      const sent =
        isRecord(result) && isRecord(result.agent) ? result.agent : null;
      if (sent?.pane_id !== pane_id)
        throw new Error(
          "Herdr did not confirm the prompt; check the agent before sending again.",
        );
      // Herdr 0.9 replies with the pane as it was when it queued the text.
      // An identified session other than the one checked is evidence of a
      // switch after Chat's check. A reply without an identified session
      // proves nothing either way; the transcripts decide.
      const sentAgent = normalizeAgentName(stringValue(sent.agent));
      const landed = paneBinding(sentAgent, sent, args.context, verified);
      const delivery = deliveries.record(pane_id, {
        ...(command ? { kind: "command" as const } : {}),
        queued: stringValue(info?.agent_status) === "working",
        text,
        fingerprint: bound.fingerprint,
        expected:
          shown?.session_label ??
          sessionLabel(agent, info!, args.context, verified),
        baseline: shownIds,
        clock: transcriptClock,
        startedAt,
        endedAt,
        ...(landed?.fingerprint && landed.fingerprint !== bound.fingerprint
          ? {
              switchedTo: sessionLabel(sentAgent, sent, args.context, verified),
            }
          : {}),
      });
      scheduleDeadline(pane_id);
      return { status: "sent", delivery };
    },
  };
}

/** The text of a `pane.read` reply, wherever Herdr nests it. */
function screenText(result: unknown): string | null {
  if (!isRecord(result)) return null;
  if (typeof result.text === "string") return result.text;
  for (const value of Object.values(result)) {
    const nested = screenText(value);
    if (nested !== null) return nested;
  }
  return null;
}
