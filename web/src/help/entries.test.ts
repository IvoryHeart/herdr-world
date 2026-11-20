import { expect, test } from "bun:test";
import { firstRunPath, HELP_ENTRIES, helpEntry, helpFor } from "./entries";
import {
  compareVersions,
  type HelpEntry,
  helpEntryProblems,
  helpPictureUrl,
} from "./helpEntry";

test("every declared entry is well formed and unique", () => {
  expect(HELP_ENTRIES.flatMap(helpEntryProblems)).toEqual([]);
  const ids = HELP_ENTRIES.map((entry) => entry.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(HELP_ENTRIES.length).toBeGreaterThanOrEqual(6);
  for (const place of ["town", "board", "chat", "world"] as const)
    expect(helpFor(place).length).toBeGreaterThan(0);
  expect(firstRunPath().map((entry) => entry.firstRun)).toEqual([1, 2, 3, 4]);
  expect(helpEntry("board.next")?.place).toBe("board");
  expect(helpEntry("board.missing")).toBeNull();
});

test("problems name the entry and what to fix", () => {
  const bad: HelpEntry = {
    id: "Board.Next",
    title: "",
    summary: " ",
    steps: [],
    place: "board",
    where: "",
    control: "Board Next",
    since: "soon",
    picture: { scene: "board", sizes: [] },
  };
  const problems = helpEntryProblems(bad);
  expect(problems.every((p) => p.startsWith('help entry "Board.Next"'))).toBe(
    true,
  );
  expect(problems).toHaveLength(8);
});

test("versions order numerically and pictures fall back to a captured size", () => {
  expect(compareVersions("0.3.10", "0.3.9")).toBeGreaterThan(0);
  expect(compareVersions("0.3.0", "0.3.0")).toBe(0);
  const phoneOnly = helpEntry("world.phone-hosts")!;
  expect(helpPictureUrl(phoneOnly, "desktop", "dark")).toBe(
    "/help/world.phone-hosts.phone.dark.webp",
  );
  expect(helpPictureUrl(helpEntry("board.next")!, "desktop", "light")).toBe(
    "/help/board.next.desktop.light.webp",
  );
});
