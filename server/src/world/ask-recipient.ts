import {
  coreAskBinding,
  type CoreAnswerConnections,
} from "../herdr-core/ask-recipient";
import { coreRecipientChange } from "../herdr-core/recipient";
import type { ReadyRuntimeLease } from "../connections/manager";
import type { CoreConnectionRuntime } from "../herdr-core/runtime";
import type { Conversation, ConversationSource } from "../agent/conversation";
import {
  askSessionFingerprint,
  paneActor,
  type CoreCallerSource,
  type CoreCliHost,
  type CorePreparedDelivery,
} from "./world-cli-actor";
import type { CliActor, LedgerAsk } from "./world-ledger";
import {
  originalAsker,
  validRecipient,
  type AnswerActor,
  type AnswerRecipient,
  type CoreAnswerRecipient,
} from "./ask-delivery-types";
import type { StoragePorts } from "../storage/world-protocol";

export type AnswerLease = {
  connectionId: string;
  generation: number;
  isCurrent(): boolean;
  runtime: {
    sshHost(): unknown;
    remotePlatform?: string;
    tui: {
      call(
        method: string,
        params: Record<string, unknown>,
        timeoutMs: number,
        beforeSend?: () => void,
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
  | {
      state: "attached";
      kind?: "core-token";
      core: true;
      lease: ReadyRuntimeLease<CoreConnectionRuntime>;
    }
  | {
      state: "attached";
      kind?: "herdr";
      core?: false;
      lease: AnswerLease;
      conversation: Conversation;
    }
  | {
      state: "attached";
      kind: "core";
      core?: false;
      lease: CorePreparedDelivery;
    }
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
    lease.runtime.tui.call(method, params, 5000),
});

/** Resolve only captured source evidence, never a replacement pane or connection. */
export function createAskRecipients(deps: {
  connections(): AnswerConnections;
  core?(): CoreAnswerConnections | CoreCallerSource | null;
  clock: StoragePorts["clock"];
  incarnation: string;
}) {
  const coreSource = () => {
    const value = deps.core?.();
    return value && "hosts" in value ? value : null;
  };
  const coreConnections = () => {
    const value = deps.core?.();
    return value && "list" in value ? value : null;
  };
  const isCore = (id: string) =>
    !deps
      .connections()
      .list()
      .some((entry) => entry.id === id) && Boolean(coreSource()?.has(id));
  const exists = (id: string) =>
    deps
      .connections()
      .list()
      .some((entry) => entry.id === id) || Boolean(coreSource()?.has(id));
  const coreHost = (id: string): CoreCliHost | null =>
    coreSource()
      ?.hosts()
      .find((host) => host.connection_id === id && host.isCurrent()) ?? null;
  /** The program at a core address now, as the verified caller fields. */
  function coreOccupant(host: CoreCliHost, address: string) {
    const occupant = host.occupant(address);
    return occupant && host.isCurrent() ? occupant : null;
  }
  function captureCore(actor: CliActor): CoreAnswerRecipient | undefined {
    const host = coreHost(actor.connection_id!);
    if (!host || host.generation !== actor.connection_generation) return;
    const occupant = coreOccupant(host, actor.pane_id!);
    if (
      !occupant ||
      !occupant.foreground ||
      actor.terminal_id !== actor.pane_id ||
      occupant.fingerprint !== actor.agent_session_fingerprint
    )
      return;
    const recipient: CoreAnswerRecipient = {
      adapter: "herdr-core",
      connection_id: host.connection_id,
      pane_id: actor.pane_id!,
      terminal_id: actor.pane_id!,
      core_id: occupant.coreId,
      pid: occupant.pid,
      foreground: occupant.foreground!,
      reported: {
        scheme: "herdr-core-occupant-v1",
        fingerprint: occupant.fingerprint,
      },
      captured_at: deps.clock.now(),
      service_incarnation: deps.incarnation,
      connection_generation: host.generation,
    };
    return validRecipient(recipient) && originalAsker(recipient, actor)
      ? recipient
      : undefined;
  }
  /**
   * A core asker's current binding and its fenced native-send capability.
   */
  function resolveCore(recipient: CoreAnswerRecipient): RecipientResolution {
    if (!coreSource()?.has(recipient.connection_id))
      return {
        state: "ended",
        reason: "The original connection was removed; use ask get",
      };
    const host = coreHost(recipient.connection_id);
    if (!host)
      return {
        state: "unresolved",
        reason: "The original host is offline; delivery waits for its binding",
      };
    if (host.coreId() !== recipient.core_id)
      return {
        state: "ended",
        reason: "The original herdr-core was replaced; use ask get",
      };
    if (host.generation !== recipient.connection_generation)
      return {
        state: "unconfirmed",
        reason: "The original core connection retired; use ask get",
      };
    const occupant = coreOccupant(host, recipient.pane_id);
    if (!occupant)
      return {
        state: "ended",
        reason: "The original terminal ended; use ask get",
      };
    if (occupant.fingerprint !== recipient.reported.fingerprint)
      return {
        state: "unconfirmed",
        reason: "The asking program changed; answer not sent, use ask get",
      };
    const delivery = host.delivery?.(
      recipient.pane_id,
      recipient.reported.fingerprint,
      recipient.foreground,
    );
    return delivery
      ? { state: "attached", kind: "core", lease: delivery }
      : {
          state: "unconfirmed",
          reason:
            "The asking foreground changed or native delivery is unavailable; use ask get",
        };
  }
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
    if (isCore(actor.connection_id)) return captureCore(actor);
    const core = coreConnections();
    if (core?.list().some((entry) => entry.id === actor.connection_id))
      return coreAskBinding(core, actor, deps.incarnation, deps.clock.now());
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
    if (recipient.service_incarnation !== deps.incarnation)
      return {
        state: "unconfirmed",
        reason:
          "The original runtime cannot be established after a World restart; use ask get",
      };
    if (
      !exists(recipient.connection_id) &&
      !coreConnections()
        ?.list()
        .some((entry) => entry.id === recipient.connection_id)
    )
      return {
        state: "ended",
        reason: "The original connection was removed; use ask get",
      };
    if ("core_id" in recipient) return resolveCore(recipient);
    if (recipient.adapter === "herdr-core") {
      const core = coreConnections();
      const lease = core?.readyRuntimeLease(recipient.connection_id);
      if (!lease?.isCurrent())
        return {
          state: "unresolved",
          reason: "The original core host is offline",
        };
      if (lease.generation !== recipient.connection_generation)
        return {
          state: "unconfirmed",
          reason: "The core runtime changed; answer not sent, use ask get",
        };
      const view = lease.runtime.core;
      if (!view.actionable || !view.epoch)
        return {
          state: "unresolved",
          reason: "Core observation is not current",
        };
      const change = coreRecipientChange(
        recipient.conversation.fingerprint,
        view.epoch.coreId,
        view.terminal(recipient.pane_id),
        view.occupancy(recipient.pane_id),
      );
      return change
        ? {
            state: "unconfirmed",
            reason: "The asking program changed; nothing sent, use ask get",
          }
        : { state: "attached", core: true, lease };
    }
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
    const core = coreConnections();
    if (core?.list().some((entry) => entry.id === by.connection_id)) {
      const lease = core.readyRuntimeLease(by.connection_id);
      if (!lease?.isCurrent()) return "pending";
      const view = lease.runtime.core;
      return view.epoch &&
        coreAskBinding(core, by, deps.incarnation, deps.clock.now())
        ? "allowed"
        : "refused";
    }
    if (!exists(by.connection_id)) return "refused";
    if (isCore(by.connection_id)) {
      const host = coreSource()
        ?.hosts()
        .find((entry) => entry.connection_id === by.connection_id);
      if (!host?.isCurrent()) return "pending";
      const occupant = coreOccupant(host, by.pane_id);
      return occupant &&
        by.terminal_id === by.pane_id &&
        occupant.fingerprint === by.agent_session_fingerprint
        ? "allowed"
        : "refused";
    }

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
      if (
        !validRecipient(recipient) ||
        recipient.service_incarnation !== deps.incarnation
      )
        return;
      if ("core_id" in recipient) {
        const host = coreHost(recipient.connection_id);
        return host
          ? {
              connection_id: host.connection_id,
              generation: host.generation,
              service_incarnation: deps.incarnation,
            }
          : undefined;
      }
      const lease =
        recipient.adapter === "herdr-core"
          ? coreConnections()?.readyRuntimeLease(recipient.connection_id)
          : deps.connections().readyRuntimeLease(recipient.connection_id);
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
        recipient.service_incarnation === deps.incarnation &&
        lease.isCurrent() &&
        info.pane_id === recipient.pane_id &&
        info.terminal_id === recipient.terminal_id &&
        askSessionFingerprint(info.agent_session) ===
          recipient.reported.fingerprint
      );
    },
  };
}
