import { useCallback, useRef, useState } from "react";
import { type SpacesCoreChoice, spacesCoreChoice } from "./spacesCore";
import type { WorldLeafObject } from "./worldObject";

/**
 * The herdr-core terminal Spaces shows in place of a Herdr tab (#1329), and
 * App's requests to show Spaces' terminal over an Inspector covering it.
 * Opening (a find, Town, Board) and choosing in the strip (#1390) both
 * reveal the terminal, for every runtime alike; only an open is a new
 * choice, so a phone comes back to it from the list.
 */
export function useSpacesCore() {
  const [shown, setShown] = useState<
    (SpacesCoreChoice & { opened: number }) | null
  >(null);
  const opens = useRef(0);
  const [reveals, setReveals] = useState(0);
  const reveal = useCallback(() => setReveals((count) => count + 1), []);
  const show = useCallback(
    (leaf: WorldLeafObject) => {
      setShown({ ...spacesCoreChoice(leaf), opened: ++opens.current });
      reveal();
    },
    [reveal],
  );
  // Choosing in the strip, by click or tab key, only changes what Spaces
  // shows: herdr-core has no focus to send.
  const choose = useCallback(
    (choice: SpacesCoreChoice) => {
      setShown((current) =>
        current ? { ...choice, opened: current.opened } : current,
      );
      reveal();
    },
    [reveal],
  );
  const close = useCallback(() => setShown(null), []);
  return { shown, reveals, reveal, show, choose, close };
}
