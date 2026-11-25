import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { RuntimeOperations } from "../adapters/runtime-ports";
import { CHAT_KEY } from "../../../shared/chatKeys";
import { createAgentSessionHandlers } from "../agent/agent-sessions";
import { normalizeAgentName } from "../agent/chat-harnesses";
import { claudeConfigDirectory } from "../agent/claude-process-session";
import { codexRolloutId } from "../agent/process-transcript";
import { createCodexSessionLinker } from "../agent/codex-session-link";
import type {
  ConversationKeyResult,
  ConversationSendResult,
  ConversationSource,
} from "../agent/conversation";
import type { AgentSessionFileAccess } from "../agent/session-file-access";
import type { HerdrCall } from "../agent/session-types";
import type { ReadyRuntimeLease } from "../connections/manager";
import { deliverCore, type CoreDeliveryInput } from "./delivery";
import { argvSession, processSession } from "./history";
import { coreRecipientChange, foregroundOf } from "./recipient";
import type { CoreConnectionRuntime } from "./runtime";

type Lease = ReadyRuntimeLease<CoreConnectionRuntime>;
type Row = Record<string, unknown>;

/**
 * The program a request's input goes to: the recipient token the person saw
 * (the read model's `core_recipient`), set per browser request. Input
 * without one is refused before anything reaches core.
 */
const requestInput = new AsyncLocalStorage<{ recipient: string }>();

/**
 * Set while Chat presses a key the person chose (`agent_conversation.press`:
 * Stop's Esc, a composer key control, a command menu's key): core takes it
 * at any status. Other keys answer a question and need the program blocked.
 */
const pressing = new AsyncLocalStorage<true>();

/** Runs `operation` with input addressed to the program `recipient` names. */
export function withCoreRecipient<T>(
  recipient: unknown,
  operation: () => Promise<T>,
): Promise<T> {
  return requestInput.run(
    { recipient: typeof recipient === "string" ? recipient : "" },
    operation,
  );
}

/**
 * Said when no conversation is found for a core agent in place of advice
 * about Herdr (install its integration, the command to copy, what Herdr did
 * not report), which does not apply to core.
 */
export const CORE_NO_SESSION =
  "World has not found where this agent saves its conversation yet. It looks in the agent's own session record, its open conversation files and its launch command. You can still send it a message, and the Terminal tab shows it live.";

/** CORE_NO_SESSION for Codex, whose session ID Chat can link for reading. */
export const CORE_CODEX_UNLINKED = `${CORE_NO_SESSION} If you know its Codex session ID, link it to read the conversation here.`;

/** A Herdr-integration "no session" answer, in core's words. */
function inCoreWords<T extends { status: string; unavailable: unknown }>(
  value: T,
): T {
  const unavailable = value.unavailable as {
    reason?: string;
    detail?: string;
    command?: string;
  } | null;
  if (value.status !== "unavailable") return value;
  // An unlinked Codex conversation always gets core's linking advice, not
  // Herdr's (its integration, its startup report, its daemon issue).
  if (
    unavailable?.reason !== "codex_unlinked" &&
    (unavailable?.reason !== "no_session" ||
      !(unavailable.command || unavailable.detail?.includes("Herdr")))
  )
    return value;
  return {
    ...value,
    unavailable:
      unavailable.reason === "codex_unlinked"
        ? { reason: "codex_unlinked", detail: CORE_CODEX_UNLINKED }
        : { reason: "no_session", detail: CORE_NO_SESSION },
  };
}

/** Herdr's key names where core's differ. */
const CORE_KEY: Readonly<Record<string, string>> = { escape: "esc" };

/** JavaScript has no inline flags; Herdr's `(?m)` prefix becomes `m`. */
function screenPattern(value: unknown): RegExp | null {
  if (typeof value !== "string") return null;
  const multiline = value.startsWith("(?m)");
  try {
    return new RegExp(multiline ? value.slice(4) : value, multiline ? "m" : "");
  } catch {
    return null;
  }
}

