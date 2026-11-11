import type { BinEntry } from "../../../shared/bin";
import type { EffectDriver } from "../effects/runner";
import type { EffectEntry } from "../effects/types";
import type { ReadyRuntimeLease } from "../connections/manager";
import { coreKillPlan, coreKillRefusal } from "../herdr-core/kill-plan";
import { coreOccupantFingerprint } from "../herdr-core/labels";
import { killCore, CoreOperationRefused } from "../herdr-core/operations";
import { coreAlsoEndedText } from "../../../shared/coreKill";
import type { CoreConnectionRuntime } from "../herdr-core/runtime";
import type { OutboxEffect } from "../storage/world-protocol";

/**
 * The bin's close of a herdr-core terminal: a native kill, recorded as a
 * durable effect when the bus leaves. It carries the person's confirmation
 * of everything that ends with the terminal (core ends a program's
 * children with it, M7) and refuses at the last moment if more would end
 * now, or if the terminal holds another program. A lost reply is
 * uncertain: World reads whether it ended and never kills again unless
 * that read shows it still running the confirmed program.
 */
export const BIN_CORE_CLOSE_VERB = "world.bin.close_core";

type CoreLease = ReadyRuntimeLease<CoreConnectionRuntime>;

const GONE = {
  removed: "Its host was removed, so it was not closed.",
  restarted: "Its host's herdr-core reconnected, so it was not closed.",
  earlierRun: "World restarted before it was sent, so it was not closed.",
  ended: "It had already ended, so nothing was sent.",
} as const;
export const CORE_GONE_REASONS = new Set<string>(Object.values(GONE));

export function binCoreCloseEffect(
  entry: BinEntry,
  incarnation: string,
): OutboxEffect {
  return {
    kind: BIN_CORE_CLOSE_VERB,
    record_id: entry.id,
    recovery: "reconcilable",
    target: {
      adapter: "herdr-core",
      connection_id: entry.connection_id,
      kind: "terminal",
      native_id: entry.terminal_id,
      evidence: { terminal_id: entry.terminal_id },
    },
    contract: {
      verb: BIN_CORE_CLOSE_VERB,
      version: 1,
      params: {
        bin_id: entry.id,
        service_incarnation: incarnation,
        connection_generation: entry.connection_generation,
        confirmation: entry.confirmation,
      },
      targets: [
        {
          adapter: "herdr-core",
          connection_id: entry.connection_id,
          kind: "terminal",
          native_id: entry.terminal_id,
          evidence: { terminal_id: entry.terminal_id },
        },
      ],
      actor: { kind: "browser", subject: "owner", evidence: {} },
      authorization: { policy: "owner-bin" },
      idempotency_key: entry.id,
      preconditions: {
        connection_generation: entry.connection_generation,
        terminal_id: entry.terminal_id,
      },
      origin: `world.bin.${entry.view}`,
    },
  } as OutboxEffect;
}

function captured(entry: EffectEntry) {
  const contract = entry.contract;
  const target = contract?.targets[0];
  const params = contract?.params as
    | {
        bin_id?: string;
        service_incarnation?: string;
        connection_generation?: number;
        confirmation?: {
          core_id?: unknown;
          terminals?: unknown;
        };
      }
    | undefined;
  const confirmation = params?.confirmation;
  if (
    !target ||
    !("native_id" in target) ||
    typeof target.native_id !== "string" ||
    typeof params?.bin_id !== "string" ||
    typeof params.service_incarnation !== "string" ||
    !Number.isSafeInteger(params.connection_generation) ||
    typeof confirmation?.core_id !== "string" ||
    !Array.isArray(confirmation.terminals)
  )
    return null;
  const terminals = (confirmation.terminals as unknown[]).flatMap((value) => {
    const t = (value ?? {}) as Record<string, unknown>;
    return typeof t.address === "string"
      ? [
          {
            address: t.address,
            pid: typeof t.pid === "number" ? t.pid : null,
            occupant: typeof t.occupant === "string" ? t.occupant : null,
            remote: t.remote === true,
          },
        ]
      : [];
  });
  const root = terminals.find(
    (t) => t.address === target.native_id && !t.remote,
  );
  if (!root) return null;
  return {
    incarnation: params.service_incarnation,
    connection_id: target.connection_id,
    generation: params.connection_generation!,
    address: target.native_id,
    pid: root.pid,
    occupant: root.occupant,
    confirmation: { coreId: confirmation.core_id, terminals },
  };
}

