import type { ReadyRuntimeLease } from "../connections/manager";
import { createMoveQueue, type MoveOutcome } from "../world/desk-move";
import { CoreFenceError, CoreOperationFence } from "./fence";
import {
  CORE_TOPOLOGY_LIMITS,
  type CoreTopologyPort,
  type CoreTopologyTab,
} from "./layout";
import { CoreOperationRefused, newCoreLayoutId } from "./operations";
import type { CoreConnectionRuntime } from "./runtime";
import {
  coreRoomOfWorkspace,
  coreRoomWorkspaceId,
  coreTopology,
  CORE_MAIN_ROOM,
} from "./topology";

type Lease = ReadyRuntimeLease<CoreConnectionRuntime>;
export type CoreMoveRequest = {
  kind: "desk" | "pane";
  tab_id: string;
  pane_id?: string;
  workspace_id?: string;
};

// Profiles can reach the same core. Serialize by durable core, not profile,
// while every queued request retains its original lease and generation.
const queues = new WeakMap<
  CoreTopologyPort,
  Map<string, ReturnType<typeof createMoveQueue>>
>();
const refused = (
  message: string,
  reason: "not_found" | "unsupported" | "stale" = "not_found",
): MoveOutcome => ({ status: "refused", reason, message });

export async function moveCore(
  lease: Lease,
  topology: CoreTopologyPort,
  request: CoreMoveRequest,
): Promise<MoveOutcome> {
  const coreId = lease.runtime.core.epoch?.coreId;
  if (!coreId)
    return refused("The host's herdr-core is not connected.", "stale");
  let byCore = queues.get(topology);
  if (!byCore) queues.set(topology, (byCore = new Map()));
  let queue = byCore.get(coreId);
  if (!queue) byCore.set(coreId, (queue = createMoveQueue()));
  return queue(() => performMove(lease, topology, coreId, request));
}

