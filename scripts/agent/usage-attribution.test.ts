import { expect, test } from "bun:test";
import {
  attribute,
  inferredWindows,
  renderComment,
  tokenTotal,
  type Window,
} from "./usage-attribution";
import type { UsageEvent } from "./usage-records";

const from = "2026-10-25T10:00:00.000Z";
const middle = "2026-10-25T11:00:00.000Z";
const until = "2026-10-25T12:00:00.000Z";
const event = (id: string, at: string): UsageEvent => ({
  id,
  at,
  session: "00000000-0000-4000-8000-000000000001",
  seat: "builder",
  family: "codex",
  model: "gpt-6.1-sol",
  effort: "xhigh",
  input: 10,
  cacheRead: 20,
  cacheWrite: 0,
  output: 5,
  responses: 1,
});
const window = (pr: number, start = from, end = until): Window => ({
  pr,
  from: start,
  until: end,
  seat: "builder",
  session: event("", "").session,
  role: "builder",
  source: "assignment",
});

test("shared sessions split at exclusive window ends without losing tokens", () => {
  const events = [
    event("before", "2026-10-25T09:59:59.000Z"),
    event("a", from),
    event("b", middle),
    event("after", until),
  ];
  const rows = attribute(events, [
    window(1, from, middle),
    window(2, middle, until),
  ]);
  expect(
    rows.filter((r) => r.pr === 1).reduce((n, r) => n + r.responses, 0),
  ).toBe(1);
  expect(
    rows.filter((r) => r.pr === 2).reduce((n, r) => n + r.responses, 0),
  ).toBe(1);
  expect(
    rows.filter((r) => r.pr === null).reduce((n, r) => n + r.responses, 0),
  ).toBe(2);
  expect(rows.reduce((n, r) => n + tokenTotal(r), 0)).toBe(140);
});

test("overlapping claims for different PRs are unattributed rather than duplicated", () => {
  expect(
    attribute([event("a", middle)], [window(1), window(2)])[0],
  ).toMatchObject({ pr: null, role: "unattributed", responses: 1 });
  expect(
    attribute([event("a", middle)], [window(1), window(1)])[0],
  ).toMatchObject({ pr: 1, responses: 1 });
  expect(() => attribute([event("a", middle), event("a", middle)], [])).toThrow(
    "Duplicate",
  );
});

test("exclusive ends compare instants even when timestamps have different precision", () => {
  expect(
    attribute(
      [event("edge", until)],
      [{ ...window(7), until: "2026-10-25T12:00:00Z" }],
    )[0]?.pr,
  ).toBeNull();
});

test("review attribution needs a matching request and canonical RESULT timestamp", () => {
  const seat = {
    seat: "rev2",
    session: event("", "").session,
    family: "codex" as const,
  };
  const body = `Reviewer: rev2\nReviewed commit: ${"a".repeat(40)}\nRESULT #7: 0/0 resolved, 0 new`;
  const reviews = [{ body, submittedAt: until }];
  expect(inferredWindows(seat, [], 7, reviews, until)).toEqual([]);
  expect(
    inferredWindows(
      seat,
      [{ at: from, text: "Please review #7" }],
      7,
      reviews,
      until,
    ),
  ).toEqual([
    {
      pr: 7,
      seat: "rev2",
      session: seat.session,
      role: "reviewer:rev2",
      from,
      until,
      source: "review",
    },
  ]);
  expect(
    inferredWindows(
      seat,
      [{ at: from, text: "Review #7" }],
      7,
      [{ body: `> ${body}`, submittedAt: until }],
      until,
    ),
  ).toEqual([]);
});

test("coordinator mentions are estimates bounded by next prompt and 30 minutes", () => {
  const seat = {
    seat: "firstmate",
    session: "synthetic",
    family: "claude" as const,
  };
  const rows = inferredWindows(
    seat,
    [
      { at: from, text: "READY #7" },
      { at: middle, text: "#7 and #8" },
    ],
    7,
    [],
    until,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    source: "estimate",
    until: "2026-10-25T10:30:00.000Z",
  });
});

test("public comments exclude session, seat, path, effort and arbitrary model strings", () => {
  const rows = attribute([event("a", middle)], [window(7)]);
  const privateRow = {
    ...rows[0]!,
    seat: "private-user",
    session: "/example/private/session.jsonl",
    role: "reviewer:private-user" as const,
    model: "private@example.invalid",
    effort: "https://example.invalid/session/private",
  };
  const comment = renderComment(7, [
    privateRow,
    { ...privateRow, pr: null, role: "unattributed" },
  ]);
  for (const secret of [
    "private-user",
    "session.jsonl",
    "private@example.invalid",
    "https://",
    "00000000-0000",
    "/example/",
  ])
    expect(comment).not.toContain(secret);
  expect(comment).toContain("<!-- crew-usage -->");
  expect(comment).toContain("| reviewer | unknown |");
  expect(comment).toContain("Shared local unattributed pool: 35 tokens");
  expect(comment).toContain("| **PR total** | | 5 | 20 | 0 | 10 | 1 | 35 |");
  expect(
    renderComment(7, [
      { ...privateRow, model: "gpt-6.secret.example.invalid" },
    ]),
  ).not.toContain("secret.example.invalid");
});
