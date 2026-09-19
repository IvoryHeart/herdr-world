import { describe, expect, test } from "bun:test";
import { createFileSearchMatcher } from "./fileSearch";

const entries = [
  { name: "readme.md", path: "readme.md" },
  { name: "README.MD", path: "docs/README.MD" },
  { name: "roadmd", path: "docs/nested/roadmd" },
  { name: "other.md", path: "docs/other.md" },
  { name: "r1.md", path: "docs/nested/r1.md" },
  { name: "r12.md", path: "src/r12.md" },
  { name: "readme.mmd", path: "readme.mmd" },
  { name: "readme.md.bak", path: "readme.md.bak" },
];
const matches = (pattern: string) =>
  entries.filter(createFileSearchMatcher(pattern)).map((e) => e.path);

describe("loaded file search", () => {
  test("anchors glob patterns to filenames, including nested loaded files", () => {
    expect(matches("r*md")).toEqual([
      "readme.md",
      "docs/README.MD",
      "docs/nested/roadmd",
      "docs/nested/r1.md",
      "src/r12.md",
      "readme.mmd",
    ]);
    expect(matches("r?.md")).toEqual(["docs/nested/r1.md"]);
  });
  test("supports directory globstars, alternatives, and character classes", () => {
    expect(matches("docs/*.md")).toEqual(["docs/README.MD", "docs/other.md"]);
    expect(matches("docs/**/*.md")).toEqual([
      "docs/README.MD",
      "docs/other.md",
      "docs/nested/r1.md",
    ]);
    expect(matches("*.{md,mmd}")).toHaveLength(6);
    expect(matches("r[0-9].md")).toEqual(["docs/nested/r1.md"]);
    expect(matches("docs\\**\\r?.md")).toEqual(["docs/nested/r1.md"]);
  });
  test("keeps plain substring search and incomplete patterns usable", () => {
    expect(matches("  README  ")).toEqual([
      "readme.md",
      "docs/README.MD",
      "readme.mmd",
      "readme.md.bak",
    ]);
    expect(matches("docs/nested")).toHaveLength(2);
    expect(matches("")).toHaveLength(entries.length);
    expect(
      createFileSearchMatcher("notes[")({
        name: "notes[1].md",
        path: "notes[1].md",
      }),
    ).toBe(true);
    expect(
      createFileSearchMatcher("#a+")({ name: "#a+.md", path: "#a+.md" }),
    ).toBe(true);
  });
});

test("large brace ranges stay usable without unbounded expansion", () => {
  expect(
    createFileSearchMatcher("r{1..100000000}.md")({
      name: "r1.md",
      path: "r1.md",
    }),
  ).toBe(true);
});
