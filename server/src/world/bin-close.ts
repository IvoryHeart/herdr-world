import type { BinEntry, BinOutcome } from "../../../shared/bin";
import { createEffectRunner, type EffectDriver } from "../effects/runner";
import type { EffectEntry, EffectStore } from "../effects/types";
import {
  EFFECT_LANE_PAGE,
  StorageWriteRejected,
  type AttentionOutbox,
  type OutboxEffect,
  type StoragePorts,
} from "../storage/world-protocol";
import { BinCloseNotRecorded, NOT_RECORDED } from "./bin";
import type { LedgerStore } from "./world-ledger";

export const BIN_CLOSE_VERB = "world.bin.close";

/** A connection's current runtime, as the bin's close uses it. */
export type BinLease = {
  connectionId: string;
  generation: number;
  isCurrent(): boolean;
  call(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    beforeSend?: () => void,
  ): Promise<unknown>;
};

type Pane = {
  pane_id: string;
  tab_id: string;
  terminal_id: string;
  workspace_id: string;
};

/** Reasons that mean "nothing was sent because the agent was already gone". */
const GONE = {
  removed: "Its host was removed, so it was not closed.",
  restarted: "Its host restarted, so it was not closed.",
  earlierRun: "World restarted before it was sent, so it was not closed.",
  moved: "It had already closed or moved, so nothing was sent.",
} as const;
const GONE_REASONS = new Set<string>(Object.values(GONE));
const WORKTREE_ROOT =
  "A worktree root's pane closes only with its workspace; close its other panes first.";
const PINNED_TAB = "A pinned tab keeps its last pane, so it was not closed.";

class NotSent extends Error {}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function panesOf(result: unknown, workspaceId: string): Pane[] {
  const panes = record(result) ? result.panes : undefined;
  if (!Array.isArray(panes)) throw new Error("Cannot read the panes");
  return panes
    .filter(
      (pane): pane is Pane =>
        record(pane) &&
        typeof pane.pane_id === "string" &&
        typeof pane.tab_id === "string" &&
        typeof pane.terminal_id === "string" &&
        pane.workspace_id === workspaceId,
    )
    .map(({ pane_id, tab_id, terminal_id, workspace_id }) => ({
      pane_id,
      tab_id,
      terminal_id,
      workspace_id,
    }));
}

/** What the intent captured when the bus left. */
function captured(entry: EffectEntry) {
  const contract = entry.contract;
  const target = contract?.targets[0];
  const params = contract?.params as
    | {
        bin_id?: string;
        workspace_id?: string;
        tab_id?: string;
        connection_generation?: number;
        service_incarnation?: string;
        preserve_tab?: boolean;
      }
    | undefined;
  if (
    !target ||
    !("native_id" in target) ||
    !target.evidence.terminal_id ||
    typeof params?.workspace_id !== "string" ||
    typeof params.tab_id !== "string" ||
    typeof params.bin_id !== "string" ||
    typeof params.service_incarnation !== "string" ||
    !Number.isSafeInteger(params.connection_generation)
  )
    return null;
  return {
    bin_id: params.bin_id,
    /**
     * The World run that recorded it. A runtime generation is a per-run
     * counter (a restarted World counts from 1 again), so it proves the
     * same runtime only within this run.
     */
    incarnation: params.service_incarnation,
    connection_id: target.connection_id,
    generation: params.connection_generation!,
    workspace_id: params.workspace_id,
    tab_id: params.tab_id,
    pane_id: target.native_id,
    terminal_id: target.evidence.terminal_id,
    preserve_tab: params.preserve_tab === true,
  };
}

