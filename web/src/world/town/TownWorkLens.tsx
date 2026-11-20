import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { WorkLens, type WorkLensTab } from "../board/WorkLens";
import type { WorldObject } from "../worldObject";
import { AnswerOutboxContext } from "./answerOutbox";
import { TownPostProvider } from "./TownPostOffice";
import { useTownWarehouseSources } from "./townWarehouseFixture";

/**
 * Opens Board's Work lens over Town (#887), on its first tab or on `tab`
 * (the harbour opens Releases, #1028). Town provides it; without it (a town
 * drawn alone, as in captures) the warehouse and the harbour offer no
 * Work lens.
 */
export type TownOpenWork = (tab?: WorkLensTab) => void;
export const TownOpenWorkContext = createContext<TownOpenWork | null>(null);
export const useOpenTownWork = () => useContext(TownOpenWorkContext);

/**
 * The Work lens Board shows, over Town: the same model, columns and
 * cards, from the warehouse's sources. A card's agent opens as Town opens
 * it.
 */
export function TownWorkLens({
  world,
  tab,
  onSelectAgent,
  onClose,
}: {
  world: WorldObject;
  tab?: WorkLensTab;
  onSelectAgent(id: string): void;
  onClose(): void;
}) {
  const sources = useTownWarehouseSources();
  // The sign that opened it lies under the lens: keys carry on in the lens.
  useEffect(() => {
    document
      .querySelector<HTMLElement>(
        '.town-work [role="tab"][aria-selected="true"]',
      )
      ?.focus({ preventScroll: true });
  }, []);
  return (
    <WorkLens
      world={world}
      sources={sources}
      className="town-work"
      initialTab={tab}
      agentAction={(label) => `Open agent ${label}`}
      onSelectAgent={onSelectAgent}
      onClose={onClose}
    />
  );
}

/**
 * Town's contexts: the answer outbox, the Work lens's opener and Town's
 * world, which the post office counts Needs you's items in (#1098).
 */
export function TownContexts({
  outbox,
  work,
  children,
}: {
  outbox: () => void;
  work: { open: TownOpenWork; world: WorldObject };
  children: ReactNode;
}) {
  const post = useMemo(() => ({ world: work.world }), [work.world]);
  return (
    <AnswerOutboxContext.Provider value={outbox}>
      <TownOpenWorkContext.Provider value={work.open}>
        <TownPostProvider source={post}>{children}</TownPostProvider>
      </TownOpenWorkContext.Provider>
    </AnswerOutboxContext.Provider>
  );
}

/**
 * Town's Work lens: the warehouse's opener and, while open, the lens. An
 * agent picked on a card opens as Town opens it.
 */
export function useTownWork(
  world: WorldObject,
  onSelect: (id: string) => unknown,
) {
  const [shown, setShown] = useState<WorkLensTab | null>(null);
  const open = useCallback<TownOpenWork>(
    (tab = "pull_requests") => setShown(tab),
    [],
  );
  const lens = shown ? (
    <TownWorkLens
      key={shown}
      world={world}
      tab={shown}
      onClose={() => setShown(null)}
      onSelectAgent={(id) => {
        setShown(null);
        void onSelect(id);
      }}
    />
  ) : null;
  return { open, lens, world };
}
