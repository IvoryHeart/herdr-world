import type { Conversation, ConversationSource } from "../agent/conversation";
import { askSessionFingerprint, paneActor } from "./world-cli-actor";
import type { CliActor, LedgerAsk } from "./world-ledger";
import {
  originalAsker,
  validRecipient,
  type AnswerActor,
  type AnswerRecipient,
} from "./ask-delivery-types";
import type { StoragePorts } from "../storage/world-protocol";

export type AnswerLease = {
  connectionId: string;
  generation: number;
  isCurrent(): boolean;
  runtime: {
    sshHost(): unknown;
    remotePlatform?: string;
    herdr: {
      call(
        method: string,
        params: Record<string, unknown>,
        timeoutMs: number,
      ): Promise<unknown>;
    };
    agentSessions?: { conversation: ConversationSource };
  };
};
export type AnswerConnections = {
  list(): { id: string }[];
  readyRuntimeLease(id: string): AnswerLease | null | undefined;
};
export type RecipientResolution =
  | { state: "attached"; lease: AnswerLease; conversation: Conversation }
  | { state: "unresolved" | "ended" | "unconfirmed"; reason: string };
const chatScheme = (value: Conversation) =>
  value.session_binding === "reported"
    ? "reported-v1"
    : value.session_binding === "title" && value.agent === "codex"
      ? "codex-title-v1"
      : null;
const host = (lease: AnswerLease) => ({
  connection_id: lease.connectionId,
  generation: lease.generation,
  local: !lease.runtime.sshHost(),
  call: (method: string, params: Record<string, unknown>) =>
    lease.runtime.herdr.call(method, params, 5000),
});

