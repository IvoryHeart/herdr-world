import { useEffect, useMemo } from "react";
import type { TabColorControl } from "../components/TabBar";
import {
  sharedBoardStore,
  useBoardDocument,
  type BoardDocumentStore,
} from "./board/boardDocument";
import {
  customTerminalColor,
  defaultTerminalColor,
  TERMINAL_COLOR_HEX,
  TERMINAL_COLORS,
  terminalColorKey,
  type TerminalColor,
  type TerminalColors,
  type TerminalColorTarget,
} from "./terminalColor";

/** Terminal colours as World's service keeps them (see terminalColor.ts). */

const NONE: TerminalColors = Object.freeze({});

/** The saved colours, kept current from the World service. */
export function useTerminalColors(
  store: BoardDocumentStore = sharedBoardStore(),
): TerminalColors {
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  return useBoardDocument(store).document?.layout.colors ?? NONE;
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
        const target = targetOf(owner, tab);
        const custom = customTerminalColor(colors, target);
        return {
          id: custom ?? defaultTerminalColor(terminalColorKey(target)),
          custom: custom !== null,
        };
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
