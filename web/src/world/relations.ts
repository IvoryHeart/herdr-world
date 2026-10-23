import { useEffect, useMemo, useRef } from "react";
import {
  relationsOf,
  spawnParents,
  terminalKey,
  type Relation,
  type RelationObservation,
  type RelationsDocument,
  type TerminalRef,
} from "../../../shared/relations";
import {
  inheritedColorKey,
  resolveTerminalColor,
  tabCardKey,
  type TerminalTab,
} from "../../../shared/terminalColor";
import {
  sharedBoardStore,
  useBoardDocument,
  type BoardDocumentStore,
} from "./board/boardDocument";
import type { WorldRuntimeConnection } from "./runtimeStore";
import type { WorldObject } from "./worldObject";

/**
 * The browser's side of relations (shared/relations.ts): which terminals know
 * each other, from Board's saved document and World's current snapshots, and
 * where each terminal is now, so the views can draw them together.
 */

export const NO_RELATIONS: RelationsDocument = { spawns: [], groups: [] };

/** A live snapshot of the connection's current runtime, as the service reads it. */
function currentConnection(connection: WorldRuntimeConnection) {
  return (
    connection.state === "ready" &&
    !connection.stale &&
    connection.actionable &&
    connection.snapshot !== null &&
    connection.snapshotGeneration === connection.generation
  );
}

/** Each connection's snapshot as the shared rules read it. */
export function relationObservations(
  connections: readonly WorldRuntimeConnection[],
): RelationObservation[] {
  return connections.map((connection) => ({
    connection_id: connection.connectionId,
    generation: connection.generation,
    current: currentConnection(connection),
    panes: (connection.snapshot?.panes ?? []).map((pane) => ({
      pane_id: pane.pane_id,
      terminal_id: pane.terminal_id,
      tokens: (pane as { tokens?: unknown }).tokens,
    })),
  }));
}

/** Where a terminal is in the latest snapshot (cached ones too). */
export type TerminalPlace = TerminalTab & { paneId: string };

export function terminalPlaces(
  connections: readonly WorldRuntimeConnection[],
): Map<string, TerminalPlace> {
  const places = new Map<string, TerminalPlace>();
  for (const connection of connections) {
    const snapshot = connection.snapshot;
    if (!snapshot) continue;
    const workspaceIds = new Set(
      snapshot.workspaces.map((workspace) => workspace.workspace_id),
    );
    for (const pane of snapshot.panes)
      places.set(
        terminalKey({
          connection_id: connection.connectionId,
          terminal_id: pane.terminal_id,
        }),
        {
          connectionId: connection.connectionId,
          workspaceId: pane.workspace_id,
          tabId: pane.tab_id,
          paneId: pane.pane_id,
          workspaceIds,
        },
      );
  }
  return places;
}

/**
 * The saved colours plus each spawned tab's inherited one: a tab with no
 * colour of its own shows its parent's tab colour (inheritedColorKey). A
 * chosen colour always wins, and a parent in the same tab adds nothing.
 */
export function withInheritedColors<C extends string>(
  colors: Readonly<Record<string, C>>,
  relations: readonly Relation[],
  places: ReadonlyMap<string, TerminalPlace>,
): Readonly<Record<string, C>> {
  const parentTabs = new Map<string, TerminalPlace>();
  const tabs = new Map<string, TerminalPlace>();
  for (const [child, parent] of spawnParents(relations)) {
    const from = places.get(terminalKey(parent));
    const to = places.get(child);
    if (!from || !to || from.connectionId !== to.connectionId) continue;
    if (from.tabId === to.tabId) continue;
    const key = tabCardKey(to.connectionId, to.tabId, to.workspaceIds);
    if (colors[key] || parentTabs.has(key)) continue;
    parentTabs.set(key, from);
    tabs.set(key, to);
  }
  if (!parentTabs.size) return colors;
  const out: Record<string, C> = { ...colors };
  const resolving = new Set<string>();
  const resolve = (key: string): void => {
    const parent = parentTabs.get(key);
    if (!parent || out[inheritedColorKey(key)] || resolving.has(key)) return;
    resolving.add(key);
    // The parent may itself be spawned: settle its colour first.
    resolve(tabCardKey(parent.connectionId, parent.tabId, parent.workspaceIds));
    out[inheritedColorKey(key)] = resolveTerminalColor(out, parent).color as C;
  };
  for (const key of parentTabs.keys()) resolve(key);
  return out;
}

type Derived = {
  relations: Relation[];
  places: Map<string, TerminalPlace>;
};

/** What relations are derived from: observations and every terminal's place. */
export type RelationInputs = {
  observations: readonly RelationObservation[];
  places: ReadonlyMap<string, TerminalPlace>;
};

/** From World's runtime connections (the app's colour seam). */
export function runtimeRelationInputs(
  connections: readonly WorldRuntimeConnection[],
): RelationInputs {
  return {
    observations: relationObservations(connections),
    places: terminalPlaces(connections),
  };
}

