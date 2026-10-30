import { expect, test } from "bun:test";
import {
  BOARD_STATUS_LABELS,
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

test("default status colours match the CSS palette for both themes and surface overrides", async () => {
  const css = await Bun.file(
    new URL("./boardAppearance.css", import.meta.url),
  ).text();
  const [dark, light] = css.split(':root[data-theme="light"]');
  for (const surface of ["theme", "whiteboard", "blackboard"] as const) {
    for (const theme of ["light", "dark"]) {
      const palette =
        surface === "whiteboard" || (surface === "theme" && theme === "light")
          ? light!
          : dark!;
      for (const status of Object.keys(
        BOARD_STATUS_LABELS,
      ) as (keyof typeof BOARD_STATUS_LABELS)[]) {
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
