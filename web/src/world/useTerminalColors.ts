import {
  runtimeAppearanceTargets,
  visibleAppearanceColors,
  saveAppearance,
} from "./appearance";
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
  type BoardDocument,
  type BoardDocumentStore,
} from "./board/boardDocument";
import {
  placeColor,
  resolveTerminal,
  TERMINAL_COLOR_PALETTE,
  TERMINAL_COLORS,
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
import { DEVTOOLS } from "./devtools/flag";
import { countWorldWork } from "./devtools/renderer";

/** Terminal colours as World's service keeps them (see terminalColor.ts). */

const NONE: TerminalColors = Object.freeze({});

type Connections = ReturnType<typeof worldRuntimeStore.get>["connections"];

/** Whether a child can inherit: a saved claim between listed terminals. */
export function mayInherit(
  relations: RelationsDocument,
  connections: Connections,
) {
  return anyRelation({ spawns: relations.spawns, groups: [] }, (see) => {
    for (const connection of connections)
      for (const pane of connection.snapshot?.panes ?? [])
        if (see(connection.connectionId, pane.terminal_id)) return;
  });
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

/** The colours last derived, and the inputs they were derived from. */
export type TerminalColorsSnapshot = {
  colors: TerminalColors;
  inputs?: { document: BoardDocument | null; connections: Connections };
};

/**
 * useTerminalColors' snapshot. React reads it on every render and every
 * notification of either store, so the colours are derived again only when
 * the Board document or the connections change.
 */
export function terminalColorsSnapshot(
  last: TerminalColorsSnapshot,
  store: { get(): { document: BoardDocument | null } },
  runtime: Pick<ColorSource, "get">,
): TerminalColors {
  const document = store.get().document;
  const connections = runtime.get().connections;
  if (
    last.inputs?.document === document &&
    last.inputs.connections === connections
  )
    return last.colors;
  if (DEVTOOLS) countWorldWork("colors.derive");
  last.inputs = { document, connections };
  last.colors = keepColors(
    last.colors,
    inherited(
      visibleAppearanceColors(document, connections),
      document?.relations ?? NO_RELATIONS,
      connections,
    ),
  );
  return last.colors;
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
  const last = useRef<TerminalColorsSnapshot>({ colors: NONE });
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
  const snapshot = () => terminalColorsSnapshot(last.current, store, runtime);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Choose a tab's colour, or reset it to the default with `null`. */
export function setTerminalColor(
  target: TerminalColorTarget,
  color: TerminalColor | null,
  store: BoardDocumentStore = sharedBoardStore(),
) {
  const connections = worldRuntimeStore.get().connections;
  const connection = connections.find(
    (item) => item.connectionId === target.connectionId,
  );
  const observed = runtimeAppearanceTargets(connections).find(
    (item) =>
      item.kind === "tab" &&
      item.connection_id === target.connectionId &&
      item.native_id === target.tabId,
  );
  if (!connection || !observed)
    return Promise.resolve("Terminal appearance is unavailable");
  return saveAppearance(
    { ...observed, connection_generation: connection.generation },
    { color },
    store,
  );
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

/** Choose a workspace's or host's colour (see placeColor), or reset it. */
export function setPlaceColor(
  key: string,
  color: TerminalColor | null,
  store: BoardDocumentStore = sharedBoardStore(),
) {
  return store.patch([{ op: "card.color", key, color }]);
}

/**
 * Place colours for the shared picker: a function from a workspace's or
 * host's colour key to its chosen colour (or "default") and how to change it.
 */
export function usePlaceColorChoices(): (key: string) => TerminalColorChoice {
  const colors = useTerminalColors();
  return useCallback(
    (key) => {
      const own = placeColor(colors, key);
      return {
        palette: TERMINAL_COLOR_PALETTE,
        current: {
          id: own ?? "default",
          custom: own !== null,
        } as TerminalColorChoice["current"],
        onColor: (id) =>
          void setPlaceColor(
            key,
            TERMINAL_COLORS.includes(id as TerminalColor)
              ? (id as TerminalColor)
              : null,
          ),
      };
    },
    [colors],
  );
}