/** From a World object, as a view shows it: its hosts and their panes. */
export function worldRelationInputs(
  world: Pick<WorldObject, "hosts">,
): RelationInputs {
  const observations: RelationObservation[] = [];
  const places = new Map<string, TerminalPlace>();
  for (const host of world.hosts) {
    const workspaceIds = new Set(host.spaces.map((space) => space.nativeId));
    const leaves = host.spaces.flatMap((space) => space.children);
    observations.push({
      connection_id: host.connectionId,
      generation: host.generation,
      current: currentConnection(host.connection),
      panes: leaves.map((leaf) => ({
        pane_id: leaf.nativeId,
        terminal_id: leaf.terminalId,
        tokens: (leaf.pane as { tokens?: unknown } | undefined)?.tokens,
      })),
    });
    for (const leaf of leaves)
      places.set(
        terminalKey({
          connection_id: host.connectionId,
          terminal_id: leaf.terminalId,
        }),
        {
          connectionId: host.connectionId,
          workspaceId: leaf.workspaceId,
          tabId: leaf.tabId,
          paneId: leaf.nativeId,
          workspaceIds,
        },
      );
  }
  return { observations, places };
}

/**
 * Relations and the places of related terminals. The result is replaced only
 * when a relation, its evidence or a related terminal's place changes, so a
 * snapshot or a note edit that changes neither re-renders nothing.
 */
export function relationsDeriver() {
  let lastDoc: RelationsDocument | undefined;
  let lastInputs: RelationInputs | undefined;
  let lastSignature = "";
  let last: Derived = { relations: [], places: new Map() };
  return (doc: RelationsDocument, inputs: RelationInputs): Derived => {
    if (doc === lastDoc && inputs === lastInputs) return last;
    lastDoc = doc;
    lastInputs = inputs;
    const relations = relationsOf(doc, inputs.observations);
    const places = new Map<string, TerminalPlace>();
    for (const relation of relations)
      for (const end of [relation.a, relation.b]) {
        const key = terminalKey(end);
        const place = inputs.places.get(key);
        if (place) places.set(key, place);
      }
    const signature = JSON.stringify([
      relations.map((relation) => [
        relation.key,
        relation.evidence.map((entry) => [
          entry.kind,
          entry.sor,
          entry.source,
          entry.current,
        ]),
      ]),
      [...places].map(([key, place]) => [
        key,
        place.workspaceId,
        place.tabId,
        place.paneId,
        [...place.workspaceIds].includes(place.tabId),
      ]),
    ]);
    if (signature !== lastSignature) {
      lastSignature = signature;
      last = { relations, places };
    }
    return last;
  };
}

/**
 * Whether there is anything to derive: a pane carries a spawn stamp, or a
 * saved claim or group has two terminals still listed. A view draws a
 * relation, and a child inherits a colour, only between listed terminals, so
 * claims and groups whose agents closed cost nothing while large snapshots
 * refresh.
 */
export function anyRelation(
  relations: RelationsDocument,
  /** Calls `see` for each terminal until it returns true. */
  each: (
    see: (connectionId: string, terminalId: string, tokens: unknown) => boolean,
  ) => void,
): boolean {
  // Only the saved terminals are looked up, by terminal ID, so a large
  // snapshot costs no key per pane.
  const wanted = new Map<string, Set<string>>();
  const want = (ref: TerminalRef) => {
    let connections = wanted.get(ref.terminal_id);
    if (!connections) wanted.set(ref.terminal_id, (connections = new Set()));
    connections.add(ref.connection_id);
  };
  for (const claim of relations.spawns) {
    want(claim.child);
    want(claim.parent);
  }
  for (const group of relations.groups) group.members.forEach(want);
  const listed = new Set<string>();
  let stamped = false;
  each((connectionId, terminalId, tokens) => {
    const stamp = tokens as Record<string, unknown> | undefined;
    if (stamp?.spawned_by || stamp?.spawned_by_terminal)
      return (stamped = true);
    if (wanted.get(terminalId)?.has(connectionId))
      listed.add(
        terminalKey({ connection_id: connectionId, terminal_id: terminalId }),
      );
    return false;
  });
  if (stamped) return true;
  if (!listed.size) return false;
  const has = (ref: TerminalRef) => listed.has(terminalKey(ref));
  return (
    relations.spawns.some((claim) => has(claim.child) && has(claim.parent)) ||
    relations.groups.some((group) => group.members.filter(has).length > 1)
  );
}

/** Relations for a World view, kept current from Board's store. */
export function useRelations(
  world: Pick<WorldObject, "hosts">,
  store: BoardDocumentStore = sharedBoardStore(),
): Derived {
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const { document } = useBoardDocument(store);
  const derive = useRef(relationsDeriver()).current;
  const hosts = world.hosts;
  const relations = document?.relations ?? NO_RELATIONS;
  const anything = useMemo(
    () =>
      anyRelation(relations, (see) => {
        for (const host of hosts)
          for (const space of host.spaces)
            for (const leaf of space.children)
              if (
                see(
                  host.connectionId,
                  leaf.terminalId,
                  (leaf.pane as { tokens?: unknown } | undefined)?.tokens,
                )
              )
                return;
      }),
    [relations, hosts],
  );
  const inputs = useMemo(
    () => (anything ? worldRelationInputs({ hosts }) : null),
    [anything, hosts],
  );
  return inputs ? derive(relations, inputs) : NO_DERIVED;
}

const NO_DERIVED: Derived = { relations: [], places: new Map() };

/** Group the terminals of `members` with those of `target`. */
export function groupTerminals(
  members: readonly TerminalRef[],
  target: readonly TerminalRef[],
  store: BoardDocumentStore = sharedBoardStore(),
) {
  return store.patch([
    {
      op: "group.join",
      id: `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      members: [...members],
      target: [...target],
    },
  ]);
}

/** Take terminals out of their group. */
export function ungroupTerminals(
  members: readonly TerminalRef[],
  store: BoardDocumentStore = sharedBoardStore(),
) {
  return store.patch([{ op: "group.leave", members: [...members] }]);
}
