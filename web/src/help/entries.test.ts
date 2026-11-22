import { expect, test } from "bun:test";
import { firstRunPath, HELP_ENTRIES, helpEntry, helpFor } from "./entries";
import {
  compareVersions,
  type HelpEntry,
  helpEntryProblems,
  helpPictureUrl,
} from "./helpEntry";
import { helpTabForPath, helpTabForView, helpTryView } from "./helpEvents";

test("every declared entry is well formed and unique", () => {
  expect(HELP_ENTRIES.flatMap(helpEntryProblems)).toEqual([]);
  const ids = HELP_ENTRIES.map((entry) => entry.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(HELP_ENTRIES.length).toBeGreaterThanOrEqual(6);
  for (const place of ["town", "board", "code", "chat", "world"] as const)
    expect(helpFor(place).length).toBeGreaterThan(0);
  expect(firstRunPath().map((entry) => entry.firstRun)).toEqual([1, 2, 3, 4]);
  expect(helpEntry("board.next")?.place).toBe("board");
  expect(helpEntry("board.missing")).toBeNull();
  expect(helpEntry("code.project")?.picture.scene).toBe("code");
});

test("each World view's ? opens its own tab; views without one open Everywhere", () => {
  expect(helpTabForView("town")).toBe("town");
  expect(helpTabForView("board")).toBe("board");
  expect(helpTabForView("code")).toBe("code");
  expect(helpTabForView("desk")).toBe("world");
  expect(helpTabForView("spaces")).toBe("world");
  expect(helpTabForPath("/code")).toBe("code");
});

test("Try switches to the entry's view when it is one, else stays", () => {
  expect(helpTryView("code", "town")).toBe("code");
  expect(helpTryView("board", "code")).toBe("board");
  expect(helpTryView("code", "code")).toBeNull();
  expect(helpTryView("chat", "town")).toBeNull();
  expect(helpTryView("world", "board")).toBeNull();
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
