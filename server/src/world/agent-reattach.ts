import { cardKey, tabCardKey } from "../../../shared/terminalColor";
import type { AgentAddress } from "../../../shared/agentMove";
import type { BoardStorePort } from "./board-types";
import type { WorldSnapshotResult } from "./snapshot";
import { planBoardPatch } from "./board-plan";

/** Manual, explicit recovery for an agent already resumed outside World. No processes are started. */
export async function reattachAgent(
  deps: {
    board: Pick<BoardStorePort, "get" | "patch">;
    snapshot(): Promise<WorldSnapshotResult>;
    publishBoard(revision: number): void;
    current(connectionId: string, generation: number): boolean;
  },
  params: Record<string, unknown>,
) {
  const text = (key: string) => {
    const value = params[key];
    if (
      typeof value !== "string" ||
      !value ||
      value.length > 256 ||
      /[\r\n\0]/.test(value)
    )
      throw new Error(`Re-attach needs ${key}.`);
    return value;
  };
  const connectionId = text("to_connection"),
    paneId = text("to_pane");
  const oldConnection = text("from_connection"),
    oldTab = text("from_tab");
  const document = deps.board.get();
  const oldAppearance = Object.values(document.appearance ?? {}).find(
    (a) =>
      a.connection_id === oldConnection &&
      a.kind === "tab" &&
      a.native_id === oldTab,
  );
  const witnesses = [
    ...new Set([
      ...(oldAppearance?.witness ?? []),
      ...document.strings.flatMap((s) =>
        [s.from, s.to].flatMap((end) =>
          "anchor" in end &&
          end.anchor.connection_id === oldConnection &&
          end.anchor.kind === "tab" &&
          end.anchor.native_id === oldTab
            ? end.anchor.witness
            : [],
        ),
      ),
    ]),
  ];
  if (params.from_terminal === undefined && witnesses.length > 1)
    throw new Error(
      "The old desk has several terminal witnesses. Add --from-terminal ID to choose one.",
    );
  const oldTerminal =
    params.from_terminal === undefined
      ? (witnesses[0] ?? `old-desk:${oldTab}`)
      : text("from_terminal");
  const snapshot = await deps.snapshot();
  const host = snapshot.connections.find(
    (c) => c.connection_id === connectionId,
  );
  if (
    !host?.actionable ||
    host.stale ||
    host.snapshot_generation !== host.generation ||
    !host.snapshot
  )
    throw new Error("The destination runtime is not connected.");
  const pane = host.snapshot.panes.find((p) => p.pane_id === paneId);
  if (!pane || !["claude", "codex"].includes(String(pane.agent)))
    throw new Error("Choose a running Claude or Codex agent.");
  if (
    snapshot.connections.some(
      (c) =>
        c.connection_id === oldConnection &&
        c.actionable &&
        !c.stale &&
        c.snapshot?.panes.some((p) => p.terminal_id === oldTerminal),
    )
  )
    throw new Error(
      "The old terminal is still running. Close it before re-attaching its details.",
    );
  if (
    !oldAppearance?.witness.includes(oldTerminal) &&
    snapshot.connections.some(
      (c) =>
        c.connection_id === oldConnection &&
        c.actionable &&
        !c.stale &&
        c.snapshot?.panes.some((p) => p.tab_id === oldTab),
    )
  )
    throw new Error(
      "The old desk is occupied by another terminal. Its choices will not be transferred.",
    );
  const oldPane = Object.values(document.appearance ?? {}).find(
    (a) =>
      a.connection_id === oldConnection &&
      a.kind === "pane" &&
      a.witness.includes(oldTerminal),
  );
  if (
    params.from_terminal === undefined &&
    !witnesses.length &&
    snapshot.connections.some(
      (c) =>
        c.connection_id === oldConnection &&
        c.actionable &&
        !c.stale &&
        c.snapshot?.panes.some((p) => p.tab_id === oldTab),
    )
  )
    throw new Error(
      "The old desk is still occupied. Add its original --from-terminal ID to avoid moving another occupant's details.",
    );
  const from: AgentAddress = {
    connection_id: oldConnection,
    generation: 0,
    workspace_id: "previous",
    tab_id: oldTab,
    pane_id: oldPane?.native_id ?? String(params.from_pane ?? oldTerminal),
    terminal_id: oldTerminal,
    color_key:
      oldAppearance?.color_key ??
      [
        cardKey(oldConnection, oldTab),
        cardKey(oldConnection, `tab:${oldTab}`),
      ].find(
        (key) =>
          document.layout.colors[key] ||
          document.layout.pinned[key] ||
          document.layout.desk_pins[key],
      ) ??
      cardKey(oldConnection, oldTab),
  };
  if (
    !oldAppearance &&
    !oldPane &&
    !document.layout.colors[from.color_key] &&
    !document.layout.pinned[from.color_key] &&
    !document.layout.desk_pins[from.color_key] &&
    !document.strings.some((s) =>
      [s.from, s.to].some(
        (end) =>
          "anchor" in end &&
          end.anchor.connection_id === oldConnection &&
          end.anchor.witness.includes(oldTerminal),
      ),
    ) &&
    !document.relations.spawns.some((s) =>
      [s.parent, s.child].some(
        (ref) =>
          ref.connection_id === oldConnection &&
          ref.terminal_id === oldTerminal,
      ),
    )
  )
    throw new Error(
      "No saved details remain for that old desk. Deleted historical settings cannot be recovered.",
    );
  const to: AgentAddress = {
    connection_id: connectionId,
    generation: host.generation,
    workspace_id: String(pane.workspace_id),
    tab_id: String(pane.tab_id),
    pane_id: paneId,
    terminal_id: String(pane.terminal_id),
    color_key: tabCardKey(
      connectionId,
      String(pane.tab_id),
      new Set(host.snapshot.workspaces.map((w) => String(w.workspace_id))),
    ),
  };
  const next = await deps.board.patch(
    planBoardPatch([from, to], () => {
      if (!deps.current(connectionId, host.generation))
        throw new Error("The destination runtime changed before re-attach.");
      return [{ op: "agent.rehome", from, to }];
    }),
  );
  deps.publishBoard(next.revision);
  return {
    status: "reattached",
    target: to,
    message:
      "Re-attached the old desk's remaining saved pins, colours and links to this agent.",
  };
}

export function reattachFromCli(
  deps: import("./world-cli").WorldCliDeps,
  params: Record<string, unknown>,
) {
  return reattachAgent(
    {
      board: deps.board,
      snapshot: () => deps.snapshot(),
      publishBoard: (revision) => deps.publishBoard(revision),
      current:
        deps.runtimeCurrent ??
        ((id, generation) =>
          deps
            .hosts()
            .some(
              (host) =>
                host.connection_id === id && host.generation === generation,
            ) ||
          Boolean(
            deps
              .core?.()
              ?.hosts()
              .some(
                (host) =>
                  host.connection_id === id &&
                  host.generation === generation &&
                  host.isCurrent(),
              ),
          )),
    },
    params,
  );
}
