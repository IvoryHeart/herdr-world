import { expect, test } from "bun:test";
import {
  BOARD_ELEMENT_TYPES,
  isLibraryMemory,
  parseBoardElement,
} from "./boardElements";

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

test("a memory can name a Library entry and a log its apartment", () => {
  const library = {
    connection_id: "studio",
    workspace_id: "project-a",
    memory_source_id: "a1b2c3",
    path: "notes/decisions.md",
  };
  const parsed = parseBoardElement(
    { ...element, source: { ...library, token: "discard" } },
    1,
  );
  expect(parsed.source).toEqual(library);
  expect(isLibraryMemory(parsed.source as typeof library)).toBe(true);
  expect(isLibraryMemory(file)).toBe(false);
  const hostOnly = {
    connection_id: library.connection_id,
    memory_source_id: library.memory_source_id,
    path: library.path,
  };
  expect(parseBoardElement({ ...element, source: hostOnly }, 1).source).toEqual(
    hostOnly,
  );
  // A Library entry has no default: the Library names it.
  expect(() =>
    parseBoardElement(
      { ...element, source: { ...library, path: undefined } },
      1,
    ),
  ).toThrow();
  expect(() =>
    parseBoardElement(
      { ...element, source: { ...library, path: "../outside.md" } },
      1,
    ),
  ).toThrow();
  expect(() =>
    parseBoardElement(
      { ...element, source: { ...library, memory_source_id: "" } },
      1,
    ),
  ).toThrow();
  const log = parseBoardElement(
    {
      ...element,
      kind: "log",
      source: {
        ...file,
        path: "logs/agent.jsonl",
        agent_ref: "session-1",
        apartment_id: "resident-1",
      },
    },
    1,
  );
  expect(log.source).toEqual({
    ...file,
    path: "logs/agent.jsonl",
    agent_ref: "session-1",
    apartment_id: "resident-1",
  });
  expect(() =>
    parseBoardElement(
      {
        ...element,
        kind: "log",
        source: { ...file, apartment_id: "x".repeat(513) },
      },
      1,
    ),
  ).toThrow();
});
