import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import type { TabColorControl } from "../components/TabBar";
import {
  sharedBoardStore,
  type BoardDocumentStore,
} from "./board/boardDocument";
import {
  resolveTerminal,
  TERMINAL_COLOR_PALETTE,
  TERMINAL_COLORS,
  terminalColorKey,
  type TerminalColor,
  type TerminalColors,
  type TerminalColorTarget,
} from "./terminalColor";
import {
  anyRelation,
  NO_RELATIONS,
  relationsDeriver,
  runtimeRelationInputs,
  withInheritedColors,
} from "./relations";
import type { RelationsDocument } from "../../../shared/relations";
import { worldRuntimeStore } from "./runtimeStore";
import type { WorldObject } from "./worldObject";

/** Terminal colours as World's service keeps them (see terminalColor.ts). */

const NONE: TerminalColors = Object.freeze({});

type Connections = ReturnType<typeof worldRuntimeStore.get>["connections"];

/** Whether a child can inherit: a stamp, or a claim between listed terminals. */
export function mayInherit(
  relations: RelationsDocument,
  connections: Connections,
) {
  return anyRelation(
    { spawns: relations.spawns, groups: [] },
    (function* () {
      for (const connection of connections)
        for (const pane of connection.snapshot?.panes ?? [])
          yield {
            connection_id: connection.connectionId,
            terminal_id: pane.terminal_id,
            tokens: (pane as { tokens?: unknown }).tokens,
          };
    })(),
  );
}

/**
 * Saved colours plus inherited ones, derived once per change of each set of
 * connections (the runtime store's, or the World object a view shows), for
 * every view that colours terminals. Spaces refreshes large snapshots often,
 * so with nothing that can inherit nothing is derived.
 */
const inherited = (() => {
  const derived = new WeakMap<
    Connections,
    {
      derive: ReturnType<typeof relationsDeriver>;
      colors?: TerminalColors;
      relations?: RelationsDocument;
      result?: TerminalColors;
    }
  >();
  return (
    colors: TerminalColors,
    relations: RelationsDocument,
    connections: Connections,
  ): TerminalColors => {
    let last = derived.get(connections);
    if (!last) {
      last = { derive: relationsDeriver() };
      derived.set(connections, last);
    }
    if (last.colors === colors && last.relations === relations)
      return last.result!;
    let result = colors;
    if (mayInherit(relations, connections)) {
      const found = last.derive(relations, runtimeRelationInputs(connections));
      result = withInheritedColors(colors, found.relations, found.places);
    }
    Object.assign(last, { colors, relations, result });
    return result;
  };
})();

/** Where inherited colours find terminals: the runtime store, or a view's World. */
export type ColorSource = {
  get(): { connections: Connections };
  subscribe(listener: () => void): () => void;
};

/**
 * A World object's connections as the colour source, so a view colours the
 * same terminals it draws relations between (useRelations).
 */
export function useWorldColorSource(
  world: Pick<WorldObject, "hosts">,
): ColorSource {
  return useMemo(() => {
    const state = { connections: world.hosts.map((host) => host.connection) };
    return { get: () => state, subscribe: () => () => {} };
  }, [world.hosts]);
}

/** The previous colours while no colour changed, so their identity is stable. */
export function keepColors(
  last: TerminalColors,
  next: TerminalColors,
): TerminalColors {
  const keys = Object.keys(next);
  return keys.length === Object.keys(last).length &&
    keys.every((key) => last[key] === next[key])
    ? last
    : next;
}

/**
 * The saved colours, kept current from the World service, with the colours
 * spawned tabs inherit from their parents (relations.ts). The object changes
 * only when a colour does, so Board's other edits (notes, positions) never
 * re-render or rebuild the views that colour terminals.
 */
export function useTerminalColors(
  store: BoardDocumentStore = sharedBoardStore(),
  runtime: ColorSource = worldRuntimeStore,
): TerminalColors {
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const last = useRef<TerminalColors>(NONE);
  const subscribe = useCallback(
    (listener: () => void) => {
      const offStore = store.subscribe(listener);
      const offRuntime = runtime.subscribe(listener);
      return () => {
        offStore();
        offRuntime();
      };
    },
    [store, runtime],
  );
  const snapshot = () => {
    const document = store.get().document;
    last.current = keepColors(
      last.current,
      inherited(
        document?.layout.colors ?? NONE,
        document?.relations ?? NO_RELATIONS,
        runtime.get().connections,
      ),
    );
    return last.current;
  };
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Choose a tab's colour, or reset it to the default with `null`. */
export function setTerminalColor(
  target: TerminalColorTarget,
  color: TerminalColor | null,
  store: BoardDocumentStore = sharedBoardStore(),
) {
  return store.patch([
    { op: "card.color", key: terminalColorKey(target), color },
  ]);
}

/** Spaces' tab strip, coloured from World's store (TabBar's colour seam). */
export function useWorldTabColors(): TabColorControl {
  const colors = useTerminalColors();
  return useMemo(() => {
    const targetOf = (
      owner: Parameters<TabColorControl["colorOf"]>[0],
      tab: Parameters<TabColorControl["colorOf"]>[1],
    ): TerminalColorTarget => ({
      connectionId: owner.connectionId,
      workspaceId: tab.workspace_id,
      tabId: tab.tab_id,
      workspaceIds: new Set(owner.workspaceIds),
    });
    return {
      palette: TERMINAL_COLOR_PALETTE,
      colorOf: (owner, tab) => {
        const { color, own } = resolveTerminal(colors, targetOf(owner, tab));
        // Only the tab's own colour can be reset; a workspace's is not its.
        return { id: color, custom: own };
      },
      onColor: (owner, tab, id) =>
        void setTerminalColor(
          targetOf(owner, tab),
          TERMINAL_COLORS.includes(id as TerminalColor)
            ? (id as TerminalColor)
            : null,
        ),
    };
  }, [colors]);
}

export type TerminalColorChoice = {
  palette: typeof TERMINAL_COLOR_PALETTE;
  current: { id: TerminalColor; custom: boolean };
  onColor(id: string | null): void;
};

/**
 * Terminal colours for the shared picker (ColorSwatch.tsx): a function from a
 * tab to its colour, whether it is the tab's own, and how to change it.
 */
export function useTerminalColorChoices(): (
  target: TerminalColorTarget,
) => TerminalColorChoice {
  const colors = useTerminalColors();
  return useCallback(
    (target) => {
      const { color, own } = resolveTerminal(colors, target);
      return {
        palette: TERMINAL_COLOR_PALETTE,
        // Only the tab's own colour can be reset; a workspace's is not its.
        current: { id: color, custom: own },
        onColor: (id) =>
          void setTerminalColor(
            target,
            TERMINAL_COLORS.includes(id as TerminalColor)
              ? (id as TerminalColor)
              : null,
          ),
      };
    },
    [colors],
  );
}