async function performMove(
  lease: Lease,
  topology: CoreTopologyPort,
  coreId: string,
  request: CoreMoveRequest,
): Promise<MoveOutcome> {
  const runtime = lease.runtime;
  const rows = () =>
    coreTopology(runtime.core.mirror.terminals(), runtime.identity.label, {
      world: topology.get(coreId),
    });
  let dispatched = false;
  try {
    const host = CoreOperationFence.admit(lease);
    if (runtime.core.epoch?.coreId !== coreId)
      return refused("The core changed while the move was waiting.", "stale");
    if (!runtime.offers("terminal.label"))
      return refused(
        "This herdr-core does not offer terminal.label, which is required to move agents.",
        "unsupported",
      );
    const before = rows();
    const sourcePane =
      request.kind === "pane"
        ? before.panes.find((p) => p.pane_id === request.pane_id)
        : null;
    const source = before.tabs.find(
      (t) =>
        t.tab_id ===
        (request.kind === "pane" ? sourcePane?.tab_id : request.tab_id),
    );
    const target =
      request.kind === "pane"
        ? before.tabs.find((t) => t.tab_id === request.tab_id)
        : null;
    const roomId =
      request.kind === "pane" ? target?.workspace_id : request.workspace_id;
    const room = before.workspaces.find((w) => w.workspace_id === roomId);
    if (!source || !room || (request.kind === "pane" && !target))
      return refused(
        "The agent, desk or destination room is no longer there. Look again.",
      );
    if (request.kind === "pane" && source.tab_id === target!.tab_id)
      return refused("The agent is already at that desk.");
    if (request.kind === "desk" && source.workspace_id === room.workspace_id)
      return refused("The desk is already in that room.");
    const selected = before.panes.filter((p) =>
      request.kind === "pane"
        ? p.pane_id === request.pane_id
        : p.tab_id === source.tab_id,
    );
    const addresses = new Set(selected.map((p) => String(p.pane_id)));
    const fences = selected.map((p) =>
      CoreOperationFence.admit(lease, String(p.pane_id), null, {
        foreground: false,
      }),
    );
    const anchors = target
      ? before.panes.filter((p) => p.tab_id === target.tab_id)
      : [];
    const targetFences = anchors.map((p) =>
      CoreOperationFence.admit(lease, String(p.pane_id), null, {
        foreground: false,
      }),
    );
    const doc = topology.get(coreId);
    const destination = coreRoomOfWorkspace(doc, String(room.workspace_id));
    if (!destination) return refused("The destination room no longer exists.");
    const savedRoom = doc.rooms.find(
      (r) => coreRoomWorkspaceId(r) === room.workspace_id,
    );
    const savedTab =
      target &&
      savedRoom?.tabs.find(
        (t) => `${room.workspace_id}:tab:world-${t.id}` === target.tab_id,
      );
    // Ordinary app tabs keep their app IDs. World tabs and a new desk use
    // World's topology too; removing the old override is part of every move.
    const appTab = target && destination.kind === "app" && !savedTab;
    const tab: CoreTopologyTab = savedTab ?? {
      id: newCoreLayoutId("b"),
      label: String(target?.label ?? source.label ?? "Desk").slice(
        0,
        CORE_TOPOLOGY_LIMITS.label,
      ),
      terminals: anchors.map((p) => String(p.pane_id)),
    };
    const targetTabId = appTab
      ? String(target.tab_id)
      : `${room.workspace_id}:tab:world-${tab.id}`;
    const space =
      destination.kind === "app"
        ? destination.space
        : `world-${destination.kind === "main" ? CORE_MAIN_ROOM : destination.room.id}`;
    const labels = {
      "herdr.space": space,
      "herdr.tab": appTab
        ? String(target.tab_id).slice(`${room.workspace_id}:tab:`.length)
        : `world-${tab.id}`,
      where: `${room.label || "Room"} / ${tab.label}`.slice(0, 203),
    };
    const check = () => {
      host.check("dispatch");
      for (const fence of [...fences, ...targetFences])
        fence.check("dispatch", "program");
      if (target && !rows().tabs.some((t) => t.tab_id === target.tab_id))
        throw new CoreOperationRefused(
          "The destination desk changed during the move.",
        );
    };
    if (!appTab) {
      if (!savedRoom && doc.rooms.length >= CORE_TOPOLOGY_LIMITS.rooms)
        return refused("World's layout has too many rooms.", "unsupported");
      if (
        !savedTab &&
        doc.rooms.reduce((n, r) => n + r.tabs.length, 0) >=
          CORE_TOPOLOGY_LIMITS.tabs
      )
        return refused("World's layout has too many desks.", "unsupported");
      const placed = new Set(
        doc.rooms.flatMap((r) => r.tabs.flatMap((t) => t.terminals)),
      );
      for (const a of [...addresses, ...anchors.map((p) => String(p.pane_id))])
        placed.add(a);
      if (placed.size > CORE_TOPOLOGY_LIMITS.terminals)
        return refused(
          "World's layout has too many placed terminals.",
          "unsupported",
        );
    }
    // A child without placement inherits its parent's desk. Detach the
    // remaining children from that inheritance before moving their parent,
    // so a one-agent drag never carries an unselected agent along with it.
    const followers = before.panes.filter((p) => {
      if (p.tab_id !== source.tab_id || addresses.has(String(p.pane_id)))
        return false;
      let record = runtime.core.terminal(String(p.pane_id));
      for (let depth = 0; record && depth < 32; depth++) {
        if (record.labels?.["herdr.space"]) return false;
        if (typeof record.parent !== "string") return false;
        if (addresses.has(record.parent)) return true;
        record = runtime.core.terminal(record.parent);
      }
      return false;
    });
    if (followers.length) {
      const followerFences = followers.map((p) =>
        CoreOperationFence.admit(lease, String(p.pane_id), null, {
          foreground: false,
        }),
      );
      const sourceRoom = doc.rooms.find(
        (r) => coreRoomWorkspaceId(r) === source.workspace_id,
      );
      const sourceTab = sourceRoom?.tabs.find(
        (t) => `${source.workspace_id}:tab:world-${t.id}` === source.tab_id,
      );
      if (sourceTab || source.workspace_id === "hc:unplaced") {
        await topology.update(coreId, (current) => {
          check();
          const next = structuredClone(current);
          let r = next.rooms.find(
            (r) => coreRoomWorkspaceId(r) === source.workspace_id,
          );
          if (!r)
            next.rooms.push((r = { id: CORE_MAIN_ROOM, label: "", tabs: [] }));
          let t = sourceTab
            ? r.tabs.find((t) => t.id === sourceTab.id)
            : undefined;
          if (!t)
            r.tabs.push(
              (t = {
                id: newCoreLayoutId("b"),
                label: String(source.label).slice(0, 100),
                terminals: [],
              }),
            );
          for (const fence of followerFences)
            fence.check("publication", "program");
          const staying = before.panes.filter(
            (p) =>
              p.tab_id === source.tab_id && !addresses.has(String(p.pane_id)),
          );
          for (const p of staying)
            if (!t.terminals.includes(String(p.pane_id)))
              t.terminals.push(String(p.pane_id));
          return next;
        });
        runtime.layoutChanged();
      } else {
        for (const fence of followerFences) {
          check();
          dispatched = true;
          await runtime.label(fence, {
            "herdr.space": String(source.workspace_id).slice(
              "hc:space:".length,
            ),
            "herdr.tab": String(source.tab_id).slice(
              `${source.workspace_id}:tab:`.length,
            ),
            where:
              `${before.workspaces.find((w) => w.workspace_id === source.workspace_id)?.label} / ${source.label}`.slice(
                0,
                203,
              ),
          });
        }
      }
    }
    for (const fence of fences) {
      check();
      dispatched = true;
      // One patch per terminal preserves seen, pin, summary and all other labels.
      await runtime.label(fence, labels);
      await topology.update(coreId, (current) => {
        host.check("publication");
        fence.check("publication", "program");
        const next = structuredClone(current);
        const address = fence.occupant!.address;
        for (const r of next.rooms)
          for (const t of r.tabs)
            t.terminals = t.terminals.filter((a) => a !== address);
        if (!appTab) {
          let r = next.rooms.find(
            (r) => coreRoomWorkspaceId(r) === room.workspace_id,
          );
          if (!r) {
            r =
              destination.kind === "app"
                ? {
                    id: newCoreLayoutId("r"),
                    app_space: destination.space,
                    label: "",
                    tabs: [],
                  }
                : { id: CORE_MAIN_ROOM, label: "", tabs: [] };
            if (destination.kind === "world")
              throw new CoreOperationRefused(
                "The destination room was closed during the move.",
              );
            next.rooms.push(r);
          }
          let t = r.tabs.find((t) => t.id === tab.id);
          if (!t) r.tabs.push((t = structuredClone(tab)));
          if (!t.terminals.includes(address)) t.terminals.push(address);
        }
        for (const r of next.rooms)
          r.tabs = r.tabs.filter((t) => t.terminals.length > 0);
        next.rooms = next.rooms.filter(
          (r) => !r.app_space || r.tabs.length > 0,
        );
        return next;
      });
      runtime.layoutChanged();
    }
    const after = rows();
    if (
      !selected.every((p) =>
        after.panes.some(
          (a) => a.pane_id === p.pane_id && a.tab_id === targetTabId,
        ),
      )
    )
      throw new Error(
        "herdr-core has not confirmed the new placement. Check both desks before retrying.",
      );
    return {
      status: "moved",
      tab_id: targetTabId,
      workspace_id: String(room.workspace_id),
      source_workspace_id: String(source.workspace_id),
      panes: [...addresses].map((a) => ({ previous: a, current: a })),
    };
  } catch (error) {
    const message =
      error instanceof CoreFenceError
        ? "The host or one of the programs changed during the move. Look again before retrying."
        : error instanceof Error
          ? error.message
          : String(error);
    if (!dispatched)
      return refused(
        message,
        error instanceof CoreFenceError ? "stale" : "not_found",
      );
    // Never replay an uncertain label write or roll back over another client's
    // edits. Confirmed terminals remain placed; report uncertainty explicitly.
    return {
      status: "failed",
      message,
      rolled_back: false,
      topology_known: false,
      topology: [],
    };
  }
}
