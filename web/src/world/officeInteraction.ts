/*
 * MODIFIED FILE NOTICE — Apache-2.0 Section 4(b)
 *
 * This TypeScript drawing adaptation is downstream Herdr World / Office work
 * derived from the historical Claw-Empire Office renderer. Source provenance,
 * source hashes, and license obligations are recorded in docs/world-assets.md.
 */

import { Container, Graphics, Text } from "pixi.js";
import { officeDebug } from "../officeDebug";

export const pointerSequences = new WeakMap<
  (key: string) => void,
  {
    key: string;
    at: number;
    x: number;
    y: number;
    activate?: (key: string) => void;
  }
>();

export const canvasActivationCandidates = new WeakMap<
  (key: string) => void,
  {
    key: string;
    at: number;
    x: number;
    y: number;
    activate: (key: string) => void;
  }
>();

export function makeInteractive(
  node: Container | Graphics | Text,
  key: string,
  onSelect: (key: string) => void,
  onActivate?: (key: string) => void,
) {
  node.label = key;
  node.eventMode = "static";
  node.cursor = "pointer";
  node.on("pointertap", (event) => {
    event.stopPropagation();
    officeDebug("renderer:pointertap", {
      key,
      detail: event.detail,
      hasActivation: Boolean(onActivate),
    });
    if (event.detail === 0) {
      pointerSequences.delete(onSelect);
      canvasActivationCandidates.delete(onSelect);
      onSelect(key);
      return;
    }
    const now = window.performance.now();
    const prior = pointerSequences.get(onSelect);
    const isSecondClick =
      prior?.key === key && (event.detail === 2 || now - prior.at <= 500);
    onSelect(key);
    if (isSecondClick) {
      pointerSequences.delete(onSelect);
      canvasActivationCandidates.delete(onSelect);
      onActivate?.(key);
      return;
    }
    pointerSequences.set(onSelect, {
      key,
      at: now,
      x: event.global.x,
      y: event.global.y,
      activate: onActivate,
    });
    const candidate = canvasActivationCandidates.get(onSelect);
    if (onActivate && (!candidate || now - candidate.at > 1_000)) {
      canvasActivationCandidates.set(onSelect, {
        key,
        at: now,
        x: event.global.x,
        y: event.global.y,
        activate: onActivate,
      });
    }
  });
}
