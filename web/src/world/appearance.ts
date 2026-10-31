import { presentWorldRooms } from "./worldPresentation";
import { useEffect, useRef } from "react";
import {
  appearanceFor,
  appearanceColors,
  type AppearanceTarget,
  type AppearanceFields,
} from "../../../shared/appearance";
import { tabCardKey } from "../../../shared/terminalColor";
import { bridge } from "../api";
import {
  sharedBoardStore,
  useBoardDocument,
  type BoardDocument,
  type BoardDocumentStore,
} from "./board/boardDocument";
import type { WorldRuntimeConnection } from "./runtimeStore";
import type {
  WorldLeafObject,
  WorldObject,
  WorldSpaceObject,
} from "./worldObject";

export function useAppearanceDocument(
  store: BoardDocumentStore = sharedBoardStore(),
) {
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const document = useBoardDocument(store).document;
  const last = useRef<{
    key: string;
    value: Pick<BoardDocument, "appearance">;
  }>({ key: "", value: {} });
  const key = JSON.stringify(document?.appearance ?? {});
  if (last.current.key !== key)
    last.current = { key, value: { appearance: document?.appearance } };
  return last.current.value;
}
export function runtimeAppearanceTargets(
  connections: readonly WorldRuntimeConnection[],
): AppearanceTarget[] {
  return connections.flatMap((connection) => {
    const snapshot = connection.snapshot;
    if (
      !snapshot ||
      !Array.isArray(snapshot.workspaces) ||
      !Array.isArray(snapshot.tabs) ||
      !Array.isArray(snapshot.panes) ||
      connection.stale ||
      !connection.actionable ||
      connection.snapshotGeneration !== connection.generation
    )
      return [];
    const workspaceIds = new Set(
      snapshot.workspaces.map((workspace) => workspace.workspace_id),
    );
    return snapshot.tabs.flatMap((tab): AppearanceTarget[] => {
      const panes = snapshot.panes.filter((pane) => pane.tab_id === tab.tab_id);
      const witness = panes.map((pane) => pane.terminal_id);
      if (!witness.length) return [];
      return [
        {
          connection_id: connection.connectionId,
          kind: "tab",
          native_id: tab.tab_id,
          color_key: tabCardKey(
            connection.connectionId,
            tab.tab_id,
            workspaceIds,
          ),
          witness,
        },
        ...panes.map(
          (pane): AppearanceTarget => ({
            connection_id: connection.connectionId,
            kind: "pane",
            native_id: pane.pane_id,
            witness: [pane.terminal_id],
          }),
        ),
      ];
    });
  });
}
export function visibleAppearanceColors(
  document: BoardDocument | null,
  connections: readonly WorldRuntimeConnection[],
) {
  return document?.appearance
    ? appearanceColors(document, runtimeAppearanceTargets(connections))
    : (document?.layout.colors ?? {});
}
export function leafAppearance(
  document: Pick<BoardDocument, "appearance"> | null,
  leaf: Pick<
    WorldLeafObject,
    | "connectionId"
    | "tabId"
    | "nativeId"
    | "terminalId"
    | "stale"
    | "actionable"
  >,
  tabWitness: readonly string[] = [leaf.terminalId],
) {
  if (!document?.appearance || leaf.stale || !leaf.actionable) return undefined;
  const base = { connection_id: leaf.connectionId, witness: [leaf.terminalId] };
  const tab = appearanceFor(document.appearance, {
    ...base,
    witness: [...tabWitness],
    kind: "tab",
    native_id: leaf.tabId,
  });
  const pane = appearanceFor(document.appearance, {
    ...base,
    kind: "pane",
    native_id: leaf.nativeId,
  });
  return tab?.status || pane?.avatar
    ? { status: tab?.status, avatar: pane?.avatar }
    : undefined;
}
const appearanceRooms = new WeakMap<
  WorldSpaceObject,
  { key: string; room: WorldSpaceObject }
>();
export function worldWithAppearance(
  world: WorldObject,
  document: Pick<BoardDocument, "appearance"> | null,
): WorldObject {
  if (!document?.appearance || !Object.keys(document.appearance).length)
    return world;
  const witnesses = new Map<string, string[]>();
  const keyOf = (leaf: WorldLeafObject) =>
    JSON.stringify([leaf.connectionId, leaf.tabId]);
  for (const leaf of world.leaves) {
    const key = keyOf(leaf);
    const ids = witnesses.get(key) ?? [];
    ids.push(leaf.terminalId);
    witnesses.set(key, ids);
  }
  return presentWorldRooms(world, (space) => {
    const appearances = space.children.map((leaf) =>
      leafAppearance(document, leaf, witnesses.get(keyOf(leaf))),
    );
    if (
      appearances.every(
        (appearance, i) =>
          JSON.stringify(appearance) ===
          JSON.stringify(space.children[i]!.appearance),
      )
    )
      return space;
    const key = JSON.stringify(appearances),
      prior = appearanceRooms.get(space);
    if (prior?.key === key) return prior.room;
    const room = {
      ...space,
      children: space.children.map((leaf, i) => {
        const appearance = appearances[i];
        return JSON.stringify(appearance) === JSON.stringify(leaf.appearance)
          ? leaf
          : { ...leaf, appearance };
      }),
    };
    appearanceRooms.set(space, { key, room });
    return room;
  });
}

export type AppearanceIdentity = AppearanceTarget & {
  connection_generation: number;
};
export async function saveAppearance(
  identity: AppearanceIdentity,
  fields: AppearanceFields,
  store: BoardDocumentStore = sharedBoardStore(),
): Promise<string | null> {
  return store.appearance(identity, fields);
}
export async function renameAppearanceTab(
  identity: AppearanceIdentity,
  label: string,
): Promise<void> {
  await bridge.call("world.appearance.rename", { ...identity, label });
}
