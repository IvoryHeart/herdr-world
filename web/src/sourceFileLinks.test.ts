import { expect, test } from "bun:test";
import {
  parseSourceFileLink,
  sourceFileWithinWorktree,
} from "./sourceFileLinks";

test("source links keep their line or Markdown heading, including escaped paths", () => {
  expect(parseSourceFileLink("/project/demo/src/main.ts:12:3")).toEqual({
    path: "/project/demo/src/main.ts",
    line: 12,
  });
  expect(parseSourceFileLink("src/a%20b.ts#L12-L15")).toEqual({
    path: "src/a b.ts",
    line: 12,
  });
  expect(parseSourceFileLink("docs/guide.md#setup")).toEqual({
    path: "docs/guide.md",
    fragment: "setup",
  });
  expect(parseSourceFileLink("main.ts:9")).toEqual({
    path: "main.ts",
    line: 9,
  });
  expect(parseSourceFileLink("C:\\project\\demo\\main.ts:5")).toEqual({
    path: "C:\\project\\demo\\main.ts",
    line: 5,
  });
  for (const href of [
    "https://example.test/main.ts:12",
    "http://example.test",
    "mailto:person@example.test",
    "#setup",
    "file://other.example.test/project/demo/main.ts",
  ])
    expect(parseSourceFileLink(href)).toBeUndefined();
  for (const href of [
    "src/main.ts:0",
    "src/main.ts:99999999999999999999",
    "bad%ZZ.ts",
    "src/%00.ts",
    "%2f%2fother.example.test/src/main.ts",
  ])
    expect(parseSourceFileLink(href)).toBeNull();
});

test("absolute and relative links stay inside the selected worktree", () => {
  const root = "/project/demo";
  expect(
    sourceFileWithinWorktree(root, { path: root + "/src/main.ts", line: 12 }),
  ).toEqual({ path: "src/main.ts", line: 12 });
  expect(sourceFileWithinWorktree(root, { path: "./src/../main.ts" })).toEqual({
    path: "main.ts",
  });
  for (const path of [
    "/project/other/main.ts",
    "/project/demo-other/main.ts",
    "../main.ts",
    "src/../../main.ts",
    root + "/../other/main.ts",
    "C:\\project\\demo\\main.ts",
    "~/demo/main.ts",
  ])
    expect(sourceFileWithinWorktree(root, { path })).toBeNull();
  expect(
    sourceFileWithinWorktree("C:\\project\\demo", {
      path: "C:\\project\\demo\\src\\main.ts",
      line: 2,
    }),
  ).toEqual({ path: "src/main.ts", line: 2 });
});
