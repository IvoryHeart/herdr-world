import { expect, test } from "bun:test";
import { BOARD_ELEMENT_TYPES, parseBoardElement } from "./boardElements";

test("registry includes the existing Board kinds and five data additions", () => {
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
    "artefact",
  ]);
  expect(new Set(BOARD_ELEMENT_TYPES.map((entry) => entry.kind)).size).toBe(12);
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

test("an agent's artefact keeps its agent and an absolute file or a link, never both", () => {
  const owner = {
    connection_id: "studio",
    workspace_id: "project-a",
    pane_id: "w1:p2",
    agent: "claude",
    artefact_kind: "report",
  };
  const artefact = {
    id: "artefact-0123456789abcdef",
    kind: "artefact",
    title: "weekly-report.md",
    x: 0,
    y: 0,
  };
  expect(
    parseBoardElement(
      {
        ...artefact,
        source: {
          ...owner,
          file: "/work/project-a/weekly-report.md",
          text: "x",
        },
      },
      1,
    ).source,
  ).toEqual({ ...owner, file: "/work/project-a/weekly-report.md" });
  expect(
    parseBoardElement(
      { ...artefact, source: { ...owner, url: "https://example.com/report" } },
      1,
    ).source,
  ).toEqual({ ...owner, url: "https://example.com/report" });
  // The maker's session fingerprint is kept as continuity evidence.
  const session = "c".repeat(64);
  expect(
    parseBoardElement(
      { ...artefact, source: { ...owner, session, file: "/work/a.md" } },
      1,
    ).source,
  ).toEqual({ ...owner, session, file: "/work/a.md" });
  for (const source of [
    { ...owner, session: "not-a-fingerprint", file: "/work/a.md" },
    { ...owner, file: "relative/report.md" },
    { ...owner, file: "/work/../secret.md" },
    { ...owner, file: "/work/a.md", url: "https://example.com/" },
    { ...owner },
    { ...owner, url: "javascript:alert(1)" },
    { ...owner, artefact_kind: "binary", file: "/work/a.md" },
    { ...owner, pane_id: "", file: "/work/a.md" },
    { ...owner, agent: undefined, file: "/work/a.md" },
  ])
    expect(() => parseBoardElement({ ...artefact, source }, 1)).toThrow();
});
