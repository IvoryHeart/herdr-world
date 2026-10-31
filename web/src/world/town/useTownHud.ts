import {
  createContext,
  useCallback,
  useEffect,
  useSyncExternalStore,
} from "react";
import type { TownHud, TownHudTopic } from "./scene/townHud";

/** The Town HUD store, for HUD elements that follow drawn frames. */
export const TownHudContext = createContext<TownHud | null>(null);

/** One HUD topic; the component renders again only when it changes. */
export function useTownHud<T extends TownHudTopic>(
  hud: TownHud,
  topic: T,
): TownHud[T] {
  const subscribe = useCallback(
    (listener: () => void) => hud.subscribe(topic, listener),
    [hud, topic],
  );
  return useSyncExternalStore(subscribe, () => hud[topic]);
}

/**
 * Wall-clock now for ages ("waiting 3 min"): while `active`, the component
 * renders again every 15 s so its ages move on.
 */
export function useTownAges(hud: TownHud, active: boolean): number {
  useEffect(() => (active ? hud.showAges() : undefined), [hud, active]);
  useTownHud(hud, "ages");
  return hud.now();
}
