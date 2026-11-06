import { expect, test } from "bun:test";
import { FieldClaims, displayClaims, claimAuthorizes } from "./field-claims";
import type { FieldClaim } from "../../../shared/fieldClaims";

const claim = (
  source: string,
  value: string,
  observed_at = 1,
): FieldClaim<string> => ({
  source,
  value,
  observed_at,
  basis: source.startsWith("herdr.") ? "reported" : "inferred",
  author: "synthetic-author",
  source_revision: "opaque-revision",
});

test("exhaustive source observations preserve independent claims and detach returned values", () => {
  const actions = [
    "report-a",
    "report-b",
    "silent-a",
    "silent-b",
    "complete-a",
    "complete-b",
    "retract-a",
    "retract-b",
  ];
  for (const first of actions)
    for (const second of actions)
      for (const third of actions) {
        const field = new FieldClaims<string>();
        const expected = new Map<string, string>();
        for (const action of [first, second, third]) {
          const source = action.endsWith("a")
            ? "herdr.agent"
            : "world.transcript";
          if (action.startsWith("report")) {
            field.observe(source, claim(source, action), false);
            expected.set(source, action);
          } else if (action.startsWith("silent"))
            field.observe(source, undefined, false);
          else if (action.startsWith("complete")) {
            field.observe(source, undefined, true);
            expected.delete(source);
          } else {
            field.retract(source);
            expected.delete(source);
          }
          expect(
            field.values().map((item) => [item.source, item.value]),
          ).toEqual([...expected].sort(([a], [b]) => a.localeCompare(b)));
          const returned = field.values();
          if (returned[0]) returned[0].value = "changed outside the store";
        }
      }
  const field = new FieldClaims<string>();
  expect(() =>
    field.observe("world.transcript", claim("herdr.agent", "idle"), true),
  ).toThrow("does not own");
  const input = claim("herdr.agent", "idle");
  field.observe(input.source, input, true);
  input.value = "mutated";
  expect(field.values()).toEqual([claim("herdr.agent", "idle")]);
});

test("field display policies retain provenance and never use latest-wins authority", () => {
  const reported = claim("herdr.agent", "idle", 1),
    inferred = claim("world.transcript", "working", 2);
  for (const order of [
    [reported, inferred],
    [inferred, reported],
  ]) {
    expect(displayClaims("agent_status", order)).toEqual([reported]);
    expect(order).toHaveLength(2);
  }
  const report = claim(
    "herdr.metadata",
    "https://github.com/example-org/widgets/pull/1",
  );
  const branch = claim(
    "world.checkout",
    "https://github.com/example-org/widgets/pull/2",
    2,
  );
  expect(displayClaims("pr_links", [branch, report])).toEqual([report, branch]);
  expect(displayClaims("agent_status", [inferred])).toEqual([inferred]);
  const title = claim("herdr.title", "synthetic-thread", 1);
  expect(displayClaims("session", [reported, inferred, title])).toEqual([
    title,
  ]);
  expect(claimAuthorizes("session", "conversation.send", title)).toBe(true);
  expect(claimAuthorizes("session", "conversation.send", reported)).toBe(true);
  expect(
    claimAuthorizes("session", "conversation.send", {
      ...reported,
      basis: "inferred",
    }),
  ).toBe(false);
  expect(claimAuthorizes("session", "conversation.send", inferred)).toBe(false);
  for (const verb of [
    "pull_request.merge",
    "pull_request.close",
    "pull_request.ready",
    "conversation.send",
  ])
    for (const item of [report, branch])
      expect(claimAuthorizes("pr_links", verb, item)).toBe(false);
});
