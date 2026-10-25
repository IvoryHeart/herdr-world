import { describe, expect, test } from "bun:test";
import {
  CASES,
  config,
  confirm,
  input,
  NOW,
  result,
  SHA,
  type Post,
} from "./cases";
import { evaluate, verdictState, type ConditionState } from "./predicate";

describe("acceptance cases", () => {
  test.each(CASES.map((entry) => [entry.name, entry] as const))(
    "%s",
    (_, entry) => {
      const verdict = evaluate(entry.input, entry.config ?? config, entry.now);
      expect(verdict.state).toBe(entry.expect.state);
      for (const [id, state] of Object.entries(entry.expect.conditions ?? {}))
        expect(
          verdict.conditions.find((condition) => condition.id === id)?.state,
        ).toBe(state as ConditionState);
    },
  );

  test("a retained flake failure and a carried claim are reported, not hidden", () => {
    const flake = evaluate(
      CASES.find((entry) => entry.name.startsWith("A4 "))!.input,
      config,
      NOW,
    );
    expect(flake.notes).toContain("Browser tests: 1 failed attempt retained");
    const carried = evaluate(
      CASES.find((entry) => entry.name.startsWith("A3b"))!.input,
      config,
      NOW,
    );
    expect(carried.notes.join("\n")).toContain("across a clean main merge");
    const overlap = evaluate(
      CASES.find((entry) => entry.name.startsWith("A3d"))!.input,
      config,
      NOW,
    );
    expect(overlap.notes.join("\n")).toContain("Overlaps main");
    const waived = evaluate(
      CASES.find((entry) => entry.name.startsWith("A9d"))!.input,
      config,
      NOW,
    );
    expect(waived.notes).toContain("1 unattributed RESULT post waived");
  });
});

/** The rule `prstatus.sh` used: the last RESULT anywhere says `0 new`. */
const legacyCandidate = (posts: Post[]) =>
  /(^|[^0-9])0\s*new([^a-z]|$)/iu.test(result(posts.at(-1)!));

test("the gate refuses what the legacy last-RESULT rule called a candidate (#384)", () => {
  const posts = [
    confirm("rev-opus", SHA.reviewed),
    confirm("rev2", SHA.fixed),
    confirm("rev-astra", SHA.fixed),
  ];
  expect(legacyCandidate(posts)).toBe(true);
  const verdict = evaluate(
    input({
      head: SHA.fixed,
      posts,
      copies: { [SHA.reviewed]: { kind: "outdated" } },
    }),
    config,
    NOW,
  );
  expect(verdict.state).toBe("NOT_READY");
});

test("a claim whose copy result is missing is unknown, never counted", () => {
  const verdict = evaluate(
    input({
      head: SHA.merged,
      commits: [SHA.fixed, SHA.merged],
      posts: [
        confirm("rev2", SHA.fixed),
        confirm("rev-astra", SHA.merged),
        confirm("rev-opus", SHA.merged),
      ],
    }),
    config,
    NOW,
  );
  expect(verdict.state).toBe("UNKNOWN");
  expect(
    verdict.conditions.find((entry) => entry.id === "review:rev2")?.state,
  ).toBe("unknown");
});

test("the worst condition decides, in a fixed order", () => {
  const states: ConditionState[] = [
    "met",
    "waiting",
    "unknown",
    "judgment",
    "unmet",
  ];
  const expected = [
    "READY",
    "WAITING",
    "UNKNOWN",
    "NEEDS_JUDGMENT",
    "NOT_READY",
  ];
  // Every combination of present states: the worst one present wins.
  for (let mask = 1; mask < 1 << states.length; mask++) {
    const present = states.filter((_, index) => mask & (1 << index));
    const worst = Math.max(...present.map((state) => states.indexOf(state)));
    expect(
      verdictState(present.map((state) => ({ id: state, state, detail: "" }))),
    ).toBe(expected[worst] as ReturnType<typeof verdictState>);
  }
});

test("closed pull requests and unread heads never become READY", () => {
  const closed = input({ head: SHA.fixed, posts: [], state: "CLOSED" });
  expect(evaluate(closed, config, NOW).state).toBe("CLOSED");
  const unread = { ...closed, state: "OPEN" as const, item: undefined };
  expect(evaluate(unread, config, NOW).state).toBe("UNKNOWN");
});

test("a per-PR reviewer set wins over pod and default", () => {
  const entry = input({
    head: SHA.fixed,
    posts: [confirm("rev-opus", SHA.fixed)],
  });
  const verdict = evaluate(
    entry,
    {
      ...config,
      reviewers: {
        default: ["rev2"],
        pods: { town: ["rev5"] },
        prs: { "7": ["rev-opus"] },
      },
    },
    NOW,
  );
  expect(verdict.state).toBe("READY");
});