export function coreBinCloseDriver(deps: {
  incarnation: string;
  hasConnection(id: string): boolean;
  lease(id: string): CoreLease | null | undefined;
  stopped(): boolean;
}): EffectDriver {
  const current = (connectionId: string, generation: number) => {
    const lease = deps.lease(connectionId);
    return lease && lease.generation === generation && lease.isCurrent()
      ? lease
      : null;
  };
  /** The terminal as core shows it now: still the confirmed program? */
  const occupant = (
    lease: CoreLease,
    target: NonNullable<ReturnType<typeof captured>>,
  ) => {
    const record = lease.runtime.core.mirror.terminal(target.address);
    if (!record || record.state !== "live") return "ended" as const;
    // The print, not the pid: a kept replacement may reuse the pid.
    const print = coreOccupantFingerprint(
      lease.runtime.core.epoch?.coreId ?? "",
      record,
    );
    return record.pid === target.pid && print === target.occupant
      ? ("same" as const)
      : ("other" as const);
  };
  return {
    authorize: (entry) => {
      const target = captured(entry);
      return target && deps.hasConnection(target.connection_id)
        ? "allowed"
        : "refused";
    },
    preconditions: (entry) => (captured(entry) ? "allowed" : "refused"),
    async resolve(entry) {
      const target = captured(entry);
      if (!target || !deps.hasConnection(target.connection_id))
        return { state: "ended", reason: GONE.removed };
      if (target.incarnation !== deps.incarnation)
        return { state: "ended", reason: GONE.earlierRun };
      const lease = deps.lease(target.connection_id);
      if (!lease || !lease.isCurrent() || !lease.runtime.core.actionable)
        return {
          state: "unresolved",
          reason: "Its host's herdr-core is not connected; the close waits.",
        };
      if (lease.generation !== target.generation)
        return { state: "ended", reason: GONE.restarted };
      const now = occupant(lease, target);
      if (now === "other" || (now === "ended" && !entry.ever_dispatched))
        return { state: "ended", reason: GONE.ended };
      return {
        state: "attached",
        targets: [
          {
            capture: entry.contract!.targets[0]!,
            fence: {
              connection_id: lease.connectionId,
              generation: lease.generation,
              service_incarnation: deps.incarnation,
            },
          },
        ],
      };
    },
    guard(entry, targets) {
      const target = captured(entry);
      return Boolean(
        !deps.stopped() &&
          target &&
          target.incarnation === deps.incarnation &&
          targets.length === 1 &&
          targets[0]!.fence.generation === target.generation &&
          current(target.connection_id, target.generation),
      );
    },
    async invoke(entry, context) {
      const target = captured(entry)!;
      const lease =
        !deps.stopped() && target.incarnation === deps.incarnation
          ? current(target.connection_id, target.generation)
          : null;
      if (!lease) {
        await context.beforeSubmit();
        return {
          state: "wait",
          reason: "Its host's herdr-core is not current",
          not_submitted: true,
        };
      }
      if (occupant(lease, target) !== "same")
        return { state: "refused", reason: GONE.ended, not_submitted: true };
      // A child started while it rode the bus: refused before anything is
      // sent, so the close is known not to have happened.
      const refusal = coreKillRefusal(
        coreKillPlan(
          lease.runtime.core.epoch?.coreId ?? "",
          lease.runtime.core.mirror.terminals(),
          [target.address],
        ),
        target.confirmation,
      );
      if (refusal)
        return {
          state: "refused",
          reason: `${refusal} Nothing was ended.`,
          not_submitted: true,
        };
      if (!(await context.beforeSubmit()))
        return {
          state: "wait",
          reason: "The close's checks changed before it was sent",
          not_submitted: true,
        };
      try {
        const outcome = await killCore(
          lease,
          [target.address],
          target.confirmation,
        );
        if (outcome.killed.includes(target.address)) {
          const alsoEnded = coreAlsoEndedText(outcome.alsoEnded);
          return {
            state: "delivered",
            receipt: {
              method: "terminal.kill",
              closed_tab: true,
              ...(alsoEnded ? { also_ended: alsoEnded } : {}),
            },
          };
        }
        if (outcome.uncertain.length)
          return {
            state: "uncertain",
            reason:
              "herdr-core's reply was lost; World checks whether it ended.",
          };
        return { state: "refused", reason: GONE.ended, not_submitted: true };
      } catch (error) {
        if (error instanceof CoreOperationRefused)
          return {
            state: "refused",
            reason: error.message,
            not_submitted: true,
          };
        throw error;
      }
    },
    async reconcile(entry) {
      const target = captured(entry);
      const lease = target && current(target.connection_id, target.generation);
      if (!target || !lease || !lease.runtime.core.actionable)
        return { state: "unknown" };
      const now = occupant(lease, target);
      if (now === "ended")
        return {
          state: "happened",
          receipt: { method: "terminal.kill", closed_tab: true },
        };
      return now === "same" ? { state: "not-happened" } : { state: "unknown" };
    },
  };
}