/** Checks until `check` answers, for at most five seconds. */
async function poll<T>(
  timeoutMs: unknown,
  method: string,
  check: () => Promise<T | null>,
): Promise<T> {
  const deadline = Date.now() + Math.min(Number(timeoutMs) || 0, 5000);
  for (;;) {
    const found = await check();
    if (found !== null) return found;
    if (Date.now() >= deadline) throw new Error(`timeout: ${method}`);
    await new Promise((done) => setTimeout(done, 100));
  }
}

/**
 * Chat, History, Details and answers for agents on herdr-core, through the
 * same handlers a Herdr (TUI) connection uses: one Chat for both runtimes.
 * Only the data source differs. A core-backed call port answers the Herdr
 * methods those handlers read (agent rows from World's read model, the
 * session from the agent's own process record or launch arguments, the
 * screen from core) and turns their input into core's own send and keys,
 * addressed to the program the person saw (`withCoreRecipient`). World
 * never writes a core agent's status and adds no harness side channel.
 */
export function createCoreAgentSessions(args: {
  lease: Lease;
  operations: RuntimeOperations;
  files: AgentSessionFileAccess;
  remotePlatform?: string;
}) {
  const { lease, operations, files } = args;
  const view = lease.runtime.core;
  /** Browsers watching a pane, and how each is told it changed. */
  const senders = new WeakMap<object, (paneId: string) => void>();
  // The process record is a file read on the agent's host; a send reads the
  // agent several times within a moment. Keyed by occupant as well as pid: a
  // replacement that reuses the pid must not see the old program's session.
  const recorded = new Map<string, { at: number; value: unknown }>();
  const sessionOf = async (
    agent: string,
    address: string,
    record: Row | undefined,
  ): Promise<Row | undefined> => {
    const foreground = record?.foreground as
      | { pid?: unknown; name?: unknown; argv?: unknown }
      | undefined;
    let found: Awaited<ReturnType<typeof processSession>>;
    const identity = (current: Row | undefined) =>
      JSON.stringify([
        address,
        view.occupancy(address) ?? 0,
        agent,
        current?.foreground,
      ]);
    const key =
      typeof foreground?.pid === "number" ? identity(record) : undefined;
    const cached = key ? recorded.get(key) : undefined;
    if (cached && Date.now() - cached.at < 1000)
      found = cached.value as typeof found;
    else {
      found = await processSession(agent, foreground, files);
      // A slow host read must not publish the previous foreground's session.
      if (key && key !== identity(view.terminal(address) as Row | undefined))
        return;
      if (key) recorded.set(key, { at: Date.now(), value: found });
      if (recorded.size > 64) recorded.clear();
    }
    if (found) return { ...found, source: "core-process", agent };
    const launched =
      argvSession(agent, foreground?.argv) ?? argvSession(agent, record?.argv);
    return launched ? { ...launched, source: "core-argv", agent } : undefined;
  };

  /**
   * Codex sessions the person linked for reading, by terminal: each holds
   * only while the program it was linked for (its recipient) runs there.
   * A link is a reading choice, never input authority: core's occupant
   * check still decides where input goes.
   */
  const links = new Map<string, { recipient: string; session: Row }>();
  const linked = (address: string): Row | undefined => {
    const link = links.get(address);
    if (!link) return;
    const epoch = view.epoch;
    if (
      epoch &&
      !coreRecipientChange(
        link.recipient,
        epoch.coreId,
        view.terminal(address),
        view.occupancy(address),
      )
    )
      return link.session;
    links.delete(address);
  };

  /** Herdr's `agent.get` record for the agent at `address`, from core. */
  const agentRecord = async (address: string): Promise<Row> => {
    const agents = ((await operations.listAgents()).agents ?? []) as Row[];
    const row = agents.find((item) => item.pane_id === address);
    if (!row) throw new Error(`agent_not_found: ${address}`);
    const pane = ((await operations.getTerminal({ pane_id: address })).pane ??
      {}) as Row;
    const record = view.terminal(address) as Row | undefined;
    const foreground = record?.foreground as { cwd?: unknown } | undefined;
    const agent = normalizeAgentName(String(row.agent ?? ""));
    const session =
      linked(address) ?? (await sessionOf(agent, address, record));
    const turn = pane.turn;
    return {
      ...row,
      workspace_id: pane.workspace_id,
      tab_id: pane.tab_id,
      ...(typeof pane.cwd === "string" ? { cwd: pane.cwd } : {}),
      ...(typeof foreground?.cwd === "string"
        ? { foreground_cwd: foreground.cwd }
        : {}),
      // Changes when another program occupies the terminal or a turn passes.
      state_change_seq: `${view.occupancy(address) ?? 0}:${typeof turn === "number" ? turn : 0}`,
      ...(session ? { agent_session: session } : {}),
    };
  };

  /** Core's own send or keys to the program the request addresses. */
  const deliver = async (address: string, input: CoreDeliveryInput) => {
    const recipient = requestInput.getStore()?.recipient ?? "";
    if (!recipient)
      throw new Error(
        "agent_not_ready: Reopen this agent's Chat; nothing was sent.",
      );
    const outcome = await deliverCore(lease, address, recipient, input);
    if (outcome.status === "sent") return { agent: await agentRecord(address) };
    if (outcome.status === "uncertain") throw new Error(outcome.message);
    // Nothing reached the program.
    throw new Error(
      `${outcome.reason === "waiting" ? "agent_blocked" : "agent_not_ready"}: ${outcome.message}`,
    );
  };

  const statusOf = async (address: string) =>
    String((await agentRecord(address)).agent_status ?? "");

  const call: HerdrCall = async (method, params = {}) => {
    const pane = String(params.pane_id ?? params.target ?? "");
    switch (method) {
      case "agent.get":
        return { agent: await agentRecord(pane) };
      case "agent.list": {
        const rows = ((await operations.listAgents()).agents ?? []) as Row[];
        const agents: Row[] = [];
        for (const row of rows)
          agents.push(
            await agentRecord(String(row.pane_id)).catch(() => row as Row),
          );
        return { agents };
      }
      case "pane.get": {
        const { pane: row } = await operations.getTerminal({ pane_id: pane });
        const agent = await agentRecord(pane).catch(() => null);
        return {
          pane: {
            ...row,
            ...(agent?.agent_session
              ? { agent_session: agent.agent_session }
              : {}),
          },
        };
      }
      case "pane.read":
        return operations.readTerminal({ pane_id: pane });
      // Core reports no process tree: no trust question is read from it.
      case "pane.process_info":
        return { process_info: { foreground_processes: [] } };
      case "agent.wait": {
        const until = new Set(
          Array.isArray(params.until) ? params.until.map(String) : [],
        );
        return poll(params.timeout_ms, method, async () =>
          until.has(await statusOf(pane))
            ? { agent: await agentRecord(pane) }
            : null,
        );
      }
      case "pane.wait_for_output": {
        const match = params.match as { value?: unknown } | undefined;
        const pattern = screenPattern(match?.value);
        if (!pattern) throw new Error("pane.wait_for_output needs a pattern");
        return poll(params.timeout_ms, method, async () => {
          const { read } = await operations.readTerminal({ pane_id: pane });
          return pattern.test(String((read as Row | undefined)?.text ?? ""))
            ? { read }
            : null;
        });
      }
      case "agent.prompt":
        return deliver(pane, {
          kind: "message",
          text: String(params.text ?? ""),
        });
      case "pane.send_input": {
        const text = typeof params.text === "string" ? params.text : "";
        const keys = Array.isArray(params.keys) ? params.keys.map(String) : [];
        if (!text && keys.length > 0)
          return deliver(pane, {
            kind: pressing.getStore() ? "control" : "keys",
            keys: keys.map((key) => CORE_KEY[key] ?? key),
          });
        if (text && keys.length === 1 && keys[0] === "enter")
          return deliver(pane, { kind: "answer", text });
        throw new Error(
          "agent_not_ready: herdr-core takes typed text only as a message or an answer; nothing was sent.",
        );
      }
      default:
        throw new Error(`${method} is not available for herdr-core agents`);
    }
  };

  /**
   * The shared Codex linker (codex-session-link.ts) over core: the
   * foreground core reports stands in for Herdr's process list, and the
   * link is kept here for the program the person saw, not reported to core
   * (core has no session report).
   */
  const linker = createCodexSessionLinker(async (method, params = {}) => {
    const pane = String(params.pane_id ?? params.target ?? "");
    if (method === "pane.process_info") {
      const record = view.terminal(pane);
      const foreground = record ? foregroundOf(record) : null;
      return {
        process_info: {
          foreground_process_group_id: foreground?.[0] ?? null,
          foreground_processes: foreground
            ? [{ pid: foreground[0], name: foreground[1] }]
            : [],
        },
      };
    }
    if (method === "pane.report_agent_session") {
      const recipient = requestInput.getStore()?.recipient ?? "";
      const epoch = view.epoch;
      if (
        !recipient ||
        !epoch ||
        coreRecipientChange(
          recipient,
          epoch.coreId,
          view.terminal(pane),
          view.occupancy(pane),
        )
      )
        throw new Error(
          "This agent changed since you opened its Chat. Reopen it and link again.",
        );
      links.set(pane, {
        recipient,
        session: {
          kind: "id",
          value: String(params.agent_session_id ?? ""),
          source: "world-link",
          agent: "codex",
        },
      });
      return {};
    }
    return call(method, params);
  }, files);

  const handlers = createAgentSessionHandlers({
    herdrCall: call,
    files,
    remotePlatform: args.remotePlatform,
    // The process record names a session under the configured directory
    // (history.ts reads the same); an SSH host resolves its own.
    claudeConfigDir: files.remote ? undefined : claudeConfigDirectory(),
    runtimeScope: {
      connectionId: lease.runtime.identity.id,
      generation: lease.generation,
    },
    onConversationChanged: (paneId, owners) => {
      for (const owner of owners) senders.get(owner)?.(paneId);
    },
  });
  // Core's events (status, title, turn, occupant) recheck watched panes.
  const unwatchCore = lease.runtime.watch(() =>
    handlers.conversationWatch.herdrEvent(),
  );

  const source = handlers.conversation;
  /**
   * A message for a program whose conversation Chat cannot read (a harness
   * without a transcript reader, or none saved yet): core's send to the
   * occupant alone, for every harness. Nothing checks where it lands but
   * core's occupant fence, so it is never shown as matched.
   */
  const sendUnread = async (
    pane_id: string,
    text: string,
  ): Promise<ConversationSendResult> => {
    if (!text.trim())
      return {
        status: "refused",
        reason: "empty",
        message: "Write a message first.",
      };
    const recipient = requestInput.getStore()?.recipient ?? "";
    const outcome = await deliverCore(lease, pane_id, recipient, {
      kind: "message",
      text,
    });
    if (outcome.status === "refused")
      return {
        status: "refused",
        reason: outcome.reason === "waiting" ? "blocked" : "changed",
        message: outcome.message,
      };
    const at = new Date().toISOString();
    return {
      status: "sent",
      delivery: {
        id: randomUUID(),
        text,
        sent_at: at,
        transcript_at: at,
        state: outcome.status === "sent" ? "unverified" : "uncertain",
        expected: "",
        fingerprint: "",
        detail:
          outcome.status === "sent"
            ? "herdr-core typed it into the agent; Chat cannot read this conversation to check it."
            : outcome.message,
      },
    };
  };
  /**
   * A key for a program whose conversation Chat cannot read (Stop's Esc or
   * a composer key control): core's keys to the occupant alone, as
   * `sendUnread` does for a message.
   */
  const pressUnread = async (
    pane_id: string,
    key: string,
  ): Promise<ConversationKeyResult> => {
    const refuse = (
      message: string,
      reason: "changed" | "unknown_option" = "changed",
    ): ConversationKeyResult => ({
      status: "refused",
      reason,
      message,
      menu: null,
    });
    if (!CHAT_KEY.test(key))
      return refuse(
        "Chat cannot press that key. Nothing was sent.",
        "unknown_option",
      );
    const recipient = requestInput.getStore()?.recipient ?? "";
    const outcome = await deliverCore(lease, pane_id, recipient, {
      kind: "control",
      keys: [CORE_KEY[key] ?? key],
    });
    if (outcome.status === "refused") return refuse(outcome.message);
    if (outcome.status === "uncertain") throw new Error(outcome.message);
    return { status: "sent", key, menu: null };
  };
  const conversation: ConversationSource = {
    ...source,
    read: async (target) => inCoreWords(await source.read(target)),
    latest: async (target) => inCoreWords(await source.latest(target)),
    latestAll: async (paneIds) =>
      (await source.latestAll(paneIds)).map(inCoreWords),
    // Core has no trust question Chat can answer: the Terminal tab can.
    trust: undefined,
    press: async (target) => {
      if (!requestInput.getStore()?.recipient)
        return {
          status: "refused",
          reason: "changed",
          message: "Reopen this agent's Chat; nothing was sent.",
          menu: null,
        };
      if (
        !target.session_fingerprint &&
        target.menu_fingerprint === undefined &&
        target.text === undefined
      )
        return pressUnread(target.pane_id, target.key);
      try {
        return await pressing.run(true, () => source.press(target));
      } catch (error) {
        // Core refused before pressing anything (deliver, above).
        const refusal = /^agent_(?:not_ready|blocked): (.*)$/s.exec(
          (error as Error)?.message ?? "",
        );
        if (!refusal) throw error;
        return {
          status: "refused",
          reason: "changed",
          message: refusal[1]!,
          menu: null,
        };
      }
    },
    send: async (target) => {
      if (!requestInput.getStore()?.recipient)
        return {
          status: "refused",
          reason: "changed",
          message: "Reopen this agent's Chat; nothing was sent.",
        };
      if (!target.session_fingerprint)
        return sendUnread(target.pane_id, target.text);
      try {
        return await source.send(target);
      } catch (error) {
        // Core refused before typing anything (deliver, above).
        const refusal = /^agent_not_ready: (.*)$/s.exec(
          (error as Error)?.message ?? "",
        );
        if (!refusal) throw error;
        return { status: "refused", reason: "changed", message: refusal[1]! };
      }
    },
  };

  /** The last session read per terminal for Apartments, by program. */
  const known = new Map<
    string,
    { holder: string; at: number; id: string | null }
  >();
  /**
   * The session Chat would read for the program at `address` now (a linked
   * Codex session, the process record, the launch arguments), and which
   * program that is (its occupant and process): Apartments keeps it while
   * the agent lives, because a finished agent's terminal has no record.
   * Called on every observation, so a process-record read (a file read on
   * the agent's host) is repeated for the same program at most every
   * five seconds; another program reads again at once.
   */
  const knownSession = async (
    address: string,
    agent: string,
  ): Promise<{ id: string | null; holder: string } | null> => {
    const record = view.terminal(address) as Row | undefined;
    if (!record) return null;
    const pid = (record.foreground as { pid?: unknown } | undefined)?.pid;
    const holder = JSON.stringify([
      view.occupancy(address) ?? 0,
      typeof pid === "number" ? pid : null,
    ]);
    // Codex's process record names its open rollout file, not an ID: the
    // ID is in the file name (a move resumes it with `codex resume <id>`).
    const idOf = (session: Row | undefined) =>
      typeof session?.value !== "string"
        ? null
        : session.kind === "id"
          ? session.value
          : session.kind === "path" && normalizeAgentName(agent) === "codex"
            ? codexRolloutId(session.value)
            : null;
    const link = idOf(linked(address));
    if (link) return { id: link, holder };
    const cached = known.get(address);
    if (cached?.holder === holder && Date.now() - cached.at < 5000)
      return { id: cached.id, holder };
    const id = idOf(
      await sessionOf(normalizeAgentName(agent), address, record),
    );
    if (known.size >= 256) known.clear();
    known.set(address, { holder, at: Date.now(), id });
    return { id, holder };
  };

  return {
    ...handlers,
    knownSession,
    previewLink: linker.preview,
    link: linker.link,
    conversation,
    /** Tells `owner` (a browser) about changes to `paneId` through `send`. */
    watch(owner: object, paneId: string, send: (paneId: string) => void) {
      senders.set(owner, send);
      handlers.conversationWatch.watch(owner, paneId);
    },
    unwatch(owner: object, paneId?: string) {
      handlers.conversationWatch.unwatch(owner, paneId);
    },
    stop() {
      unwatchCore();
      handlers.conversationWatch.stop();
    },
  };
}

export type CoreAgentSessions = ReturnType<typeof createCoreAgentSessions>;
