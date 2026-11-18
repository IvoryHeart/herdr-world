import type { WorldAgentStatus } from "../worldObject";

/**
 * Town's agent-state colours on its night ground: the status blocks over its
 * agents (townRenderer.ts) and Board's night surface (boardAppearance.css)
 * draw from this one palette, so the two views read as one World (#906).
 * Idle and no-signal never glow in Town; Board's quiet squares use the last
 * two, a cool grey and a soft violet that sit back on the night ground.
 */
export const TOWN_STATE_COLORS: Readonly<Record<WorldAgentStatus, string>> = {
  working: "#6fc3ff",
  blocked: "#ffb547",
  done: "#7be08f",
  idle: "#8b93ad",
  unknown: "#c3a2ff",
};

/** A state colour as the number Pixi draws with. */
export const townStateColorNumber = (status: WorldAgentStatus) =>
  Number.parseInt(TOWN_STATE_COLORS[status].slice(1), 16);
