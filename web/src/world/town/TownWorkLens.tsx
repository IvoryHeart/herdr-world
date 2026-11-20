import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { WorkLens } from "../board/WorkLens";
import type { WorldObject } from "../worldObject";
import { AnswerOutboxContext } from "./answerOutbox";
import { useTownPostSources } from "./townPostFixture";
import { TownOpenUsageContext, useTownUsage } from "./TownUsageLens";

/**
 * Opens Board's Work lens over Town (#887). Town provides it; without it (a
 * town drawn alone, as in captures) the post office offers no Work lens.
 */
export const TownOpenWorkContext = createContext<(() => void) | null>(null);
export const useOpenTownWork = () => useContext(TownOpenWorkContext);

/**
 * The Work lens Board shows, over Town: the same model, columns and
 * cards, from the post office's sources. A card's agent opens as Town opens
 * it.
 */
export function TownWorkLens({
  world,
  onSelectAgent,
  onClose,
}: {
  world: WorldObject;
  onSelectAgent(id: string): void;
  onClose(): void;
}) {
  const sources = useTownPostSources();
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
      agentAction={(label) => `Open agent ${label}`}
      onSelectAgent={onSelectAgent}
      onClose={onClose}
    />
  );
}

/**
 * Town's contexts: the answer outbox and the openers of the post office's
 * Work lens and the observatory's Usage screens (TownUsageLens.tsx).
 */
export function TownContexts({
  outbox,
  lenses,
  children,
}: {
  outbox: () => void;
  lenses: Pick<ReturnType<typeof useTownLenses>, "openWork" | "openUsage">;
  children: ReactNode;
}) {
  return (
    <AnswerOutboxContext.Provider value={outbox}>
      <TownOpenWorkContext.Provider value={lenses.openWork}>
        <TownOpenUsageContext.Provider value={lenses.openUsage}>
          {children}
        </TownOpenUsageContext.Provider>
      </TownOpenWorkContext.Provider>
    </AnswerOutboxContext.Provider>
  );
}

/**
 * Town's lenses: the post office's Work and the observatory's Usage, their
 * openers and, while open, the lenses. An agent picked on a Work card opens
 * as Town opens it.
 */
export function useTownLenses(
  world: WorldObject,
  onSelect: (id: string) => unknown,
) {
  const [shown, setShown] = useState(false);
  const openWork = useCallback(() => setShown(true), []);
  const usage = useTownUsage();
  const work = shown ? (
    <TownWorkLens
      world={world}
      onClose={() => setShown(false)}
      onSelectAgent={(id) => {
        setShown(false);
        void onSelect(id);
      }}
    />
  ) : null;
  return {
    openWork,
    openUsage: usage.open,
    lens: (
      <>
        {work}
        {usage.lens}
      </>
    ),
  };
}
