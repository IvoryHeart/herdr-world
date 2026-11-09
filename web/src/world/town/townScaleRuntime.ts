/**
 * The Town scale scene as a page-local runtime, so `?scene=town-scale` can
 * be tried and not only looked at. Its three synthetic hosts answer the
 * calls Town's and Board's actions make: rename, close and reorder rooms,
 * reorder desks, read an asking agent's question, answer it, read an
 * agent's latest message, and keep the reviewed record for finished work.
 *
 * Only a page opened with `?scene=town-scale` creates it. Nothing reaches the
 * World service or Herdr, and a reload starts the scene afresh. Any other
 * call is refused with a plain message, as an unknown host would be.
 */

import { bridge, type BridgeControlMsg } from "../../api";
import type { ConnectionClient } from "../../connectionClient";
import {
  deskKey,
  type DeskIdentity,
  type DeskRecord,
  type DeskState,
} from "../../../../shared/deskState";
import type { Pane, Tab, Workspace } from "../../types";
import type { WorldRuntimeConnection } from "../runtimeStore";
import {
  townScaleConnections,
  townScaleSceneConnection,
  townScaleSceneRequested,
} from "./townScaleScene";

/** How long an answered agent works before it finishes (idle, unreviewed). */
export const SCENE_ANSWER_WORK_MS = 4_000;

const QUESTION = [
  "The tests need the staging copy migrated first.",
  "Allow running the migration?",
  "❯ 1. Yes",
  "  2. Yes, and don't ask again",
  "  3. No, tell the agent what to do",
  "",
  "Esc to cancel",
].join("\n");
const BLOCKED =
  "CI is failing on the lint step after the rule change.\nShould I revert the rule or fix the code?";

/** What an agent last said, by its scene state. */
function latestText(pane: Pane, answered: boolean): string | null {
  if (answered)
    return pane.agent_status === "working"
      ? "Thanks. Running the migration, then the tests."
      : "Migration ran and the tests pass. The change is ready.";
  switch (pane.agent_status) {
    case "working":
      return "Implementing the change: editing the handler and its tests.";
    case "blocked":
      return pane.task_summary?.startsWith("Asks:")
        ? "The tests need the staging copy migrated first. May I run the migration?"
        : "CI is failing on the lint step. I need a decision before I go on.";
    case "done":
      return "Finished: the pull request is ready for review.";
    default:
      return null;
  }
}

/** Herdr inserts before the item at `insertIndex`, counted before removal. */
function herdrInsert(
  order: readonly string[],
  id: string,
  insertIndex: number,
) {
  const from = order.indexOf(id);
  if (from < 0 || insertIndex < 0 || insertIndex > order.length)
    throw new Error("invalid_insert_index");
  const next = order.filter((other) => other !== id);
  next.splice(insertIndex > from ? insertIndex - 1 : insertIndex, 0, id);
  return next;
}

type DeskControlListener = (control: BridgeControlMsg) => void;

export class TownScaleRuntime {
  private connections: WorldRuntimeConnection[];
  private listeners = new Set<() => void>();
  private deskListeners = new Set<DeskControlListener>();
  private desk = new Map<string, DeskRecord>();
  private deskRevision = 1;
  /** Panes answered from the scene: their messages follow the answer. */
  private answered = new Set<string>();
  private messageAt = new Map<string, number>();

  constructor(
    private readonly now = () => Date.now(),
    private readonly answerWorkMs = SCENE_ANSWER_WORK_MS,
  ) {
    this.connections = townScaleConnections();
    const loaded = this.now();
    // Every finished agent has a stop the service saw, so Mark reviewed can
    // name it; each finished a few minutes apart.
    let n = 0;
    for (const connection of this.connections)
      for (const pane of connection.snapshot!.panes)
        if (pane.agent_status === "done")
          this.recordStop(connection, pane, loaded - (++n % 50) * 60_000);
  }

  get = () => this.connections;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /** The scene's client for one of its hosts; null for any other host. */
  client(connectionId: string): ConnectionClient | null {
    if (!townScaleSceneConnection(connectionId)) return null;
    const connection = () =>
      this.connections.find((c) => c.connectionId === connectionId) ?? null;
    const generation = connection()?.generation ?? 1;
    return {
      connectionId,
      generation,
      serverRuntimeGeneration: generation,
      isCurrent: () => connection() !== null,
      acceptsServerGeneration: (value) => value === generation,
      call: async (method, params = {}) =>
        this.call(connectionId, method, params),
    };
  }

