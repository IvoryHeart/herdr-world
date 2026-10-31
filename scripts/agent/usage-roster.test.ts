import { expect, test } from "bun:test";
import { assessRoster, parseRoster, rosterNotes } from "./usage-roster";
import type { Row } from "./usage-attribution";
import { renderComment } from "./usage-attribution";
import { parsePrOptions } from "./usage-cli";

const row = (values: Partial<Row> = {}): Row => ({
  pr: 7,
  seat: "builder",
  role: "builder",
  family: "codex",
  model: "gpt-6.1-sol",
  effort: "xhigh",
  session: "00000000-0000-4000-8000-000000000001",
  from: "2026-10-25T10:00:00.000Z",
  until: "2026-10-25T11:00:00.000Z",
  input: 10,
  cacheRead: 20,
  cacheWrite: 0,
  output: 5,
  responses: 1,
  estimate: false,
  ...values,
});
const roster = { builder: { model: "gpt-6.1-sol", effort: "xhigh" } };

test("roster accepts the agreed shared config shape and rejects invalid expectations", () => {
  expect(
    parseRoster({
      reviewers: { default: ["reviewer"] },
      roster,
    }),
  ).toEqual(roster);
  expect(() =>
    parseRoster({ roster: { Builder: { model: "gpt-6.1-sol" } } }),
  ).toThrow("roster");
  expect(() =>
    parseRoster({ roster: { builder: { effort: "xhigh" } } }),
  ).toThrow("roster");
});

test("model and effort drift are detected across recorded windows without hiding unknown effort", () => {
  const report = assessRoster(
    [
      row(),
      row({ model: "gpt-6-luna", effort: "medium" }),
      row({ effort: "medium" }),
      row({ effort: "unknown" }),
    ],
    roster,
    7,
  );
  expect(report.checks.map((c) => c.status)).toEqual([
    "match",
    "drift",
    "drift",
    "unknown",
  ]);
  expect(report.driftResponses).toBe(2);
  expect(report.unknownResponses).toBe(1);
  expect(
    assessRoster([row({ seat: "unconfigured" })], roster).checks[0]?.status,
  ).toBe("unconfigured");
  expect(
    assessRoster([row({ effort: "unknown" })], {
      builder: { model: "gpt-6.1-sol" },
    }).checks[0]?.status,
  ).toBe("match");
  expect(assessRoster([row({ effort: "" })], roster).checks[0]?.status).toBe(
    "unknown",
  );
});

test("PR roster checks and public notes exclude unrelated rows and private fields", () => {
  const own = row({ model: "gpt-6-luna", effort: "medium" });
  const unrelated = row({ pr: 8, model: "gpt-6-astra" });
  const unassigned = row({ pr: null, model: "gpt-6-astra" });
  expect(
    assessRoster([own, unrelated, unassigned], roster, 7).checks,
  ).toHaveLength(1);
  const note = rosterNotes([own, unrelated, unassigned], roster, 7).join("\n");
  expect(note).toContain("gpt-6-luna");
  expect(note).toContain("gpt-6.1-sol");
  for (const secret of [
    "builder",
    "medium",
    "xhigh",
    "gpt-6-astra",
    "00000000-0000",
    "2026-10-25",
  ])
    expect(note).not.toContain(secret);
  const privateNote = rosterNotes(
    [row({ seat: "private-seat", model: "private@example.invalid" })],
    { "private-seat": { model: "/example/private/model" } },
    7,
  ).join("\n");
  for (const secret of [
    "private-seat",
    "private@example.invalid",
    "/example/private",
  ])
    expect(privateNote).not.toContain(secret);
});

test("roster-check accepts global history or a specific PR plus an explicit config", () => {
  expect(parsePrOptions(["roster-check"]).pr).toBeNull();
  expect(
    parsePrOptions([
      "roster-check",
      "--pr",
      "7",
      "--config",
      "/example/config.json",
      "--json",
    ]),
  ).toMatchObject({
    command: "roster-check",
    pr: 7,
    config: "/example/config.json",
    json: true,
  });
  expect(() => parsePrOptions(["roster-check", "--pr", "bad"])).toThrow();
});

test("public comments carry PR-scoped drift notes with model names only", () => {
  const own = row({ model: "gpt-6-luna", effort: "medium" });
  const comment = renderComment(7, [own], 0, roster);
  expect(comment).toContain("Model/effort drift detected");
  expect(comment).toContain("gpt-6.1-sol → gpt-6-luna");
  expect(comment).not.toContain("medium");
  expect(
    renderComment(7, [own, row({ pr: null, model: "gpt-6-astra" })], 0, roster),
  ).toBe(comment);
});
