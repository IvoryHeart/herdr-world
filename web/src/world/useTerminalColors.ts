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
  TERMINAL_COLOR_HEX,
  TERMINAL_COLORS,
  terminalColorKey,
  type TerminalColor,
  type TerminalColors,
  type TerminalColorTarget,
} from "./terminalColor";
import {
  NO_RELATIONS,
  relationsDeriver,
  runtimeRelationInputs,
  withInheritedColors,
} from "./relations";
import { worldRuntimeStore } from "./runtimeStore";

/** Terminal colours as World's service keeps them (see terminalColor.ts). */

const NONE: TerminalColors = Object.freeze({});

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
  runtime: Pick<
    typeof worldRuntimeStore,
    "get" | "subscribe"
  > = worldRuntimeStore,
): TerminalColors {
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const derive = useRef(relationsDeriver()).current;
  const last = useRef<TerminalColors>(NONE);
  const lastConnections = useRef<unknown>(null);
  const inputs = useRef(runtimeRelationInputs([]));
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
    const { connections } = runtime.get();
    if (connections !== lastConnections.current) {
      lastConnections.current = connections;
      inputs.current = runtimeRelationInputs(connections);
    }
    const { relations, places } = derive(
      document?.relations ?? NO_RELATIONS,
      inputs.current,
    );
    last.current = keepColors(
      last.current,
      withInheritedColors(document?.layout.colors ?? NONE, relations, places),
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

const PALETTE = TERMINAL_COLORS.map((id) => ({
  id,
  hex: TERMINAL_COLOR_HEX[id],
}));

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
      palette: PALETTE,
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