  /** The reviewed record, as the service's Desk state client is called. */
  readonly deskClient = {
    call: async (method: string, params: Record<string, unknown> = {}) => {
      if (method === "world.desk.get") return this.deskState();
      if (method === "world.desk.review" || method === "world.desk.open") {
        const key = deskKey(params as DeskIdentity);
        const record = this.desk.get(key);
        if (!record) throw new Error("This scene agent has no stop to review.");
        this.desk.set(
          key,
          method === "world.desk.review"
            ? {
                ...record,
                reviewed_stop:
                  params.reviewed === false ? null : String(params.stop_id),
              }
            : { ...record, opened_at: this.now() },
        );
        this.deskRevision += 1;
        return this.deskState();
      }
      throw new Error(`The scale scene cannot ${method}.`);
    },
    onControl: (listener: DeskControlListener) => {
      this.deskListeners.add(listener);
      return () => void this.deskListeners.delete(listener);
    },
    onStatus: () => () => {},
  };

  private deskState(): DeskState {
    return {
      revision: this.deskRevision,
      records: [...this.desk.values()].map((record) => ({ ...record })),
    };
  }

  private recordStop(
    connection: WorldRuntimeConnection,
    pane: Pane,
    at: number,
  ) {
    const identity: DeskIdentity = {
      connection_id: connection.connectionId,
      connection_generation: connection.generation,
      terminal_id: pane.terminal_id,
      agent_session_fingerprint: null,
    };
    this.desk.set(deskKey(identity), {
      ...identity,
      reviewed_stop: null,
      stopped_at: at,
      observed_stop_id: `scene-stop:${pane.pane_id}:${at}`,
      opened_at: null,
    });
    this.deskRevision += 1;
  }

  private call(
    connectionId: string,
    method: string,
    params: Record<string, unknown>,
  ): unknown {
    const connection = this.connections.find(
      (c) => c.connectionId === connectionId,
    );
    if (!connection?.snapshot) throw new Error("unknown connection");
    const snapshot = connection.snapshot;
    const byNumber = <T extends { number: number }>(items: T[]) =>
      [...items].sort((a, b) => a.number - b.number);
    switch (method) {
      case "workspace.list":
        return { workspaces: byNumber(snapshot.workspaces) };
      case "tab.list":
        return { tabs: byNumber(snapshot.tabs), tab_move_supported: true };
      case "workspace.rename": {
        const label = String(params.label ?? "").trim();
        if (!label) throw new Error("A room needs a name.");
        return this.change(connection, ({ workspaces, tabs, panes }) => ({
          workspaces: workspaces.map((workspace) =>
            workspace.workspace_id === params.workspace_id
              ? { ...workspace, label }
              : workspace,
          ),
          tabs,
          panes,
        }));
      }
      case "workspace.close":
        return this.change(connection, ({ workspaces, tabs, panes }) => {
          const id = params.workspace_id;
          const kept = byNumber(
            workspaces.filter((workspace) => workspace.workspace_id !== id),
          ).map((workspace, index) => ({ ...workspace, number: index + 1 }));
          if (kept.length && !kept.some((workspace) => workspace.focused))
            kept[0] = { ...kept[0]!, focused: true };
          return {
            workspaces: kept,
            tabs: tabs.filter((tab) => tab.workspace_id !== id),
            panes: panes.filter((pane) => pane.workspace_id !== id),
          };
        });
      case "workspace.move":
        return this.change(connection, ({ workspaces, tabs, panes }) => {
          const order = herdrInsert(
            byNumber(workspaces).map((workspace) => workspace.workspace_id),
            String(params.workspace_id),
            Number(params.insert_index),
          );
          return {
            workspaces: workspaces.map((workspace) => ({
              ...workspace,
              number: order.indexOf(workspace.workspace_id) + 1,
            })),
            tabs,
            panes,
          };
        });
      case "tab.move":
        return this.change(connection, ({ workspaces, tabs, panes }) => {
          const moved = tabs.find((tab) => tab.tab_id === params.tab_id);
          if (!moved) throw new Error("unknown tab");
          const order = herdrInsert(
            byNumber(
              tabs.filter((tab) => tab.workspace_id === moved.workspace_id),
            ).map((tab) => tab.tab_id),
            moved.tab_id,
            Number(params.insert_index),
          );
          return {
            workspaces,
            tabs: tabs.map((tab) =>
              tab.workspace_id === moved.workspace_id
                ? { ...tab, number: order.indexOf(tab.tab_id) + 1 }
                : tab,
            ),
            panes,
          };
        });
      case "pane.read": {
        const pane = snapshot.panes.find((p) => p.pane_id === params.pane_id);
        if (!pane) throw new Error("unknown pane");
        const text =
          pane.agent_status !== "blocked"
            ? (latestText(pane, this.answered.has(pane.pane_id)) ?? "")
            : pane.task_summary?.startsWith("Asks:")
              ? QUESTION
              : BLOCKED;
        return { read: { pane_id: pane.pane_id, text } };
      }
      case "pane.send_input": {
        const pane = snapshot.panes.find((p) => p.pane_id === params.pane_id);
        if (!pane) throw new Error("unknown pane");
        if (pane.agent_status !== "blocked") return { ok: true };
        // The answer lands: the agent works a moment, then finishes its
        // turn. Herdr reports a finished turn as idle once seen, so it
        // waits for review as an idle agent with a recent stop.
        this.answered.add(pane.pane_id);
        this.setPane(
          connectionId,
          pane.pane_id,
          "working",
          "Running the migration",
        );
        setTimeout(() => {
          const current = this.connections.find(
            (c) => c.connectionId === connectionId,
          );
          const now = current?.snapshot?.panes.find(
            (p) => p.pane_id === pane.pane_id,
          );
          if (!current || !now || now.agent_status !== "working") return;
          this.setPane(connectionId, pane.pane_id, "idle", undefined);
          this.recordStop(current, now, this.now());
          for (const listener of [...this.deskListeners])
            listener({ type: "world_desk_changed" } as BridgeControlMsg);
        }, this.answerWorkMs);
        return { ok: true };
      }
      case "agent_conversation.watch":
      case "agent_conversation.unwatch":
        return { ok: true };
      case "agent_conversation.latest": {
        const pane = snapshot.panes.find((p) => p.pane_id === params.pane_id);
        if (!pane) throw new Error("unknown pane");
        const answered = this.answered.has(pane.pane_id);
        const text = latestText(pane, answered);
        const at =
          this.messageAt.get(pane.pane_id) ??
          this.now() - ((pane.pane_id.length * 7) % 40) * 60_000;
        return {
          conversation_version: 1,
          pane_id: pane.pane_id,
          agent: pane.agent || null,
          agent_status: pane.agent_status,
          session_binding: null,
          session_fingerprint: null,
          session_label: null,
          status: "ok",
          unavailable: null,
          latest: text
            ? {
                id: `${pane.pane_id}:${pane.agent_status}:${answered}`,
                role: "assistant",
                kind: "message",
                text,
                sent_at: new Date(at).toISOString(),
              }
            : null,
        };
      }
      default:
        throw new Error(`The scale scene's synthetic hosts cannot ${method}.`);
    }
  }

