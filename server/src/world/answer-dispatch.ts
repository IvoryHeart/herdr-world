import { ANSWER_DELIVERY_VERB, originalAsker } from "./ask-delivery-types";
import type { LedgerAsk, LedgerStore } from "./world-ledger";
import type { createAskRecipients } from "./ask-recipient";
import {
  attentionRetryDelay,
  type AttentionEntry,
  type AttentionOutbox,
  type StoragePorts,
} from "../storage/world-protocol";

export function answerPrompt(ask: LedgerAsk) {
  const text = `Answer to ${ask.id}:\nQuestion: ${ask.question}\nAnswer from ${ask.answer?.by ?? "owner"}: ${ask.answer?.text ?? ""}`;
  const pointer = text.length > 12_000;
  return {
    pointer,
    text: pointer
      ? `Answer to ${ask.id} is stored in World. Run herdr-world ask get ${ask.id} to read it.`
      : text,
  };
}

/** One stored answer, one opaque effect. Only Chat owns the input submission. */
export function createAnswerDispatcher(deps: {
  ledger(): LedgerStore;
  outbox(): AttentionOutbox;
  recipients: ReturnType<typeof createAskRecipients>;
  clock: StoragePorts["clock"];
  scheduler: StoragePorts["scheduler"];
  changed(): void;
  log(message: string): void;
}) {
  let stopped = false;
  let requested = false;
  let timer: { cancel(): void } | undefined;
  let running: Promise<void> | null = null;
  let planning = Promise.resolve();
  const finish = async (
    entry: AttentionEntry,
    state: AttentionEntry["state"],
    reason: string,
  ) => {
    const updated = await deps
      .outbox()
      .finish(
        entry.id,
        entry.attempt,
        state,
        reason,
        deps.clock.now() + Math.min(60_000, attentionRetryDelay(entry.attempt)),
      );
    if (updated) deps.changed();
  };
  const sameAnswer = (entry: AttentionEntry) => {
    const ask = deps.ledger().ask(entry.record_id);
    return ask &&
      ask.answer?.occurrence === entry.intent?.params.answer_occurrence &&
      !ask.withdrawn
      ? ask
      : null;
  };
  async function dispatch(entry: AttentionEntry) {
    if (
      stopped ||
      entry.state !== "pending" ||
      entry.claimed ||
      entry.due_at > deps.clock.now()
    )
      return;
    const fence = deps.recipients.fence(entry.intent?.condition.recipient);
    const claimed = await deps.outbox().claim(entry.id, fence);
    if (!claimed?.claimed || claimed.state !== "pending") return;
    const intent = claimed.intent;
    if (
      !intent ||
      intent.verb !== ANSWER_DELIVERY_VERB.name ||
      intent.version !== ANSWER_DELIVERY_VERB.version ||
      claimed.recovery !== "opaque"
    )
      return finish(
        claimed,
        "refused",
        "Unsupported answer delivery operation; use ask get",
      );
    const ask = sameAnswer(claimed);
    if (!ask)
      return finish(
        claimed,
        "cancelled",
        "This ask no longer awaits the captured answer",
      );
    let marked = false;
    try {
      const authorization = await deps.recipients.authorize(intent.actor, ask);
      if (authorization !== "allowed")
        return finish(
          claimed,
          authorization === "pending" ? "pending" : "refused",
          authorization === "pending"
            ? "Waiting to recheck the answering actor's current policy"
            : "The answering actor is no longer authorized; use ask get",
        );
      const binding = await deps.recipients.resolve(intent.condition.recipient);
      if (binding.state !== "attached")
        return finish(
          claimed,
          binding.state === "unresolved" ? "pending" : "refused",
          binding.reason,
        );
      if (!fence || stopped)
        return finish(
          claimed,
          "pending",
          "No current claimed lease; delivery remains pending",
        );
      const recipient = intent.condition.recipient!;
      const prompt = answerPrompt(ask);
      let confirmed = false;
      const result =
        await binding.lease.runtime.agentSessions!.conversation.send({
          pane_id: recipient.pane_id,
          text: prompt.text,
          session_fingerprint: recipient.conversation.fingerprint,
          baseline: binding.conversation.messages
            .filter((message) => message.role === "user")
            .map((message) => message.id),
          beforeSubmit: async () => {
            const current = sameAnswer(claimed);
            if (
              stopped ||
              !binding.lease.isCurrent() ||
              !current ||
              (await deps.recipients.authorize(intent.actor, current)) !==
                "allowed"
            )
              return false;
            const started = await deps
              .outbox()
              .beginDispatch(claimed.id, claimed.attempt, fence);
            if (started) deps.changed();
            marked = started?.state === "dispatching";
            return marked;
          },
          guard: (info) => {
            const current = sameAnswer(claimed);
            return (
              !stopped &&
              Boolean(
                current &&
                  (intent.actor.kind === "owner" ||
                    (!current.owner_only &&
                      intent.actor.actor.verified &&
                      !originalAsker(current.recipient, intent.actor.actor))),
              ) &&
              deps.recipients.guard(recipient, binding.lease, info)
            );
          },
          submitted: (fingerprint) => {
            confirmed = fingerprint === recipient.conversation.fingerprint;
          },
        });
      const current = await deps.outbox().get(claimed.id);
      if (
        !current ||
        current.attempt !== claimed.attempt ||
        (current.state !== "dispatching" &&
          !(current.state === "pending" && current.claimed))
      )
        return;
      if (result.status === "sent")
        return finish(
          claimed,
          marked && confirmed ? "delivered" : "uncertain",
          marked && confirmed
            ? prompt.pointer
              ? "Original session queued the answer retrieval pointer"
              : "Original session queued the stored answer"
            : "Pane submission could not be confirmed for the original session; use ask get",
        );
      if (!sameAnswer(claimed))
        return finish(
          claimed,
          "cancelled",
          "The ask was withdrawn before submission; answer remains readable",
        );
      const retry =
        stopped ||
        !binding.lease.isCurrent() ||
        ["blocked", "unsettled", "unavailable"].includes(result.reason);
      return finish(
        claimed,
        retry ? "pending" : "refused",
        retry
          ? "Chat submitted nothing; waiting for admission on the original binding"
          : "Chat refused the original recipient or state; nothing sent, use ask get",
      );
    } catch (error) {
      deps.log(
        `Answer delivery ${marked ? "submission" : "preparation"} failed: ${(error as Error).message}`,
      );
      return finish(
        claimed,
        marked ? "uncertain" : "pending",
        marked
          ? "A pane send may have happened; automatic replay is disabled, use ask get"
          : "No submission began; waiting to check the original recipient again",
      );
    }
  }
  function plan() {
    planning = planning
      .then(async () => {
        timer?.cancel();
        timer = undefined;
        if (stopped) return;
        const next = (
          await deps.outbox().list(ANSWER_DELIVERY_VERB.name, true)
        )[0];
        if (next && !stopped)
          timer = deps.scheduler.schedule(
            () => {
              void wake();
            },
            Math.min(60_000, Math.max(0, next.due_at - deps.clock.now())),
          );
      })
      .catch((error) =>
        deps.log(
          `Answer delivery scheduling failed: ${(error as Error).message}`,
        ),
      );
    return planning;
  }
  function wake(): Promise<void> {
    if (stopped) return Promise.resolve();
    requested = true;
    if (running) return running;
    timer?.cancel();
    timer = undefined;
    running = (async () => {
      while (requested && !stopped) {
        requested = false;
        for (const entry of await deps
          .outbox()
          .list(ANSWER_DELIVERY_VERB.name, true)) {
          if (stopped || entry.due_at > deps.clock.now()) break;
          await dispatch(entry);
        }
      }
    })()
      .catch((error) =>
        deps.log(
          `Answer delivery dispatch failed: ${(error as Error).message}`,
        ),
      )
      .finally(async () => {
        running = null;
        await plan();
      });
    return running;
  }
  return {
    wake,
    async stop() {
      stopped = true;
      timer?.cancel();
      timer = undefined;
      await Promise.allSettled([running, planning]);
    },
  };
}
