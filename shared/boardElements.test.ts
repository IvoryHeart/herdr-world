import { expect, test } from "bun:test";
import { BOARD_ELEMENT_TYPES, parseBoardElement } from "./boardElements";

test("registry includes the existing Board kinds and four data additions", () => {
  expect(BOARD_ELEMENT_TYPES.map((entry) => entry.kind)).toEqual([
    "host",
    "workspace",
    "tab",
    "pane",
    "note",
    "string",
    "work",
    "memory",
    "log",
    "document",
    "link",
  ]);
  expect(new Set(BOARD_ELEMENT_TYPES.map((entry) => entry.kind)).size).toBe(11);
});

const file = {
  connection_id: "studio",
  workspace_id: "project-a",
  path: "memory/MEMORY.md",
};
const element = {
  id: "e-a",
  kind: "memory",
  title: "Project memory",
  x: 10,
  y: 20,
  source: file,
};

test("typed sources are normalized and untrusted fields never persist", () => {
  expect(
    parseBoardElement(
      { ...element, source: { ...file, token: "discard" }, rev: 99 },
      1,
    ),
  ).toEqual({ ...element, rev: 1 });
  expect(
    parseBoardElement(
      { ...element, kind: "document", source: { text: "Draft" } },
      2,
    ).source,
  ).toEqual({ text: "Draft" });
});

test("refuses unknown kinds, source escapes, oversized content and executable URLs", () => {
  for (const path of [
    "../secret",
    "/private/file",
    "C:/private/file",
    "memory/../secret",
    "a\\b",
    "a\u0000b",
  ])
    expect(() =>
      parseBoardElement({ ...element, source: { ...file, path } }, 1),
    ).toThrow();
  for (const url of [
    "javascript:alert(1)",
    "file:///private/file",
    "https://user:password@example.com",
    "data:text/html,hello",
    `https://example.com/${"界".repeat(240)}`,
  ])
    expect(() =>
      parseBoardElement({ ...element, kind: "link", source: { url } }, 1),
    ).toThrow();
  expect(() => parseBoardElement({ ...element, kind: "plugin" }, 1)).toThrow();
  expect(() =>
    parseBoardElement(
      { ...element, kind: "document", source: { text: "x".repeat(16_001) } },
      1,
    ),
  ).toThrow();
});
