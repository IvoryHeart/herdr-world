import { townBubble, townQuietPaint } from "./townSprites";

let url: string | undefined;

/** The canvas's quiet bubble (a run-down hourglass) as an image URL, drawn once. */
export function townQuietGlyphUrl() {
  url ??= townBubble(townQuietPaint).toDataURL();
  return url;
}
