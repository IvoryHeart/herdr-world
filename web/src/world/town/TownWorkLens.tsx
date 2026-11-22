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
import { PlaceWindow } from "../PlaceWindow";
import type { WorldObject } from "../worldObject";
import { AnswerOutboxContext } from "./answerOutbox";
import { TownOpenUsageContext, useTownUsage } from "./TownUsageLens";
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
  // Town's one window (#1170): the warehouse and the Shipyard open it.
  return (
    <PlaceWindow
      name="work"
      label="Work"
      closeLabel="Close Work"
      bodyClassName="place-window-lens"
      onClose={onClose}
    >
      <WorkLens
        world={world}
        sources={sources}
        className="town-work"
        initialTab={tab}
        framed
        agentAction={(label) => `Open agent ${label}`}
        onSelectAgent={onSelectAgent}
        onClose={onClose}
      />
    </PlaceWindow>
  );
}

/**
 * Town's contexts: the answer outbox, Work and Usage openers and the world
 * whose Needs you items the post office counts.
 */
export function TownContexts({
  outbox,
  lenses,
  children,
}: {
  outbox: () => void;
  lenses: Pick<
    ReturnType<typeof useTownLenses>,
    "openWork" | "openUsage" | "world"
  >;
  children: ReactNode;
}) {
  const post = useMemo(() => ({ world: lenses.world }), [lenses.world]);
  return (
    <AnswerOutboxContext.Provider value={outbox}>
      <TownOpenWorkContext.Provider value={lenses.openWork}>
        <TownOpenUsageContext.Provider value={lenses.openUsage}>
          <TownPostProvider source={post}>{children}</TownPostProvider>
        </TownOpenUsageContext.Provider>
      </TownOpenWorkContext.Provider>
    </AnswerOutboxContext.Provider>
  );
}

/**
 * Town's lenses: the warehouse's Work and the observatory's Usage, their
 * openers and, while open, the lenses. An agent picked on a Work card opens
 * as Town opens it.
 */
export function useTownLenses(
  world: WorldObject,
  onSelect: (id: string) => unknown,
) {
  const [shown, setShown] = useState<WorkLensTab | null>(null);
  const openWork = useCallback<TownOpenWork>(
    (tab = "pull_requests") => setShown(tab),
    [],
  );
  const usage = useTownUsage(world);
  const work = shown ? (
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
  return {
    openWork,
    openUsage: usage.open,
    world,
    lens: (
      <>
        {work}
        {usage.lens}
      </>
    ),
  };
}
