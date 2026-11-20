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
import { TownOpenUsageContext } from "./TownUsageLens";
import type { UsageTab } from "../usage/UsageLens";

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
 * Town's contexts: the answer outbox, the Work lens's opener and the Usage
 * screens' (the observatory's, TownUsageLens.tsx).
 */
export function TownContexts({
  outbox,
  openWork,
  openUsage = null,
  children,
}: {
  outbox: () => void;
  openWork: () => void;
  openUsage?: ((tab?: UsageTab) => void) | null;
  children: ReactNode;
}) {
  return (
    <AnswerOutboxContext.Provider value={outbox}>
      <TownOpenWorkContext.Provider value={openWork}>
        <TownOpenUsageContext.Provider value={openUsage}>
          {children}
        </TownOpenUsageContext.Provider>
      </TownOpenWorkContext.Provider>
    </AnswerOutboxContext.Provider>
  );
}

/**
 * Town's Work lens: the post office's opener and, while open, the lens. An
 * agent picked on a card opens as Town opens it.
 */
export function useTownWork(
  world: WorldObject,
  onSelect: (id: string) => unknown,
) {
  const [shown, setShown] = useState(false);
  const open = useCallback(() => setShown(true), []);
  const lens = shown ? (
    <TownWorkLens
      world={world}
      onClose={() => setShown(false)}
      onSelectAgent={(id) => {
        setShown(false);
        void onSelect(id);
      }}
    />
  ) : null;
  return { open, lens };
}
