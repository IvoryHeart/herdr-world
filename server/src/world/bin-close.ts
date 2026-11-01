import type { BinEntry, BinOutcome } from "../../../shared/bin";
import { createEffectRunner, type EffectDriver } from "../effects/runner";
import type { EffectEntry, EffectStore } from "../effects/types";
import type {
  AttentionOutbox,
  OutboxEffect,
  StoragePorts,
} from "../storage/world-protocol";
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
  moved: "It had already closed or moved, so nothing was sent.",
} as const;
const GONE_REASONS = new Set<string>(Object.values(GONE));
const WORKTREE_ROOT =
  "A worktree root's pane closes only with its workspace; close its other panes first.";

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

/** What the intent captured when the countdown ended. */
function captured(entry: EffectEntry) {
  const contract = entry.contract;
  const target = contract?.targets[0];
  const params = contract?.params as
    | {
        bin_id?: string;
        workspace_id?: string;
        tab_id?: string;
        connection_generation?: number;
      }
    | undefined;
  if (
    !target ||
    !("native_id" in target) ||
    !target.evidence.terminal_id ||
    typeof params?.workspace_id !== "string" ||
    typeof params.tab_id !== "string" ||
    typeof params.bin_id !== "string" ||
    !Number.isSafeInteger(params.connection_generation)
  )
    return null;
  return {
    bin_id: params.bin_id,
    connection_id: target.connection_id,
    generation: params.connection_generation!,
    workspace_id: params.workspace_id,
    tab_id: params.tab_id,
    pane_id: target.native_id,
    terminal_id: target.evidence.terminal_id,
  };
}

/** The durable intent for one entry whose countdown ended. */
export function binCloseEffect(entry: BinEntry): OutboxEffect {
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
        workspace_id: entry.workspace_id,
        tab_id: entry.tab_id,
        connection_generation: entry.connection_generation,
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
 * the runtime generation and terminal captured when the countdown ended.
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
      const lease = deps.lease(target.connection_id);
      if (!lease || !lease.isCurrent())
        return {
          state: "unresolved",
          reason: "Its host is not connected; the close waits.",
        };
      if (lease.generation !== target.generation)
        return { state: "ended", reason: GONE.restarted };
      // After a possible dispatch only the decisive read in reconcile decides.
      if (!entry.ever_dispatched) {
        const pane = (await readPanes(lease, target.workspace_id)).find(
          (item) => item.pane_id === target.pane_id,
        );
        if (
          !pane ||
          pane.terminal_id !== target.terminal_id ||
          pane.tab_id !== target.tab_id
        )
          return { state: "ended", reason: GONE.moved };
      }
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
        target &&
          targets.length === 1 &&
          targets[0]!.fence.generation === target.generation &&
          current(target.connection_id, target.generation),
      );
    },
    async invoke(entry, context) {
      const target = captured(entry)!;
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
  let stopped = false;

  const runner = (connectionId: string) => {
    let lane = runners.get(connectionId);
    if (!lane) {
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
        select: (entry) =>
          entry.contract?.targets[0]?.connection_id === connectionId,
        driver: (verb) => (verb === BIN_CLOSE_VERB ? driver : undefined),
        changed: () => queueMicrotask(report),
        log: (error) => deps.log(`Bin close failed: ${String(error)}`),
      });
      runners.set(connectionId, lane);
    }
    return lane;
  };

  function report() {
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
    /** Record one durable intent per entry, then start their dispatch. */
    async commit(entries: readonly BinEntry[]) {
      if (stopped) throw new Error("World is stopping");
      await deps.ledger().update(() => {}, entries.map(binCloseEffect));
      for (const entry of entries) {
        const effect = (await deps.outbox().forRecord(entry.id)).find(
          (item) => item.kind === BIN_CLOSE_VERB,
        );
        if (effect) watched.set(entry.id, effect.id);
      }
      for (const id of new Set(entries.map((entry) => entry.connection_id)))
        void runner(id).wake();
      report();
    },
    /** Resume intents left by an earlier run, and wake a reconnected host's lane. */
    async wake(connectionId?: string) {
      if (stopped) return;
      // A host only has closes to resume if a lane was opened for it: at
      // commit, or at start for intents an earlier run left.
      if (connectionId) return void runners.get(connectionId)?.wake();
      for (const entry of await deps.effects().list(BIN_CLOSE_VERB)) {
        const id = entry.contract?.targets[0]?.connection_id;
        if (id) void runner(id).wake();
      }
    },
    async stop() {
      stopped = true;
      await Promise.all([...runners.values()].map((lane) => lane.stop()));
    },
  };
}