/** Resolve only captured source evidence, never a replacement pane or connection. */
export function createAskRecipients(deps: {
  connections(): AnswerConnections;
  clock: StoragePorts["clock"];
  incarnation: string;
}) {
  const exists = (id: string) =>
    deps
      .connections()
      .list()
      .some((entry) => entry.id === id);
  async function capture(
    actor: CliActor,
  ): Promise<AnswerRecipient | undefined> {
    if (
      !actor.verified ||
      !actor.connection_id ||
      !actor.pane_id ||
      !actor.terminal_id ||
      !actor.agent_session_fingerprint
    )
      return;
    const lease = deps.connections().readyRuntimeLease(actor.connection_id);
    const source = lease?.runtime.agentSessions?.conversation;
    if (
      !lease?.isCurrent() ||
      lease.generation !== actor.connection_generation ||
      !source
    )
      return;
    let conversation: Conversation;
    try {
      conversation = await source.read({ pane_id: actor.pane_id });
    } catch {
      return;
    }
    const scheme = chatScheme(conversation);
    if (!scheme || !conversation.session_fingerprint) return;
    const native = await paneActor(host(lease), actor.pane_id);
    const recipient: AnswerRecipient = {
      adapter: "herdr",
      connection_id: actor.connection_id,
      pane_id: actor.pane_id,
      terminal_id: actor.terminal_id,
      reported: {
        scheme: "herdr-reported-v1",
        fingerprint: actor.agent_session_fingerprint,
      },
      conversation: { scheme, fingerprint: conversation.session_fingerprint },
      captured_at: deps.clock.now(),
      service_incarnation: deps.incarnation,
      connection_generation: lease.generation,
    };
    if (
      lease.isCurrent() &&
      native.state === "present" &&
      originalAsker(recipient, native.actor) &&
      validRecipient(recipient)
    )
      return recipient;
  }
  async function resolve(
    recipient: AnswerRecipient | null | undefined,
  ): Promise<RecipientResolution> {
    if (!validRecipient(recipient))
      return {
        state: "unconfirmed",
        reason: "No verified original recipient binding; use ask get",
      };
    if (!exists(recipient.connection_id))
      return {
        state: "ended",
        reason: "The original connection was removed; use ask get",
      };
    const lease = deps.connections().readyRuntimeLease(recipient.connection_id);
    if (!lease?.isCurrent())
      return {
        state: "unresolved",
        reason: "The original host is offline; delivery waits for its binding",
      };
    const native = await paneActor(host(lease), recipient.pane_id);
    if (!lease.isCurrent() || native.state === "unknown")
      return {
        state: "unresolved",
        reason:
          "The original host could not be observed; delivery remains pending",
      };
    if (native.state === "absent")
      return { state: "ended", reason: "The original pane ended; use ask get" };
    if (!originalAsker(recipient, native.actor))
      return {
        state: "unconfirmed",
        reason: "The asking session changed; answer not sent, use ask get",
      };
    const source = lease.runtime.agentSessions?.conversation;
    if (!source || lease.runtime.remotePlatform === "windows")
      return {
        state: "unconfirmed",
        reason:
          "Guarded Chat delivery is unavailable for this original recipient; use ask get",
      };
    let conversation: Conversation;
    try {
      conversation = await source.read({ pane_id: recipient.pane_id });
    } catch {
      return {
        state: "unresolved",
        reason: "The original conversation cannot yet be checked",
      };
    }
    if (!lease.isCurrent())
      return {
        state: "unresolved",
        reason: "The original runtime retired while checking delivery",
      };
    if (
      conversation.status !== "ok" &&
      [
        "read_failed",
        "file_missing",
        "remote_lookup",
        "no_messages_yet",
      ].includes(conversation.unavailable.reason)
    )
      return {
        state: "unresolved",
        reason: "The original conversation is not readable yet",
      };
    if (
      chatScheme(conversation) !== recipient.conversation.scheme ||
      conversation.session_fingerprint !== recipient.conversation.fingerprint
    )
      return {
        state: "unconfirmed",
        reason:
          "The conversation binding changed or is unverified; use ask get",
      };
    const after = await paneActor(host(lease), recipient.pane_id);
    if (!lease.isCurrent() || after.state === "unknown")
      return {
        state: "unresolved",
        reason: "The original host became unavailable during checks",
      };
    if (after.state !== "present" || !originalAsker(recipient, after.actor))
      return {
        state: "unconfirmed",
        reason: "The asking session changed during checks; use ask get",
      };
    return { state: "attached", lease, conversation };
  }
  async function authorize(
    actor: AnswerActor,
    ask: LedgerAsk,
  ): Promise<"allowed" | "pending" | "refused"> {
    if (actor.kind === "owner") return "allowed";
    const by = actor.actor;
    if (
      ask.owner_only ||
      !by.verified ||
      !by.connection_id ||
      !by.pane_id ||
      !by.terminal_id ||
      !by.agent_session_fingerprint ||
      originalAsker(ask.recipient, by)
    )
      return "refused";
    if (!exists(by.connection_id)) return "refused";
    const lease = deps.connections().readyRuntimeLease(by.connection_id);
    if (!lease?.isCurrent()) return "pending";
    const native = await paneActor(host(lease), by.pane_id);
    if (!lease.isCurrent() || native.state === "unknown") return "pending";
    return native.state === "present" &&
      native.actor.terminal_id === by.terminal_id &&
      native.actor.agent_session_fingerprint === by.agent_session_fingerprint
      ? "allowed"
      : "refused";
  }
  return {
    capture,
    resolve,
    authorize,
    fence(recipient: AnswerRecipient | null | undefined) {
      if (!validRecipient(recipient)) return;
      const lease = deps
        .connections()
        .readyRuntimeLease(recipient.connection_id);
      if (lease?.isCurrent())
        return {
          connection_id: lease.connectionId,
          generation: lease.generation,
          service_incarnation: deps.incarnation,
        };
    },
    guard(
      recipient: AnswerRecipient,
      lease: AnswerLease,
      info: Record<string, unknown>,
    ) {
      return (
        lease.isCurrent() &&
        info.pane_id === recipient.pane_id &&
        info.terminal_id === recipient.terminal_id &&
        askSessionFingerprint(info.agent_session) ===
          recipient.reported.fingerprint
      );
    },
  };
}
