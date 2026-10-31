import type { Clock, Scheduler } from "../service/ports";
import { attentionRetryDelay } from "../storage/world-protocol";
import type { EffectVerbLookup } from "./contracts";
import { productionEffectVerb } from "./contracts";
import type {
  AttemptFence,
  EffectEntry,
  EffectPolicyResult,
  EffectStore,
  QualifiedEffectTarget,
} from "./types";

export type EffectResolution =
  | { state: "attached"; targets: readonly QualifiedEffectTarget[] }
  | { state: "unresolved" | "ended" | "unconfirmed"; reason: string };
export type EffectResult =
  | {
      state: "delivered";
      receipt: Record<string, unknown>;
      external_handle?: Record<string, unknown>;
    }
  | {
      state: "wait" | "refused" | "uncertain";
      reason: string;
      not_submitted?: true;
    };
export type EffectDispatchContext = {
  idempotency_key: string;
  beforeSubmit(): Promise<boolean>;
  guard(): boolean;
  handle(value: Record<string, unknown>): Promise<boolean>;
};
export type EffectDriver = {
  authorize(
    entry: EffectEntry,
  ): EffectPolicyResult | Promise<EffectPolicyResult>;
  preconditions(
    entry: EffectEntry,
  ): EffectPolicyResult | Promise<EffectPolicyResult>;
  resolve(entry: EffectEntry): EffectResolution | Promise<EffectResolution>;
  guard(entry: EffectEntry, targets: readonly QualifiedEffectTarget[]): boolean;
  invoke(
    entry: EffectEntry,
    context: EffectDispatchContext,
  ): Promise<EffectResult>;
  reconcile?(
    entry: EffectEntry,
  ): Promise<
    | { state: "happened"; receipt: Record<string, unknown> }
    | { state: "not-happened" | "unknown" }
  >;
  find?(
    entry: EffectEntry,
  ): Promise<{ handle: Record<string, unknown> } | null>;
  reattach?(
    entry: EffectEntry,
    handle: Record<string, unknown>,
  ): Promise<EffectResult>;
};
export class EffectExecutionStopped extends Error {}