  private setPane(
    connectionId: string,
    paneId: string,
    status: string,
    summary: string | undefined,
  ) {
    this.messageAt.set(paneId, this.now());
    const connection = this.connections.find(
      (c) => c.connectionId === connectionId,
    )!;
    this.change(connection, ({ workspaces, tabs, panes }) => {
      const next = panes.map((pane) =>
        pane.pane_id === paneId
          ? {
              ...pane,
              agent_status: status,
              task_summary: summary,
              revision: pane.revision + 1,
            }
          : pane,
      );
      const tabId = next.find((pane) => pane.pane_id === paneId)?.tab_id;
      return {
        workspaces,
        tabs: tabs.map((tab) => {
          if (tab.tab_id !== tabId) return tab;
          const statuses = next
            .filter((pane) => pane.tab_id === tabId && pane.agent)
            .map((pane) => pane.agent_status);
          return {
            ...tab,
            agent_status: statuses.includes("working")
              ? "working"
              : (statuses[0] ?? tab.agent_status),
          };
        }),
        panes: next,
      };
    });
  }

  /** Replace one host's snapshot and tell the page. */
  private change(
    connection: WorldRuntimeConnection,
    next: (snapshot: {
      workspaces: Workspace[];
      tabs: Tab[];
      panes: Pane[];
    }) => { workspaces: Workspace[]; tabs: Tab[]; panes: Pane[] },
  ) {
    const snapshot = connection.snapshot!;
    const changed = next(snapshot);
    const workspaces = changed.workspaces.map((workspace) => ({
      ...workspace,
      tab_count: changed.tabs.filter(
        (tab) => tab.workspace_id === workspace.workspace_id,
      ).length,
    }));
    this.connections = this.connections.map((c) =>
      c === connection
        ? {
            ...c,
            snapshotGeneration: (c.snapshotGeneration ?? 0) + 1,
            snapshot: { ...snapshot, ...changed, workspaces },
          }
        : c,
    );
    for (const listener of [...this.listeners]) listener();
    return { ok: true };
  }
}

let runtime: TownScaleRuntime | null | undefined;

/**
 * The scene's runtime on a page opened with `?scene=town-scale`, created on
 * first use and kept for the page; null on any other page. Creating it lets
 * the bridge serve the scene's hosts from it.
 */
export function townScaleRuntime(): TownScaleRuntime | null {
  if (runtime !== undefined) return runtime;
  runtime =
    typeof window !== "undefined" &&
    townScaleSceneRequested(window.location.search)
      ? new TownScaleRuntime()
      : null;
  if (runtime) {
    const scene = runtime;
    bridge.synthetic = (id) => scene.client(id);
  }
  return runtime;
}
