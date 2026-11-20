import { worldLocalStorage } from "../../browserStorage";
import { TOWN_LENSES, townLensStep, type TownLensId } from "./townLens";

export const TOWN_LENS_KEY = "townLens";
// Attention on a fresh page; a choice from Settings also applies before Town mounts.
let state = { lens: "attention" as TownLensId, choosing: false };
let lastLens: TownLensId | null = null;
const listeners = new Set<() => void>();
export const townLensSnapshot = () => state;
export function subscribeTownLens(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function update(lens: TownLensId, choosing: boolean) {
  if (lens !== "attention") {
    lastLens = lens;
    try {
      worldLocalStorage.setItem(TOWN_LENS_KEY, lens);
    } catch {
      // Storage refused: keep the page's choice.
    }
  }
  if (state.lens === lens && state.choosing === choosing) return;
  state = { lens, choosing };
  for (const listener of listeners) listener();
}
function rememberedLens(): TownLensId {
  if (lastLens === null) {
    const saved = worldLocalStorage.getItem(TOWN_LENS_KEY);
    lastLens =
      TOWN_LENSES.find((lens) => lens === saved && lens !== "attention") ??
      "idle";
  }
  return lastLens;
}
/** Settings picks Attention to return to the ordinary Town board. */
export const setTownLens = (lens: TownLensId) => update(lens, false);
export const townLensActions = {
  pick: (lens: TownLensId) => update(lens, lens === "attention"),
  step(direction: 1 | -1) {
    const next = townLensStep(state.lens, direction);
    update(next, next === "attention");
  },
  cycle(direction: 1 | -1) {
    if (state.lens !== "attention" || state.choosing)
      townLensActions.step(direction);
    else townLensActions.pick(rememberedLens());
  },
  open: () => update(rememberedLens(), true),
  choose: () =>
    update(state.lens, !state.choosing || state.lens === "attention"),
  close: () => update("attention", false),
};
