import type { CSSProperties } from "react";
import type { WorldAgentStatus } from "../worldObject";

export const BOARD_APPEARANCE_KEY = "herdr-world.board.appearance";
export const BOARD_SURFACES = ["theme", "whiteboard", "blackboard"] as const;
export type BoardSurface = (typeof BOARD_SURFACES)[number];
export type BoardAppearance = {
  surface: BoardSurface;
  statusColors: Partial<Record<WorldAgentStatus, string>>;
};
export const BOARD_STATUS_LABELS: Record<WorldAgentStatus, string> = {
  blocked: "Needs you",
  working: "Working",
  done: "Finished, not checked",
  idle: "Idle",
  unknown: "No signal",
};

/** Status choices never enter the document's user-chosen card colours. */
export function boardAppearance(value: unknown): BoardAppearance {
  const raw =
    value && typeof value === "object"
      ? (value as Partial<BoardAppearance>)
      : {};
  const surface = BOARD_SURFACES.includes(raw.surface as BoardSurface)
    ? raw.surface!
    : "theme";
  const statusColors: BoardAppearance["statusColors"] = {};
  for (const status of Object.keys(BOARD_STATUS_LABELS) as WorldAgentStatus[]) {
    const color = raw.statusColors?.[status];
    if (typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color))
      statusColors[status] = color;
  }
  return { surface, statusColors };
}

export function boardAppearanceStyle(
  settings: BoardAppearance,
): CSSProperties & Partial<Record<`--s-${WorldAgentStatus}`, string>> {
  return Object.fromEntries(
    Object.entries(settings.statusColors).map(([status, color]) => [
      `--s-${status}`,
      color,
    ]),
  );
}

export function defaultBoardStatusColor(
  status: WorldAgentStatus,
  settings: BoardAppearance,
  theme: string | undefined,
) {
  const light =
    settings.surface === "whiteboard" ||
    (settings.surface === "theme" && theme === "light");
  return (
    light
      ? {
          working: "#2a6bd4",
          blocked: "#c47f08",
          done: "#2a8753",
          idle: "#8a9189",
          unknown: "#8656c4",
        }
      : {
          working: "#7fa7ff",
          blocked: "#ffc25a",
          done: "#6dd29a",
          idle: "#8e978e",
          unknown: "#c3a2ff",
        }
  )[status];
}
