import { expect, test } from "bun:test";
import {
  BOARD_STATUS_LABELS,
  boardAppearance,
  boardAppearanceStyle,
  defaultBoardStatusColor,
} from "./boardAppearance";
import { TOWN_STATE_COLORS } from "../town/townStateColors";
import type { WorldAgentStatus } from "../worldObject";

test("Board surface and status colours validate independently of card colours", () => {
  expect(boardAppearance(null)).toEqual({ surface: "theme", statusColors: {} });
  const settings = boardAppearance({
    surface: "whiteboard",
    statusColors: {
      blocked: "#123abc",
      done: "url(example.invalid)",
      unknown: 2,
    },
    colors: { card: "pink" },
  });
  expect(settings).toEqual({
    surface: "whiteboard",
    statusColors: { blocked: "#123abc" },
  });
  expect(boardAppearanceStyle(settings)).toEqual({ "--s-blocked": "#123abc" });
  expect(boardAppearance({ surface: "invalid" }).surface).toBe("theme");
});

test("default status colours follow the selected surface without changing the theme", () => {
  expect(
    defaultBoardStatusColor("blocked", boardAppearance(null), "light"),
  ).toBe("#c47f08");
  expect(
    defaultBoardStatusColor(
      "blocked",
      boardAppearance({ surface: "blackboard" }),
      "light",
    ),
  ).toBe("#ffc25a");
  expect(
    defaultBoardStatusColor(
      "blocked",
      boardAppearance({ surface: "whiteboard" }),
      "dark",
    ),
  ).toBe("#c47f08");
});

test("a dark theme's Board takes Town's state colours; Blackboard keeps its chalk", () => {
  for (const status of Object.keys(BOARD_STATUS_LABELS) as WorldAgentStatus[])
    expect(defaultBoardStatusColor(status, boardAppearance(null), "dark")).toBe(
      TOWN_STATE_COLORS[status],
    );
  expect(
    defaultBoardStatusColor(
      "blocked",
      boardAppearance({ surface: "blackboard" }),
      "dark",
    ),
  ).toBe("#ffc25a");
});

test("default status colours match the CSS palette for both themes and surface overrides", async () => {
  const css = await Bun.file(
    new URL("./boardAppearance.css", import.meta.url),
  ).text();
  const [night, rest] = css.split('.board[data-surface="blackboard"] {');
  const [blackboard, light] = rest!.split(':root[data-theme="light"]');
  for (const surface of ["theme", "whiteboard", "blackboard"] as const) {
    for (const theme of ["light", "dark"]) {
      const palette =
        surface === "whiteboard" || (surface === "theme" && theme === "light")
          ? light!
          : surface === "blackboard"
            ? blackboard!
            : night!;
      for (const status of Object.keys(
        BOARD_STATUS_LABELS,
      ) as WorldAgentStatus[]) {
        const color = palette.match(
          new RegExp(`--s-${status}:\\s*(#[0-9a-f]{6})`),
        )?.[1];
        expect(color).toBeDefined();
        expect(
          defaultBoardStatusColor(status, boardAppearance({ surface }), theme),
        ).toBe(color!);
      }
    }
  }
});
