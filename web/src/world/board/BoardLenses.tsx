/**
 * Town's lenses, Since you left and desk badges on Board (boardLens.ts):
 * the same lens state, legend, recap and pull request badge as Town, read
 * from the same facts. `L` steps the lenses here too (Shift+L back), the
 * Lenses control opens the chooser, and Escape or ✕ leaves the lens.
 */

import {
  createContext,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { WorldSourcesSnapshot } from "../../../../shared/worldSources";
import { questMark, type useAgentQuests } from "../agentQuests";
import { DeskWorkBadge } from "../town/DeskWorkBadge";
import {
  deskBadges,
  sameTownBadges,
  type TownDeskBadge,
} from "../town/townBadges";
import {
  markData,
  markStyle,
  TownLensLegend,
  useLensView,
  useTownLensKeys,
  useTownLensState,
} from "../town/TownLenses";
import { TOWN_LENS_NAMES, type TownLensMark } from "../town/townLens";
import type { TownQuestMark } from "../town/townQuestPennant";
import { townScaleSceneRequested } from "../town/townScaleScene";
import { TownSinceYouLeft } from "../town/TownSinceYouLeft";
import { useOwnerPresence } from "../presence";
import type { WorldLeafObject, WorldObject } from "../worldObject";
import { worldSourcesStore } from "../worldSources";
import {
  boardDeskWork,
  boardLensDeskKey,
  boardLensMark,
  boardLensPlaces,
  boardLensReadout,
  boardLensSelected,
  boardSceneWork,
} from "./boardLens";
import type { BoardModel, BoardTab } from "./boardModel";
import "../town/townBoard.css";
import "./boardLens.css";

/** The card or pane row under the pointer or focus, for the legend. */
type BoardLensPoint = { key: string; paneKey?: string };

/** Board's lenses: state, keys, marks, the readout and each tab's badge. */
export function useBoardLenses({
  model,
  world,
  quests,
  shell,
  selectedId,
}: {
  model: BoardModel;
  world: Pick<WorldObject, "nodeById">;
  quests: ReturnType<typeof useAgentQuests>;
  shell: { readonly current: HTMLElement | null };
  /** The selected workspace or pane, read when nothing is pointed at. */
  selectedId: string | null;
}) {
  const state = useTownLensState();
  useTownLensKeys(state, shell, false);
  const [scene] = useState(() =>
    typeof window === "undefined"
      ? false
      : townScaleSceneRequested(window.location.search),
  );
  // Sources poll often: Board itself reads them only for the Pull requests
  // lens (the scale scene brings its own); the badges read them below.
  const sources = useSourcesWhile(state.lens === "pulls" && !scene);
  const places = useCallback(() => boardLensPlaces(model), [model]);
  const deskWork = useCallback(
    () => (sources ? boardDeskWork(model, sources) : new Map()),
    [model, sources],
  );
  const questMarks = useMemo(
    (): ReadonlyMap<string, TownQuestMark> =>
      new Map([...quests].map(([key, quest]) => [key, questMark(quest)])),
    [quests],
  );
  const activityAt = useCallback(
    (agent: { nodeId: string }) => {
      const leaf = world.nodeById.get(agent.nodeId);
      return leaf && "lastActivityAt" in leaf
        ? (leaf as WorldLeafObject).lastActivityAt
        : undefined;
    },
    [world],
  );
  const view = useLensView(state.lens, places, {
    deskWork,
    quests: questMarks,
    activityAt,
  });
  const [pointed, setPointed] = useState<BoardLensPoint | null>(null);
  /** Pointer over or focus on a card (or a pane row) names it in the legend. */
  const point = useCallback(
    (target: EventTarget | null) => {
      if (!state.shown || !(target instanceof Element)) return;
      const card = target.closest<HTMLElement>(".board-card");
      const key = card?.dataset.key;
      const paneKey =
        target.closest<HTMLElement>("[data-pane]")?.dataset.pane ?? undefined;
      setPointed((was) =>
        was?.key === key && was?.paneKey === paneKey
          ? was
          : key
            ? { key, ...(paneKey ? { paneKey } : {}) }
            : null,
      );
    },
    [state.shown],
  );
  const readout = boardLensReadout(
    view,
    model,
    pointed ?? (view ? boardLensSelected(model, selectedId) : null),
  );
  return { state, view, model, readout, point };
}

export type BoardLenses = ReturnType<typeof useBoardLenses>;

/** A card's lens attributes: its mark, colour and accessible reading. */
export function boardLensCard(
  lenses: BoardLenses,
  key: string,
  leafId?: string,
): {
  mark?: TownLensMark;
  data?: string;
  style?: CSSProperties;
  label: string;
} {
  const { view, model } = lenses;
  if (!view) return { label: "" };
  // A pane row reads its own agent only, never its tab's reading.
  const mark = leafId
    ? view.agents.get(leafId)
    : boardLensMark(view, model, key);
  const style = markStyle(view, mark);
  return {
    ...(mark ? { mark } : {}),
    data: markData(mark),
    ...(style ? { style } : {}),
    label: `. ${TOWN_LENS_NAMES[view.lens]}: ${mark?.words ?? "nothing to show"}`,
  };
}

/** A card's reading under the lens, on a tag along its top edge. */
export function BoardLensReading({ mark }: { mark: TownLensMark | undefined }) {
  return (
    <span className="board-lens-reading" aria-hidden="true">
      <i />
      {mark ? (mark.short ?? mark.words) : "—"}
    </span>
  );
}

const NO_BADGES: ReadonlyMap<string, TownDeskBadge> = new Map();
const BoardBadges = createContext(NO_BADGES);
const noSubscription = () => () => {};
const noSources = () => null;

/** World sources while `on`, else null without polling for them. */
function useSourcesWhile(on: boolean): WorldSourcesSnapshot | null {
  return useSyncExternalStore(
    on ? worldSourcesStore.subscribe : noSubscription,
    on ? worldSourcesStore.snapshot : noSources,
    on ? worldSourcesStore.snapshot : noSources,
  );
}

/**
 * Each tab's work badge, from World sources (or the scale scene's pull
 * requests), to the cards inside. Only the badges follow each sources poll:
 * the board under it keeps its render.
 */
export function BoardWorkBadges({
  model,
  children,
}: {
  model: BoardModel;
  children: ReactNode;
}) {
  const [scene] = useState(() =>
    typeof window === "undefined"
      ? false
      : townScaleSceneRequested(window.location.search),
  );
  const sources = useSourcesWhile(!scene);
  const kept = useRef(NO_BADGES);
  const badges = useMemo(() => {
    const next = deskBadges(
      scene
        ? boardSceneWork(boardLensPlaces(model), Date.now())
        : boardDeskWork(model, sources!),
    );
    // An unchanged poll keeps the same badges, so no card redraws.
    if (!sameTownBadges(kept.current, next)) kept.current = next;
    return kept.current;
  }, [scene, model, sources]);
  return <BoardBadges.Provider value={badges}>{children}</BoardBadges.Provider>;
}

/** A tab's pull request badge, as on Town's desk nameplate. */
export function BoardTabBadge({ tab }: { tab: BoardTab }) {
  const badge = useContext(BoardBadges).get(boardLensDeskKey(tab));
  if (!badge) return null;
  return (
    // The board takes presses for its gestures; the badge keeps its own.
    <span
      className="board-work-badge"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <DeskWorkBadge badge={badge} deskLabel={tab.label} />
    </span>
  );
}

/**
 * Board's top left, as Town's board sign: the lens legend while a lens is
 * on, and "Since you left" after a return.
 */
export function BoardLensDock({
  lenses,
  world,
}: {
  lenses: BoardLenses;
  world: Pick<WorldObject, "leaves" | "nodeById">;
}) {
  // The recap reads asks, reviews and sources: only after a return.
  const presence = useOwnerPresence();
  const returned = !presence.dismissed && presence.away !== null;
  return (
    <div className="board-lens-dock">
      {lenses.state.shown ? (
        <TownLensLegend
          state={lenses.state}
          view={lenses.view}
          readout={lenses.readout}
        />
      ) : null}
      {returned ? (
        <div className="town-board board-recap">
          <TownSinceYouLeft world={world} variant="board" />
        </div>
      ) : null}
    </div>
  );
}
