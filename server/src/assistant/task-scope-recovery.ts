import type {
  AssistantWorkspace,
  AssistantWorkspaceRef,
} from "../../../shared/assistant";
import type { AssistantContext, RecoveryTarget } from "./context";
import type { PreparedTask } from "./tasks";
import { refKey } from "./assistant-state";
export function createTaskRecovery(
  context: AssistantContext,
  inventory: () => Awaited<ReturnType<AssistantContext["catalog"]>> | undefined,
  workspaceAllowed: (ref: AssistantWorkspaceRef) => boolean,
  workspaceRemoved: (ref: AssistantWorkspaceRef) => boolean,
) {
  /** A task's workspace as named when the task was saved. */
  function savedName(prepared: PreparedTask, ref: AssistantWorkspaceRef) {
    const saved = prepared.workspaces.find(
      (item) => refKey(item) === refKey(ref),
    );
    return `${saved?.connection_label || ref.connection_id} / ${saved?.label || ref.workspace_id}`;
  }
  function namedList(names: string[]) {
    const shown = names.slice(0, 20);
    return names.length > shown.length
      ? `${shown.join(", ")} and ${names.length - shown.length} more`
      : shown.join(", ");
  }
  /** The task targets Ranger may not use now, named and with why. */
  function refusedTargets(prepared: PreparedTask) {
    const refused = prepared.targets.filter(
      (target) => !workspaceAllowed(target),
    );
    return refused.length
      ? namedList(
          refused.map(
            (target) =>
              `${savedName(prepared, target)} (${workspaceRemoved(target) ? "closed" : "no longer allowed"})`,
          ),
        )
      : undefined;
  }
  /**
   * Why a task's workspace is gone: its connection was removed, or it was
   * closed, perhaps then opened again (same name and checkout) under a new
   * id. That one is not used in its place: the task was granted the old one.
   */
  async function goneReason(
    prepared: PreparedTask,
    target: RecoveryTarget,
    signal?: AbortSignal,
  ) {
    if (
      inventory()?.connection_ids !== undefined &&
      !inventory()!.connection_ids!.includes(target.connection_id)
    )
      return "connection removed";
    const label = prepared.workspaces.find(
      (item) => refKey(item) === refKey(target),
    )?.label;
    const held = new Set(prepared.targets.map(refKey));
    const candidates = (inventory()?.workspaces ?? []).filter(
      (item) =>
        item.connection_id === target.connection_id &&
        item.label === label &&
        !held.has(refKey(item)) &&
        workspaceAllowed(item),
    );
    for (const candidate of candidates.slice(0, 5)) {
      try {
        const captured = await context.captureScope([candidate], signal);
        const [found] = (await context.recoveryScope?.(captured, signal)) ?? [];
        if (found?.workspace_identity === target.workspace_identity)
          return `recreated as ${candidate.workspace_id}`;
      } catch {
        signal?.throwIfAborted();
      }
    }
    return "closed";
  }
  /**
   * The task targets on connections whose Herdr restarted since they were
   * checked, checked again for a new run: each is found again by its id,
   * with the current server identity, when that id still holds the same
   * workspace (path and checkout). One whose id now holds another workspace
   * is not used: Herdr offers no identity of its own that would find the
   * granted one elsewhere (workspaces outside a checkout all look alike).
   * Each target is compared with the server of now, not only the first: a
   * task keeps a skipped one under the identity it was checked with, so one
   * connection's targets can carry two. A connection that cannot be read
   * now is left as saved, for validation to refuse or wait on as before.
   */
  async function reidentify(targets: RecoveryTarget[], signal?: AbortSignal) {
    const refreshed = new Map<
      string,
      { target: RecoveryTarget; workspace: AssistantWorkspace }
    >();
    const changed: { target: RecoveryTarget; why: string }[] = [];
    const restarted: string[] = [];
    if (!context.recoveryScope) return { refreshed, changed, restarted };
    const byConnection = new Map<string, RecoveryTarget[]>();
    for (const target of targets)
      byConnection.set(target.connection_id, [
        ...(byConnection.get(target.connection_id) ?? []),
        target,
      ]);
    const check = async (stale: RecoveryTarget[]) => {
      const captured = await context.captureScope(stale, signal);
      const fresh = await context.recoveryScope!(captured, signal);
      if (fresh.length !== stale.length)
        throw new Error("Unchecked workspace identity");
      return { captured, fresh };
    };
    for (const [connectionId, saved] of byConnection) {
      let label: string;
      let stale: RecoveryTarget[];
      try {
        // One workspace tells the server identity; most runs stop there.
        const probe = await context.captureScope([saved[0]!], signal);
        label = probe[0]?.connection_label || connectionId;
        const [current] = await context.recoveryScope(probe, signal);
        if (
          !current ||
          current.endpoint_fingerprint !== saved[0]!.endpoint_fingerprint
        )
          continue;
        stale = saved.filter(
          (target) => target.herdr_boot_id !== current.herdr_boot_id,
        );
      } catch {
        signal?.throwIfAborted();
        continue;
      }
      if (!stale.length) continue;
      restarted.push(label);
      const found = (
        target: RecoveryTarget,
        current: RecoveryTarget,
        workspace: AssistantWorkspace,
      ) => {
        if (
          refKey(current) !== refKey(target) ||
          current.workspace_identity !== target.workspace_identity ||
          current.endpoint_fingerprint !== target.endpoint_fingerprint
        )
          changed.push({
            target,
            why: "its id now holds another workspace",
          });
        else refreshed.set(refKey(target), { target: current, workspace });
      };
      try {
        const { captured, fresh } = await check(stale);
        stale.forEach((target, index) =>
          found(target, fresh[index]!, captured[index]!),
        );
      } catch {
        signal?.throwIfAborted();
        // One that cannot be read must not keep the others from the run.
        for (const target of stale)
          try {
            const { captured, fresh } = await check([target]);
            found(target, fresh[0]!, captured[0]!);
          } catch {
            signal?.throwIfAborted();
            changed.push({
              target,
              why: `could not be checked again after Herdr on ${label} restarted`,
            });
          }
      }
    }
    return { refreshed, changed, restarted };
  }

  return { savedName, namedList, refusedTargets, goneReason, reidentify };
}