/** Shared admission and durable dispatch boundary; drivers own source mechanics. */
export function createEffectRunner(deps: {
  store: EffectStore;
  clock: Clock;
  scheduler: Scheduler;
  incarnation: string;
  verb?: string;
  retryDelay?(attempt: number): number;
  verbs?: EffectVerbLookup;
  driver(verb: string): EffectDriver | undefined;
  changed?(): void;
  log?(error: unknown): void;
  checkpoint?(
    phase: "claimed" | "dispatching" | "after-source" | "receipt",
    entry: EffectEntry,
  ): void | Promise<void>;
}) {
  const verbs = deps.verbs ?? productionEffectVerb;
  const running = new Map<string, Promise<EffectEntry | null>>();
  let stopped = false;
  let timer: { cancel(): void } | undefined;
  let planning = Promise.resolve();
  let draining: Promise<void> | undefined;
  let requested = false;
  const transition: EffectStore["transition"] = async (change) => {
    const entry = await deps.store.transition(change);
    if (entry) deps.changed?.();
    return entry;
  };
  async function execute(id: string) {
    const entry = await deps.store.get(id);
    if (
      !entry ||
      stopped ||
      !entry.contract ||
      entry.state === "needs-migration" ||
      !["pending", "uncertain"].includes(entry.state) ||
      entry.claimed ||
      entry.due_at > deps.clock.now()
    )
      return entry;
    if (
      entry.state === "uncertain" &&
      entry.recovery === "opaque" &&
      entry.owner_retry_attempt === null
    )
      return entry;
    const driver = deps.driver(entry.contract.verb);
    if (!driver)
      return transition({
        action: "defer",
        id,
        due_at: deps.clock.now() + 60_000,
        reason: "Waiting for the declared effect driver",
      });
    const claimed = await transition({
      action: "claim",
      id,
      incarnation: deps.incarnation,
    });
    if (!claimed?.claimed || !claimed.attempt_fence) return deps.store.get(id);
    const fence: AttemptFence = claimed.attempt_fence;
    const finish = (
      state: "pending" | "delivered" | "uncertain" | "refused",
      reason: string,
      receipt?: Record<string, unknown>,
      external_handle?: Record<string, unknown>,
    ) =>
      transition({
        action: "finish",
        id,
        fence,
        state,
        reason,
        receipt,
        external_handle,
        due_at:
          deps.clock.now() +
          (deps.retryDelay ?? attentionRetryDelay)(claimed.attempt),
      });
    let marked = false;
    let resolution: EffectResolution | undefined;
    let refusal = {
      state: "wait" as "wait" | "refused",
      reason: "Effect admission is unavailable",
    };
    const guard = () => {
      const current = deps.store.current(id);
      return (
        !stopped &&
        marked &&
        current?.state === "dispatching" &&
        !current.cancel_requested &&
        current.attempt === fence.attempt &&
        current.attempt_fence?.service_incarnation === deps.incarnation &&
        resolution?.state === "attached" &&
        driver.guard(current, resolution.targets)
      );
    };
    try {
      await deps.checkpoint?.("claimed", claimed);
      const verb = verbs(claimed.contract!.verb);
      if (!verb || verb.version !== claimed.contract!.version)
        return transition({
          action: "version-block",
          id,
          fence,
          reason: "Operation version needs explicit migration",
        });
      // Recovery observes the original operation. It never grants permission to
      // submit another effect, including after cancellation or revocation.
      if (
        claimed.ever_dispatched &&
        ["reconcilable", "reattachable"].includes(claimed.recovery)
      ) {
        resolution = await driver.resolve(claimed);
        if (resolution.state !== "attached")
          return finish("uncertain", resolution.reason);
        const observing = await transition({
          action: "qualify",
          id,
          fence,
          targets: resolution.targets,
        });
        if (!observing) return deps.store.get(id);
        if (claimed.recovery === "reconcilable") {
          const outcome = await driver.reconcile?.(observing);
          if (outcome?.state === "happened")
            return finish(
              "delivered",
              "Reconciliation confirmed the source effect",
              outcome.receipt,
            );
          if (outcome?.state !== "not-happened")
            return finish(
              "uncertain",
              "Reconciliation cannot establish the original outcome",
            );
        } else {
          const handle =
            observing.external_handle ??
            (await driver.find?.(observing))?.handle;
          if (!handle || !driver.reattach)
            return finish(
              "uncertain",
              "The original external run cannot be found; relaunch is forbidden",
            );
          if (!(await transition({ action: "handle", id, fence, handle })))
            return deps.store.get(id);
          const outcome = await driver.reattach(observing, handle);
          return finish(
            outcome.state === "delivered" ? "delivered" : "uncertain",
            outcome.state === "delivered"
              ? "Observed the original external run"
              : outcome.reason,
            outcome.state === "delivered" ? outcome.receipt : undefined,
            handle,
          );
        }
      }
      if (claimed.cancel_requested)
        return finish(
          "uncertain",
          "Cancellation prevents another submission; the previous outcome is retained",
        );
      if (verb.policy[claimed.contract!.actor.kind] !== "allow")
        return finish(
          claimed.ever_dispatched ? "uncertain" : "refused",
          "Current registered actor policy refuses this effect",
        );
      const authorization = await driver.authorize(claimed);
      if (authorization !== "allowed")
        return finish(
          claimed.ever_dispatched
            ? "uncertain"
            : authorization === "wait"
              ? "pending"
              : "refused",
          "Current effect authorization is " + authorization,
        );
      const condition = await driver.preconditions(claimed);
      if (condition !== "allowed")
        return finish(
          claimed.ever_dispatched
            ? "uncertain"
            : condition === "wait"
              ? "pending"
              : "refused",
          "Effect precondition is " + condition,
        );
      const context: EffectDispatchContext = {
        idempotency_key: claimed.contract!.idempotency_key,
        handle: async (handle) =>
          Boolean(await transition({ action: "handle", id, fence, handle })),
        guard,
        beforeSubmit: async () => {
          const current = await deps.store.get(id);
          if (
            stopped ||
            !current?.claimed ||
            current.attempt !== fence.attempt ||
            current.cancel_requested
          )
            return false;
          resolution = await driver.resolve(current);
          if (resolution.state !== "attached") {
            refusal = {
              state: resolution.state === "unresolved" ? "wait" : "refused",
              reason: resolution.reason,
            };
            return false;
          }
          const authorized = await driver.authorize(current);
          const precondition = await driver.preconditions(current);
          if (
            authorized !== "allowed" ||
            precondition !== "allowed" ||
            !driver.guard(current, resolution.targets)
          ) {
            refusal = {
              state:
                authorized === "wait" || precondition === "wait"
                  ? "wait"
                  : "refused",
              reason: "Dispatch authorization or precondition changed",
            };
            return false;
          }
          const begun = await transition({
            action: "begin",
            id,
            fence,
            targets: resolution.targets,
          });
          marked = begun?.state === "dispatching";
          if (!marked) return false;
          await deps.checkpoint?.("dispatching", begun!);
          return guard();
        },
      };
      const result = await driver.invoke(claimed, context);
      if (marked) await deps.checkpoint?.("after-source", claimed);
      const current = await deps.store.get(id);
      if (
        !current ||
        current.attempt !== fence.attempt ||
        (!current.claimed && current.state !== "dispatching")
      )
        return current;
      if (result.state === "delivered" && marked) {
        const receipt = await finish(
          "delivered",
          "Source acknowledged the effect",
          result.receipt,
          result.external_handle,
        );
        if (receipt) await deps.checkpoint?.("receipt", receipt);
        return receipt;
      }
      if (result.state === "delivered")
        return finish(
          claimed.ever_dispatched ? "uncertain" : "refused",
          "Source returned success without the durable dispatch boundary",
        );
      if (marked)
        return finish(
          result.state === "refused"
            ? "refused"
            : result.state === "wait" && result.not_submitted
              ? "pending"
              : "uncertain",
          result.reason,
        );
      if (result.state === "refused")
        return finish(
          claimed.ever_dispatched ? "uncertain" : "refused",
          result.reason,
        );
      return finish(
        claimed.ever_dispatched
          ? "uncertain"
          : refusal.state === "wait"
            ? "pending"
            : "refused",
        refusal.reason,
      );
    } catch (error) {
      if (error instanceof EffectExecutionStopped) throw error;
      deps.log?.(error);
      return finish(
        marked ? "uncertain" : "pending",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  const run = (id: string) => {
    const existing = running.get(id);
    if (existing) return existing;
    const work = execute(id).finally(() => running.delete(id));
    running.set(id, work);
    return work;
  };
  const plan = () =>
    (planning = planning
      .then(async () => {
        timer?.cancel();
        timer = undefined;
        if (stopped) return;
        const next = (await deps.store.list(deps.verb))[0];
        if (next && !stopped)
          timer = deps.scheduler.schedule(
            () => {
              void wake();
            },
            Math.min(60_000, Math.max(0, next.due_at - deps.clock.now())),
          );
      })
      .catch((error) => deps.log?.(error)));
  const wake = () => {
    if (stopped) return Promise.resolve();
    requested = true;
    if (draining) return draining;
    timer?.cancel();
    timer = undefined;
    draining = (async () => {
      while (requested && !stopped) {
        requested = false;
        for (const entry of await deps.store.list(deps.verb)) {
          if (stopped || entry.due_at > deps.clock.now()) break;
          await run(entry.id);
        }
      }
    })()
      .catch((error) => deps.log?.(error))
      .finally(async () => {
        draining = undefined;
        await plan();
      });
    return draining;
  };
  return {
    run,
    wake,
    rearm: plan,
    async stop() {
      stopped = true;
      timer?.cancel();
      timer = undefined;
      await Promise.allSettled([planning, draining, ...running.values()]);
    },
  };
}
