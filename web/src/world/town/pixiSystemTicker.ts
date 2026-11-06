import { Ticker } from "pixi.js";

/**
 * Pixi's system ticker runs its pointer events and texture collection, and
 * would request a frame 60 times a second while Town is idle. Town stops it
 * once its renderer is ready and advances it in its own frames, the only
 * times the scene changes.
 */
export function holdPixiSystemTicker() {
  Ticker.system.autoStart = false;
  Ticker.system.stop();
}

export function advancePixiSystemTicker() {
  Ticker.system.update();
}
