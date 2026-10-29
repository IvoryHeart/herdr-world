import {
  townCanvas,
  townCharacter,
  townShade,
  townSprite,
  type TownCanvas,
  type TownLook,
} from "./townSprites";

/**
 * The London bus stop and the red double-decker, in Town's sprite recipe: a
 * one-pixel outline, shaded rectangles and pixel discs, one sprite pixel per
 * world pixel like the characters and tiles.
 */

export const BUS_W = 62;
export const BUS_H = 42;
/** The lower-deck door's left edge, in sprite pixels from the bus's left. */
export const BUS_DOOR_X = 37;
/** Upper-deck windows (sprite pixels): passengers look out of these. */
export const BUS_WINDOWS = [5, 15, 25, 35, 45].map((x) => ({ x, y: 6 }));
export const STOP_W = 20;
export const STOP_H = 42;

let stop: TownCanvas | null = null;
export function busStopSprite() {
  stop ??= townSprite(18, 40, (R, D) => {
    R(8, 10, 2, 30, "#6b7a8f");
    R(8, 10, 1, 30, "#8a97a8");
    // The roundel and the stop's name bar.
    D(9, 8, 8, "#d7261e");
    D(9, 8, 5, "#eef0ea");
    R(0, 7, 18, 3, "#1f3b8f");
    R(0, 7, 18, 1, "#3d5fb8");
    // The timetable.
    R(4, 30, 10, 7, "#1d2633");
    R(5, 31, 8, 1, "#ffd166");
    R(5, 33, 6, 1, "#9fd3ff");
    R(5, 35, 7, 1, "#9fd3ff");
  });
  return stop;
}

const buses = new Map<string, TownCanvas>();
/** The bus with its doors open or shut, on one of two wheel frames. */
export function busSprite(open: boolean, wheel: 0 | 1) {
  const key = `${open}|${wheel}`;
  let canvas = buses.get(key);
  if (canvas) return canvas;
  const red = "#d7261e";
  const dark = townShade(red, -0.28);
  const light = townShade(red, 0.22);
  const glass = "#9fd3ff";
  const glassShade = "#6fa8d6";
  const cream = "#eef0ea";
  const tyre = "#2a2a2a";
  const hub = "#6b7a8f";
  canvas = townSprite(60, 40, (R, D) => {
    R(0, 2, 60, 32, red);
    R(0, 2, 60, 1, light);
    R(1, 0, 58, 2, dark);
    R(0, 33, 60, 1, dark);
    R(0, 17, 60, 2, cream);
    for (let i = 0; i < 5; i += 1) {
      R(4 + i * 10, 5, 8, 8, glass);
      R(4 + i * 10, 5, 8, 1, "#cfeaff");
      R(4 + i * 10, 12, 8, 1, glassShade);
    }
    // The destination blind.
    R(52, 5, 6, 8, "#1d2633");
    R(53, 7, 4, 1, "#ffd166");
    R(53, 9, 3, 1, "#ffd166");
    for (let i = 0; i < 3; i += 1) {
      R(4 + i * 10, 21, 8, 7, glass);
      R(4 + i * 10, 27, 8, 1, glassShade);
    }
    if (open) {
      R(36, 20, 10, 14, "#2a2a2a");
      R(36, 20, 1, 14, "#3a3a3a");
      R(46, 20, 2, 14, red);
    } else {
      R(36, 20, 10, 14, dark);
      R(41, 20, 1, 14, townShade(red, -0.45));
      R(37, 22, 3, 5, glass);
      R(42, 22, 3, 5, glass);
    }
    R(50, 21, 8, 7, glass);
    // Headlight and tail light.
    R(58, 28, 2, 3, "#ffd166");
    R(0, 28, 2, 3, "#c94f4f");
    for (const cx of [12, 48]) {
      D(cx, 35, 4, tyre);
      D(cx, 35, 2, hub);
      // A spoke that turns between frames.
      if (wheel) R(cx - 1, 35, 3, 1, tyre);
      else R(cx, 34, 1, 3, tyre);
    }
  });
  buses.set(key, canvas);
  return canvas;
}

const heads = new Map<string, TownCanvas>();
/** A passenger's head and shoulders, cut to fit an upper-deck window. */
export function busPassengerSprite(look: TownLook, key: string) {
  let canvas = heads.get(key);
  if (canvas) return canvas;
  const body = townCharacter(look, "down", 0, "stand", false);
  const [head, context] = townCanvas(8, 8);
  // The character sprite has a one-pixel outline border; its face starts at 3.
  context.drawImage(body, 3, 1, 8, 8, 0, 0, 8, 8);
  canvas = head;
  heads.set(key, canvas);
  if (heads.size > 64) heads.delete(heads.keys().next().value!);
  return canvas;
}
