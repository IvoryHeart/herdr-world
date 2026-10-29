import { expect, test } from "bun:test";
import {
  boardAppearance,
  boardAppearanceStyle,
  defaultBoardStatusColor,
} from "./boardAppearance";

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
