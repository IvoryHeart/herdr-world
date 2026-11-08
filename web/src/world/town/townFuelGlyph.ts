import {
  TOWN_FUEL_BUBBLE_WIDTH,
  townBubble,
  townFuelPaint,
} from "./townSprites";

let url: string | undefined;

/** The canvas's out-of-fuel bubble (an empty can and a clock) as an image URL, drawn once. */
export function townFuelGlyphUrl() {
  url ??= townBubble(townFuelPaint, TOWN_FUEL_BUBBLE_WIDTH).toDataURL();
  return url;
}
