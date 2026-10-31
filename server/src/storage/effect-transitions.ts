import type { Database } from "bun:sqlite";
import { recordAnswerAttempt } from "./answer-attempts";
import type {
  AttentionEntry,
  AttentionState,
  DispatchFence,
} from "./world-protocol";
import { attentionFinished } from "./world-protocol";
import {
  validateEffectContract,
  sameTarget,
  type EffectVerbLookup,
} from "../effects/contracts";
import type {
  AttemptFence,
  EffectContract,
  EffectEntry,
  EffectReply,
  EffectTransition,
  QualifiedEffectTarget,
} from "../effects/types";

/** The generic effect state is a projection of the same outbox, never another queue. */
export function effectTransitions(
  db: Database,
  incarnation: string,
  attention: (id: string) => AttentionEntry | null,
  verbs: EffectVerbLookup,
) {
  const raw = (id: string) =>
    db.query("SELECT * FROM outbox WHERE id=?").get(id) as Record<
      string,
      unknown
    > | null;
  const get = (id: string): EffectEntry | null => {
    const row = raw(id),
      legacy = attention(id);
    if (!row || !legacy) return null;
    const decisions = db
      .query(
        "SELECT action,actor,reason,created_at,previous_version,operation_version FROM effect_decisions WHERE intent_id=? ORDER BY seq",
      )
      .all(id) as {
      action: string;
      actor: string;
      reason: string;
      created_at: number;
      previous_version: number | null;
      operation_version: number | null;
    }[];
    return {
      ...legacy,
      state: row.needs_migration ? "needs-migration" : legacy.state,
      contract: row.contract
        ? (JSON.parse(row.contract as string) as EffectContract)
        : null,
      receipt: row.receipt
        ? JSON.parse(row.receipt as string)
        : legacy.cli_received_at !== null
          ? { source: "asker-cli", received_at: legacy.cli_received_at }
          : null,
      external_handle: row.external_handle
        ? JSON.parse(row.external_handle as string)
        : null,
      targets: row.dispatch_targets
        ? JSON.parse(row.dispatch_targets as string)
        : [],
      ever_dispatched: Boolean(row.ever_dispatched),
      cancel_requested: Boolean(row.cancel_requested),
      not_sent:
        !row.ever_dispatched && ["refused", "cancelled"].includes(legacy.state),
      owner_retry_attempt: row.owner_retry_attempt as number | null,
      attempt_fence: row.attempt_fence
        ? (JSON.parse(row.attempt_fence as string) as AttemptFence)
        : null,
      decisions: decisions.map((decision) => ({
        action: decision.action,
        actor: JSON.parse(decision.actor),
        reason: decision.reason,
        at: decision.created_at,
        from: decision.previous_version,
        to: decision.operation_version,
      })),
    };
  };
  const reply = (id: string): EffectReply => ({
    effect: get(id),
    attention: attention(id),
  });
  const valid = (entry: EffectEntry, fence: AttemptFence) =>
    entry.attempt === fence.attempt &&
    fence.service_incarnation === incarnation &&
    entry.attempt_fence?.service_incarnation === incarnation;
  const audit = (
    entry: EffectEntry,
    state: AttentionState | "claimed",
    at: number,
    reason: string,
  ) =>
    recordAnswerAttempt(
      db,
      entry.id,
      entry.attempt,
      state,
      entry.evidence?.fence,
      at,
      reason,
      entry.attempt_fence ?? undefined,
    );
  const update = (
    entry: EffectEntry,
    state: AttentionState,
    at: number,
    reason: string,
    due = at,
  ) => {
    db.query(
      "UPDATE outbox SET state=?,claimed=0,resolved_at=?,due_at=?,evidence=?,needs_migration=CASE WHEN ? THEN 0 ELSE needs_migration END WHERE id=?",
    ).run(
      state,
      attentionFinished(state) ? at : null,
      due,
      JSON.stringify({
        ...entry.evidence,
        reason,
        not_sent:
          !entry.ever_dispatched && ["refused", "cancelled"].includes(state),
      }),
      attentionFinished(state) ? 1 : 0,
      entry.id,
    );
    if (entry.attempt > 0) audit(entry, state, at, reason);
  };
  const decision = (
    entry: EffectEntry,
    change: Extract<
      EffectTransition,
      { action: "cancel" | "migrate" | "decide" }
    >,
    at: number,
    to: number | null = null,
  ) => {
    if (change.actor.kind !== "browser" || !change.reason.trim())
      throw new Error(
        "effect decisions require an authorized owner and a reason",
      );
    db.query(
      "INSERT INTO effect_decisions(intent_id,action,actor,reason,created_at,previous_version,operation_version) VALUES(?,?,?,?,?,?,?)",
    ).run(
      entry.id,
      change.action === "decide" && change.outcome === "close"
        ? "close"
        : change.action,
      JSON.stringify(change.actor),
      change.reason,
      at,
      entry.contract?.version ?? null,
      to,
    );
  };
  const targetsMatch = (
    contract: EffectContract,
    targets: readonly QualifiedEffectTarget[],
  ) =>
    targets.length === contract.targets.length &&
    targets.every(
      (target, i) =>
        sameTarget(target.capture, contract.targets[i]!) &&
        target.fence.connection_id === target.capture.connection_id &&
        target.fence.service_incarnation === incarnation &&
        Number.isSafeInteger(target.fence.generation) &&
        target.fence.generation >= 0,
    );
  return {
    get,
    list(verb?: string) {
      return (
        db
          .query(
            "SELECT id FROM outbox WHERE contract IS NOT NULL AND (? IS NULL OR json_extract(contract,'$.verb')=?) AND needs_migration=0 AND claimed=0 AND (cancel_requested=0 OR (ever_dispatched=1 AND recovery IN ('reconcilable','reattachable'))) AND (state='pending' OR (state='uncertain' AND recovery<>'opaque')) ORDER BY due_at,id LIMIT 100",
          )
          .all(verb ?? null, verb ?? null) as { id: string }[]
      ).map(({ id }) => get(id)!);
    },
    transition(change: EffectTransition, at: number): EffectReply {
      const entry = get(change.id);
      if (!entry || !entry.contract) return { effect: null, attention: null };
      const finished =
        entry.state !== "needs-migration" && attentionFinished(entry.state);
      switch (change.action) {
        case "claim": {
          const recoveryOnly =
            entry.cancel_requested &&
            entry.ever_dispatched &&
            ["reconcilable", "reattachable"].includes(entry.recovery);
          if (
            change.incarnation !== incarnation ||
            entry.claimed ||
            finished ||
            entry.state === "needs-migration" ||
            entry.state === "dispatching" ||
            (entry.cancel_requested && !recoveryOnly) ||
            entry.due_at > at
          )
            return { effect: null, attention: null };
          if (
            entry.state === "uncertain" &&
            entry.recovery === "opaque" &&
            entry.owner_retry_attempt === null
          )
            return { effect: null, attention: null };
          const fence: AttemptFence = {
            service_incarnation: incarnation,
            attempt: entry.attempt + 1,
          };
          db.query(
            "UPDATE outbox SET state='pending',claimed=1,attempt=attempt+1,attempt_fence=?,dispatch_targets=NULL,evidence=? WHERE id=? AND claimed=0",
          ).run(
            JSON.stringify(fence),
            JSON.stringify({
              reason: "Effect attempt claimed for current checks",
            }),
            entry.id,
          );
          const claimed = get(entry.id)!;
          audit(
            claimed,
            "claimed",
            at,
            "Claimed with the current service incarnation",
          );
          return reply(entry.id);
        }
        case "qualify": {
          if (
            !valid(entry, change.fence) ||
            !entry.claimed ||
            !entry.ever_dispatched
          )
            return { effect: null, attention: null };
          if (
            !targetsMatch(entry.contract, change.targets) ||
            !change.targets.length
          )
            throw new Error(
              "recovery targets are not freshly qualified captured bindings",
            );
          db.query(
            "UPDATE outbox SET dispatch_targets=?,evidence=? WHERE id=?",
          ).run(
            JSON.stringify(change.targets),
            JSON.stringify({
              ...entry.evidence,
              fence: change.targets[0]!.fence,
            }),
            entry.id,
          );
          audit(
            get(entry.id)!,
            "claimed",
            at,
            "Original outcome observation uses freshly qualified targets",
          );
          return reply(entry.id);
        }
        case "begin": {
          if (
            !valid(entry, change.fence) ||
            !entry.claimed ||
            entry.state !== "pending" ||
            entry.cancel_requested
          )
            return { effect: null, attention: null };
          const verb = verbs(entry.contract.verb);
          if (!verb || verb.version !== entry.contract.version) {
            db.query(
              "UPDATE outbox SET needs_migration=1,claimed=0,evidence=? WHERE id=?",
            ).run(
              JSON.stringify({
                ...entry.evidence,
                reason: "Operation version needs explicit migration",
              }),
              entry.id,
            );
            audit(
              entry,
              "refused",
              at,
              "Operation version needs explicit migration",
            );
            return reply(entry.id);
          }
          validateEffectContract(entry.contract, entry.recovery, verbs);
          if (
            !targetsMatch(entry.contract, change.targets) ||
            !change.targets.length
          )
            throw new Error(
              "dispatch targets are not freshly qualified captured bindings",
            );
          const fence: DispatchFence = change.targets[0]!.fence;
          db.query(
            "UPDATE outbox SET state='dispatching',claimed=0,ever_dispatched=1,owner_retry_attempt=NULL,dispatch_targets=?,evidence=? WHERE id=?",
          ).run(
            JSON.stringify(change.targets),
            JSON.stringify({
              ...entry.evidence,
              reason: "Dispatch checks committed",
              fence,
            }),
            entry.id,
          );
          audit(
            get(entry.id)!,
            "dispatching",
            at,
            "Dispatching before the source effect",
          );
          return reply(entry.id);
        }
        case "defer": {
          if (
            entry.claimed ||
            entry.state === "dispatching" ||
            finished ||
            entry.state === "needs-migration"
          )
            return { effect: null, attention: null };
          if (!Number.isSafeInteger(change.due_at))
            throw new Error("invalid effect deadline");
          db.query("UPDATE outbox SET due_at=?,evidence=? WHERE id=?").run(
            change.due_at,
            JSON.stringify({ ...entry.evidence, reason: change.reason }),
            entry.id,
          );
          return reply(entry.id);
        }
        case "finish": {
          if (
            !valid(entry, change.fence) ||
            !(
              entry.state === "dispatching" ||
              (entry.state === "pending" && entry.claimed)
            )
          )
            return { effect: null, attention: null };
          if (change.state === "dispatching")
            throw new Error("finish cannot start an effect");
          const state =
            entry.cli_received_at !== null
              ? "delivered"
              : change.state === "cancelled" && entry.ever_dispatched
                ? "uncertain"
                : change.state;
          update(entry, state, at, change.reason, change.due_at ?? at);
          db.query(
            "UPDATE outbox SET receipt=coalesce(?,receipt),external_handle=coalesce(?,external_handle) WHERE id=?",
          ).run(
            change.receipt ? JSON.stringify(change.receipt) : null,
            change.external_handle
              ? JSON.stringify(change.external_handle)
              : null,
            entry.id,
          );
          db.query(
            "UPDATE answer_attempts SET receipt=coalesce(?,receipt),external_handle=coalesce(?,external_handle) WHERE intent_id=? AND attempt=?",
          ).run(
            change.receipt ? JSON.stringify(change.receipt) : null,
            change.external_handle
              ? JSON.stringify(change.external_handle)
              : null,
            entry.id,
            entry.attempt,
          );
          return reply(entry.id);
        }
        case "handle": {
          if (
            !valid(entry, change.fence) ||
            !(entry.claimed || entry.state === "dispatching")
          )
            return { effect: null, attention: null };
          if (
            entry.external_handle &&
            JSON.stringify(entry.external_handle) !==
              JSON.stringify(change.handle)
          )
            throw new Error("the original external handle cannot be replaced");
          db.query("UPDATE outbox SET external_handle=? WHERE id=?").run(
            JSON.stringify(change.handle),
            entry.id,
          );
          db.query(
            "UPDATE answer_attempts SET external_handle=? WHERE intent_id=? AND attempt=?",
          ).run(JSON.stringify(change.handle), entry.id, entry.attempt);
          return reply(entry.id);
        }
        case "version-block": {
          if (!valid(entry, change.fence) || !entry.claimed)
            return { effect: null, attention: null };
          db.query(
            "UPDATE outbox SET needs_migration=1,claimed=0,evidence=? WHERE id=?",
          ).run(
            JSON.stringify({ ...entry.evidence, reason: change.reason }),
            entry.id,
          );
          audit(entry, "refused", at, change.reason);
          return reply(entry.id);
        }
        case "cancel": {
          if (finished) return reply(entry.id);
          decision(entry, change, at);
          db.query("UPDATE outbox SET cancel_requested=1 WHERE id=?").run(
            entry.id,
          );
          if (entry.ever_dispatched) {
            if (entry.state !== "dispatching")
              update(
                entry,
                "uncertain",
                at,
                "Cancelled after possible dispatch; outcome is not undone",
              );
          } else update(entry, "cancelled", at, change.reason);
          return reply(entry.id);
        }
        case "decide": {
          if (change.outcome === "close") {
            if (
              entry.attempt !== change.attempt ||
              entry.claimed ||
              entry.state === "dispatching" ||
              !["uncertain", "refused", "needs-migration"].includes(entry.state)
            )
              return { effect: null, attention: null };
            decision(entry, change, at);
            // Close tracking while retaining the actual attempt outcome and
            // every receipt, handle and possible-dispatch witness.
            db.query(
              "UPDATE outbox SET state='cancelled',cancel_requested=1,claimed=0,needs_migration=0,resolved_at=?,evidence=? WHERE id=?",
            ).run(
              at,
              JSON.stringify({ ...entry.evidence, reason: change.reason }),
              entry.id,
            );
            return reply(entry.id);
          }
          if (
            entry.attempt !== change.attempt ||
            !["uncertain", "refused"].includes(entry.state)
          )
            return { effect: null, attention: null };
          decision(entry, change, at);
          db.query(
            "UPDATE outbox SET state='pending',claimed=0,cancel_requested=0,resolved_at=NULL,due_at=?,owner_retry_attempt=?,evidence=? WHERE id=?",
          ).run(
            at,
            entry.attempt,
            JSON.stringify({ ...entry.evidence, reason: change.reason }),
            entry.id,
          );
          return reply(entry.id);
        }
        case "migrate": {
          if (
            entry.claimed ||
            entry.state === "dispatching" ||
            entry.contract.version !== change.from
          )
            return { effect: null, attention: null };
          const contract = {
            ...entry.contract,
            version: change.to,
            params: change.params ?? entry.contract.params,
          };
          const verb = verbs(contract.verb);
          if (!verb || verb.version !== change.to)
            throw new Error(
              "migration target operation version is unsupported",
            );
          validateEffectContract(contract, entry.recovery, verbs);
          decision(entry, change, at, change.to);
          db.query(
            "UPDATE outbox SET contract=?,needs_migration=0,evidence=? WHERE id=?",
          ).run(
            JSON.stringify(contract),
            JSON.stringify({ ...entry.evidence, reason: change.reason }),
            entry.id,
          );
          return reply(entry.id);
        }
      }
    },
  };
}
