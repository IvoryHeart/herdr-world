/**
 * The glyphs in Town's thought bubbles, one per step kind, drawn in the
 * same pixel bubble as the status bubbles (townSprites.ts): a pencil for
 * edits, a test tube for tests, a prompt for a command, a magnifier for
 * reading or searching, a globe for the web, a light bulb for thinking or
 * writing, and two figures for a subagent.
 */

import { townBubble } from "./townSprites";
import type { TownStepKind } from "./townSteps";

type Rect = (x: number, y: number, w: number, h: number, color: string) => void;

const GLYPHS: Record<TownStepKind, (R: Rect) => void> = {
  edit: (R) => {
    R(8, 1, 2, 1, "#e2799a");
    R(7, 2, 2, 1, "#e3aa3a");
    R(6, 3, 2, 1, "#e3aa3a");
    R(5, 4, 2, 1, "#e3aa3a");
    R(4, 5, 2, 1, "#e3aa3a");
    R(3, 6, 2, 1, "#f1d3a1");
    R(2, 7, 2, 1, "#3a2b22");
  },
  test: (R) => {
    R(3, 1, 5, 1, "#8aa0b3");
    R(3, 2, 1, 5, "#8aa0b3");
    R(7, 2, 1, 5, "#8aa0b3");
    R(4, 2, 3, 2, "#d2efff");
    R(4, 4, 3, 3, "#3fae5c");
    R(4, 7, 3, 1, "#8aa0b3");
    R(5, 7, 1, 1, "#3fae5c");
  },
  command: (R) => {
    R(1, 1, 9, 7, "#2b3340");
    R(3, 3, 1, 1, "#7fbf7a");
    R(4, 4, 1, 1, "#7fbf7a");
    R(3, 5, 1, 1, "#7fbf7a");
    R(6, 5, 3, 1, "#7fbf7a");
  },
  read: (R) => {
    R(3, 2, 3, 3, "#d2efff");
    R(3, 1, 3, 1, "#4f7cc9");
    R(2, 2, 1, 3, "#4f7cc9");
    R(6, 2, 1, 3, "#4f7cc9");
    R(3, 5, 3, 1, "#4f7cc9");
    R(6, 6, 2, 1, "#8a5a3c");
    R(7, 7, 2, 1, "#8a5a3c");
  },
  web: (R) => {
    R(3, 1, 5, 1, "#4f9ad9");
    R(2, 2, 7, 5, "#4f9ad9");
    R(3, 7, 5, 1, "#4f9ad9");
    R(3, 2, 2, 2, "#5aa857");
    R(4, 4, 1, 1, "#5aa857");
    R(6, 4, 2, 2, "#5aa857");
    R(5, 6, 2, 1, "#5aa857");
  },
  think: (R) => {
    R(4, 1, 3, 1, "#e3aa3a");
    R(3, 2, 5, 3, "#ffd166");
    R(4, 5, 3, 1, "#ffd166");
    R(4, 2, 1, 1, "#fff3c4");
    R(4, 6, 3, 1, "#8a909a");
    R(5, 7, 1, 1, "#5d6574");
  },
  agent: (R) => {
    R(2, 1, 2, 2, "#e9b98f");
    R(1, 3, 4, 4, "#6b7a8f");
    R(7, 3, 2, 2, "#e9b98f");
    R(6, 5, 4, 3, "#4f7cc9");
  },
};

const urls = new Map<TownStepKind, string>();

/** A step kind's bubble as an image URL, drawn once. */
export function townStepGlyphUrl(kind: TownStepKind) {
  let url = urls.get(kind);
  if (!url) {
    url = townBubble(GLYPHS[kind]).toDataURL();
    urls.set(kind, url);
  }
  return url;
}