/** The durable intent for one rider whose bus left (or on Close now). */
export function binCloseEffect(
  entry: BinEntry,
  incarnation: string,
): OutboxEffect {
  const target = {
    adapter: "herdr",
    connection_id: entry.connection_id,
    kind: "pane",
    native_id: entry.pane_id,
    evidence: { terminal_id: entry.terminal_id },
  };
  return {
    kind: BIN_CLOSE_VERB,
    record_id: entry.id,
    recovery: "reconcilable",
    target,
    contract: {
      verb: BIN_CLOSE_VERB,
      version: 1,
      params: {
        bin_id: entry.id,
        service_incarnation: incarnation,
        workspace_id: entry.workspace_id,
        tab_id: entry.tab_id,
        connection_generation: entry.connection_generation,
        ...(entry.preserve_tab ? { preserve_tab: true } : {}),
      },
      targets: [target],
      actor: { kind: "browser", subject: "owner", evidence: {} },
      authorization: { policy: "owner-bin" },
      idempotency_key: entry.id,
      preconditions: {
        connection_generation: entry.connection_generation,
        terminal_id: entry.terminal_id,
        tab_id: entry.tab_id,
      },
      origin: `world.bin.${entry.view}`,
    },
  };
}

/**
 * The bin's close, as a durable effect. One runner per connection, so closes
 * on one host run one at a time (each reads the panes the previous one left)
 * and a stalled host never holds back another's. Every attempt is fenced by
 * the runtime generation and terminal captured when the bus left.
 */
