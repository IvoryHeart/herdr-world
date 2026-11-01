import { expect, test } from "bun:test";
import { parsePodMarkdown, renderGroupMarkdown } from "./groupMarkdown";
import { buildGroupViews } from "./groupViews";
import { agentAddress, type Group } from "./groups";

test("imports one explicit crew table without interpreting surrounding prose", () => {
  const result = parsePodMarkdown(
    `# Crew\n\n| Pod | Lead | Builders | Reviewers | Now (in order) |\n|---|---|---|---|---|\n| **Chat** | lead | one, two | rev1 + rev5 | Review |\n\nOther prose stays outside the table.`,
  );
  expect(result).toEqual([
    {
      name: "Chat",
      lead: ["lead"],
      builders: ["one", "two"],
      reviewers: ["rev1", "rev5"],
      now: ["Review"],
    },
  ]);
});

test("rendered Pod intent round trips escaped names and qualified role refs", () => {
  const ref = agentAddress("connection-a", "builder");
  const group: Group = {
    id: "chat",
    name: "Chat | UI",
    kind: "pod",
    created_at: 1,
    members: [{ ref, roles: ["lead", "builder"], joined_at: 1 }],
    attrs: { queue: ["Review | merge", "<br>"] },
  };
  const markdown = renderGroupMarkdown(buildGroupViews([group], []));
  expect(parsePodMarkdown(markdown)).toEqual([
    {
      name: "Chat | UI",
      lead: [ref],
      builders: [ref],
      reviewers: [],
      now: ["Review | merge", "<br>"],
    },
  ]);
  expect(markdown).toContain("unknown");
});

test("ambiguous/duplicate or malformed table input is refused instead of clipped", () => {
  expect(() => parsePodMarkdown("no crew table")).toThrow("table");
  const header =
    "| Pod | Lead | Builders | Reviewers | Now |\n|---|---|---|---|---|\n";
  expect(() =>
    parsePodMarkdown(
      header + "| Chat | a | b | c | Ship |\n| Chat | a | b | c | Ship |",
    ),
  ).toThrow("duplicate");
  expect(() => parsePodMarkdown(header + "| Chat | a | b | c |")).toThrow(
    "columns",
  );
  expect(() =>
    parsePodMarkdown((header + "| Chat | a | b | c | Ship |\n\n").repeat(2)),
  ).toThrow("one");
});

test("refuses ambiguous role/Now columns and mismatched separator columns", () => {
  for (const [header, separator, row] of [
    [
      "Pod | Lead | Lead | Builders | Reviewers",
      "---|---|---|---|---",
      "Chat | one | two | builder | reviewer",
    ],
    [
      "Pod | Lead | Builders | Reviewers | Now | Now (in order)",
      "---|---|---|---|---|---",
      "Chat | one | builder | reviewer | first | second",
    ],
    [
      "Pod | Lead | Builders | Reviewers",
      "---|---|---",
      "Chat | one | builder | reviewer",
    ],
  ]) {
    expect(() =>
      parsePodMarkdown(`| ${header} |\n|${separator}|\n| ${row} |`),
    ).toThrow();
  }
});