export function createBinCloser(deps: {
  ledger(): LedgerStore;
  outbox(): AttentionOutbox;
  effects(): EffectStore;
  incarnation: string;
  clock: StoragePorts["clock"];
  scheduler: StoragePorts["scheduler"];
  hasConnection(id: string): boolean;
  lease(id: string): BinLease | null | undefined;
  settle(
    binId: string,
    outcome: Omit<BinOutcome, "id" | "label" | "view">,
  ): void;
  log(message: string): void;
  /** How long a waiting close waits before its next try (tests shorten it). */
  retryDelay?(attempt: number): number;
  /** Any close's durable state moved (tests wait on it instead of sleeping). */
  changed?(): void;
}) {
  const current = (connectionId: string, generation: number) => {
    const lease = deps.lease(connectionId);
    return lease &&
      lease.connectionId === connectionId &&
      lease.generation === generation &&
      lease.isCurrent()
      ? lease
      : null;
  };
  /** Each intent's pane count at its last resolution (the final read). */
  const finalLayouts = new Map<string, number>();
  let stopped = false;
  const readPanes = async (lease: BinLease, workspaceId: string) =>
    panesOf(
      await lease.call("pane.list", { workspace_id: workspaceId }, 5_000),
      workspaceId,
    );

  const driver: EffectDriver = {
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
      // Recorded by an earlier World run: no proof the host's runtime is the
      // same, so never act on it. Unsent, it ends not sent; possibly sent,
      // the runner keeps it uncertain without reconciling or resending.
      if (target.incarnation !== deps.incarnation)
        return { state: "ended", reason: GONE.earlierRun };
      const lease = deps.lease(target.connection_id);
      if (!lease || !lease.isCurrent())
        return {
          state: "unresolved",
          reason: "Its host is not connected; the close waits.",
        };
      if (lease.generation !== target.generation)
        return { state: "ended", reason: GONE.restarted };
      // This read is the last before a send (the runner resolves again just
      // before dispatching): its layout decides the close's scope.
      let panes: Pane[] | null = null;
      try {
        panes = await readPanes(lease, target.workspace_id);
      } catch (error) {
        // After a possible dispatch only the decisive read in reconcile decides.
        if (!entry.ever_dispatched) throw error;
      }
      if (panes) finalLayouts.set(entry.id, panes.length);
      else finalLayouts.delete(entry.id);
      const pane = panes?.find((item) => item.pane_id === target.pane_id);
      // Another occupant in the pane always ends it; an absent pane only
      // before any dispatch (afterwards, reconcile reads whether it happened).
      if (
        (pane &&
          (pane.terminal_id !== target.terminal_id ||
            pane.tab_id !== target.tab_id)) ||
        (!pane && !entry.ever_dispatched)
      )
        return { state: "ended", reason: GONE.moved };
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
        !stopped &&
          target &&
          target.incarnation === deps.incarnation &&
          targets.length === 1 &&
          targets[0]!.fence.generation === target.generation &&
          current(target.connection_id, target.generation),
      );
    },
    async invoke(entry, context) {
      const target = captured(entry)!;
      if (stopped)
        return {
          state: "wait",
          reason: "World is stopping",
          not_submitted: true,
        };
      if (target.incarnation !== deps.incarnation) {
        // Read nothing from a possibly replaced runtime: the runner's own
        // resolution records it as not sent.
        await context.beforeSubmit();
        return {
          state: "wait",
          reason: GONE.earlierRun,
          not_submitted: true,
        };
      }
      const lease = current(target.connection_id, target.generation);
      if (!lease) {
        // The runner's own resolution records why: offline waits, a new
        // runtime or a removed host ends the intent unsent.
        await context.beforeSubmit();
        return {
          state: "wait",
          reason: "Its host's runtime is not current",
          not_submitted: true,
        };
      }
      const layout = await readPanes(lease, target.workspace_id);
      const pane = layout.find((item) => item.pane_id === target.pane_id);
      if (
        !pane ||
        pane.terminal_id !== target.terminal_id ||
        pane.tab_id !== target.tab_id
      )
        return { state: "refused", reason: GONE.moved, not_submitted: true };
      if (
        target.preserve_tab &&
        !layout.some(
          (item) =>
            item.tab_id === target.tab_id && item.pane_id !== target.pane_id,
        )
      )
        return { state: "refused", reason: PINNED_TAB, not_submitted: true };
      const closesWorkspace = layout.length === 1;
      if (!closesWorkspace) {
        const workspace = (await lease.call(
          "workspace.get",
          { workspace_id: target.workspace_id },
          5_000,
        )) as { workspace?: { worktree?: unknown } } | null;
        const worktree = workspace?.workspace?.worktree;
        // Herdr has no atomic no-group option on pane.close: in a worktree
        // root a concurrent pane exit could turn it into a group close.
        if (record(worktree) && worktree.is_linked_worktree !== true)
          return {
            state: "refused",
            reason: WORKTREE_ROOT,
            not_submitted: true,
          };
      }
      if (!(await context.beforeSubmit()))
        return {
          state: "wait",
          reason: "The close's checks changed before it was sent",
          not_submitted: true,
        };
      // The final read must still show the planned layout: a pane added or
      // gone since changes which close is safe (and the worktree-root rule).
      if (finalLayouts.get(entry.id) !== layout.length)
        return {
          state: "wait",
          reason:
            "Its workspace changed before the close was sent; it is checked again",
          not_submitted: true,
        };
      // pane.close can implicitly close a worktree group when native close
      // confirmation is off; workspace.close never does without close_group.
      const method = closesWorkspace ? "workspace.close" : "pane.close";
      const query = closesWorkspace
        ? { workspace_id: target.workspace_id }
        : { pane_id: target.pane_id };
      try {
        await lease.call(method, query, 30_000, () => {
          if (!context.guard()) throw new NotSent("Close fence retired");
        });
      } catch (error) {
        if (error instanceof NotSent)
          return { state: "wait", reason: error.message, not_submitted: true };
        if (
          error instanceof Error &&
          /^(workspace_group_close_required|confirmation_required):/.test(
            error.message,
          )
        )
          return {
            state: "refused",
            reason:
              "Herdr would have closed a whole worktree group, so nothing was closed.",
          };
        // Herdr's own error replies are `snake_case_code: message`; anything
        // else (timeouts, socket errors, garbled replies) may follow a close.
        if (
          error instanceof Error &&
          /^(?!(?:error|timeout): )[a-z][a-z0-9_]*: /.test(error.message)
        )
          return { state: "refused", reason: error.message };
        // A lost reply can follow a successful close: read back once below.
      }
      const outcome = await readBack(lease, target, closesWorkspace);
      return outcome
        ? { state: "delivered", receipt: outcome }
        : {
            state: "uncertain",
            reason: "Herdr's reply was lost and the pane is still there.",
          };
    },
    async reconcile(entry) {
      const target = captured(entry);
      const lease = target && current(target.connection_id, target.generation);
      if (!target || !lease) return { state: "unknown" };
      try {
        const outcome = await readBack(lease, target, false);
        return outcome
          ? { state: "happened", receipt: outcome }
          : { state: "not-happened" };
      } catch {
        return { state: "unknown" };
      }
    },
  };

  /** Whether the pane is gone, read decisively on its own runtime. */
  async function readBack(
    lease: BinLease,
    target: NonNullable<ReturnType<typeof captured>>,
    closedWorkspace: boolean,
  ): Promise<{ method: string; closed_tab: boolean } | null> {
    const workspaces = (await lease.call("workspace.list", {}, 5_000)) as {
      workspaces?: { workspace_id?: unknown }[];
    } | null;
    if (!Array.isArray(workspaces?.workspaces))
      throw new Error("Cannot read the workspaces");
    const workspaceRemains = workspaces.workspaces.some(
      (item) => item?.workspace_id === target.workspace_id,
    );
    if (!workspaceRemains)
      return { method: "workspace.close", closed_tab: true };
    if (closedWorkspace) return null;
    const remaining = await readPanes(lease, target.workspace_id);
    if (remaining.some((pane) => pane.terminal_id === target.terminal_id))
      return null;
    return {
      method: "pane.close",
      closed_tab: !remaining.some((pane) => pane.tab_id === target.tab_id),
    };
  }

  const runners = new Map<string, ReturnType<typeof createEffectRunner>>();
  /** Bin entry ID to its outbox ID, while World waits for its outcome. */
  const watched = new Map<string, string>();
  /** Commits still awaiting storage; stop waits for them. */
  const commits = new Set<Promise<void>>();

  /** One lane per connection; none is opened once World is stopping. */
  const runner = (connectionId: string) => {
    let lane = runners.get(connectionId);
    if (!lane && !stopped) {
      lane = createEffectRunner({
        store: deps.effects(),
        clock: deps.clock,
        scheduler: deps.scheduler,
        incarnation: deps.incarnation,
        verb: BIN_CLOSE_VERB,
        // A host that blips and returns should not wait minutes for its close.
        retryDelay:
          deps.retryDelay ??
          ((attempt) =>
            Math.min(60_000, 2_000 * 2 ** Math.max(0, attempt - 1))),
        connection: connectionId,
        driver: (verb) => (verb === BIN_CLOSE_VERB ? driver : undefined),
        changed: () =>
          queueMicrotask(() => {
            report();
            deps.changed?.();
          }),
        log: (error) => deps.log(`Bin close failed: ${String(error)}`),
      });
      runners.set(connectionId, lane);
    }
    return lane;
  };

  /** Connections no longer configured, whose closes can only end unsent. */
  const orphans = new Set<string>();
  let sweeping = false;
  /**
   * Their closes are settled one connection at a time (each lane drains,
   * then stops), so a long history of removed hosts never runs many lanes.
   */
  const sweep = async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      for (const id of orphans) {
        orphans.delete(id);
        if (stopped) return;
        const lane = runner(id);
        if (!lane) return;
        await lane.wake();
        if (!deps.hasConnection(id)) {
          runners.delete(id);
          await lane.stop();
        }
      }
    } finally {
      sweeping = false;
    }
  };

  /**
   * Find every connection with closes to carry out, a page at a time to the
   * end: configured hosts get a lane each; removed ones join the sweep.
   */
  const discover = async () => {
    let after = "";
    for (;;) {
      if (stopped) return;
      const page = (await deps.effects().lanes?.(BIN_CLOSE_VERB, after)) ?? [];
      for (const id of page)
        if (deps.hasConnection(id)) void runner(id)?.wake();
        else if (!runners.has(id)) orphans.add(id);
      if (page.length < EFFECT_LANE_PAGE) break;
      after = page[page.length - 1]!;
    }
    void sweep();
  };

  /** Entries whose intent is recorded or may be, not yet looked up. */
  const unconfirmed = new Set<string>();
  let retry: { cancel(): void } | null = null;
  /**
   * Look each entry's intent up by its record ID. Found: its outcome is
   * watched. Decisively absent after the write settled: it was not
   * recorded, so nothing will be sent. A failed read keeps it unconfirmed
   * and tries again shortly; it is never reported as unrecorded.
   */
  async function confirm() {
    for (const binId of [...unconfirmed]) {
      try {
        const effect = (await deps.outbox().forRecord(binId)).find(
          (item) => item.kind === BIN_CLOSE_VERB,
        );
        unconfirmed.delete(binId);
        if (effect) watched.set(binId, effect.id);
        else
          deps.settle(binId, {
            result: "refused",
            closed_tab: false,
            detail: NOT_RECORDED,
          });
      } catch (error) {
        deps.log(`Bin close lookup failed: ${String(error)}`);
      }
    }
    if (unconfirmed.size && !retry && !stopped)
      retry = deps.scheduler.schedule(() => {
        retry = null;
        void confirm().then(report);
      }, 2_000);
  }

  function report() {
    if (unconfirmed.size) void confirm();
    for (const [binId, effectId] of watched) {
      const entry = deps.effects().current(effectId);
      // Uncertain is shown once; the runner keeps reconciling it by reading,
      // and never re-sends unless that read shows the pane is still there.
      if (
        !entry ||
        !["delivered", "refused", "cancelled", "uncertain"].includes(
          entry.state,
        )
      )
        continue;
      watched.delete(binId);
      const reason = entry.evidence?.reason ?? "";
      const receipt = entry.receipt as { closed_tab?: unknown } | null;
      deps.settle(
        binId,
        entry.state === "delivered"
          ? { result: "closed", closed_tab: receipt?.closed_tab === true }
          : !entry.ever_dispatched && GONE_REASONS.has(reason)
            ? { result: "gone", closed_tab: false, detail: reason }
            : {
                result: entry.ever_dispatched ? "uncertain" : "refused",
                closed_tab: false,
                detail: reason,
              },
      );
    }
  }

  return {
    /**
     * Record one durable intent per entry, then start their dispatch. Once
     * the intents are recorded, a stop that overlaps this leaves them for
     * the next run's recovery: no lane is opened and nothing is sent here.
     */
    async commit(entries: readonly BinEntry[]) {
      if (stopped) throw new BinCloseNotRecorded("World is stopping");
      const work = (async () => {
        let acknowledged = true;
        try {
          await deps.ledger().update(
            () => {},
            entries.map((entry) => binCloseEffect(entry, deps.incarnation)),
          );
        } catch (error) {
          // Refused before it was sent: known not to be recorded.
          if (error instanceof StorageWriteRejected)
            throw new BinCloseNotRecorded(error.message);
          // Otherwise the write may have committed: find out by reading.
          acknowledged = false;
          deps.log(`Bin close record unconfirmed: ${String(error)}`);
        }
        for (const entry of entries) unconfirmed.add(entry.id);
        await confirm();
        if (stopped) return;
        // Only these connections gained work; an unconfirmed write is found
        // by the same full discovery a start uses.
        if (acknowledged)
          for (const id of new Set(entries.map((entry) => entry.connection_id)))
            void runner(id)?.wake();
        else void discover();
        report();
      })();
      commits.add(work);
      try {
        await work;
      } finally {
        commits.delete(work);
      }
    },
    /**
     * Resume closes: at start for intents an earlier run left, and when a
     * host becomes ready. Lanes are found from storage, not from what this
     * run happened to open.
     */
    async wake(connectionId?: string) {
      if (stopped) return;
      const lane = connectionId ? runners.get(connectionId) : undefined;
      if (lane) return void lane.wake();
      // At start, or a host without a lane yet: look in storage.
      await discover();
    },
    async stop() {
      retry?.cancel();
      // Revoke first: every guard reads `stopped`, and each lane stops
      // claiming at once; then drain the commits and the lanes.
      stopped = true;
      const lanes = [...runners.values()].map((lane) => lane.stop());
      await Promise.allSettled([...commits]);
      await Promise.all(lanes);
    },
  };
}
