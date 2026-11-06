import { afterEach, expect, test } from "bun:test";
import { cleanupFixtures, fixture } from "./crew-round-fixture";
import { NOW, SHA } from "./gate/cases";
import { QUIET_MS } from "./crew/round-policy";
import { reviewCycles, evaluations } from "./crew/round-policy-store";
import { reviewerArgv, reviewerPrompt } from "./crew/worker";

afterEach(cleanupFixtures);
const settings = {
  convergingReviews: true,
  reviewerSessions: { "7": { rev2: "retained-session" } },
};

test("adopting an older manual RESULT cannot bypass replies or the real quiet period", () => {
  const f = fixture(1, settings);
  f.db.exec("DELETE FROM review_cycle");
  expect(f.pass().some((action) => action.kind === "confirm")).toBe(false);
  expect(reviewCycles(f.db, 7)[0]?.head).toBe(SHA.reviewed);
  f.reply();
  expect(
    f
      .pass(undefined, NOW + QUIET_MS - 1)
      .some((action) => action.kind === "confirm"),
  ).toBe(false);
  expect(
    f
      .pass(undefined, NOW + QUIET_MS)
      .some((action) => action.kind === "confirm"),
  ).toBe(true);
});

test("round two admits a scoped third round without a fresh evaluator", () => {
  const f = fixture(2, settings);
  f.reply();
  f.pass();
  const actions = f.pass(undefined, NOW + QUIET_MS);
  expect(actions.find((action) => action.kind === "confirm")).toMatchObject({
    target: "rev2",
    since: SHA.reviewed,
  });
  expect(actions.some((action) => action.kind === "evaluate")).toBe(false);
  expect(evaluations(f.db, 7)).toHaveLength(0);
  expect(reviewCycles(f.db, 7).at(-1)?.ordinal).toBe(3);
});

test("unresolved round three sends its actual finding list to firstmate and cannot start round four", () => {
  const f = fixture(3, settings);
  f.reply();
  f.pass();
  const actions = f.pass(undefined, NOW + QUIET_MS);
  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({ kind: "judgment", target: "firstmate-2" });
  expect(actions[0]!.text).toContain("rev2:101:1");
  expect(actions[0]!.text).toContain("broken recovery");
  expect(reviewCycles(f.db, 7)).toHaveLength(1);
  expect(evaluations(f.db, 7)).toHaveLength(0);
});

test("missing retained identity holds confirmation instead of rotating the reviewer", () => {
  const f = fixture(1, { convergingReviews: true });
  f.reply();
  f.pass();
  const actions = f.pass(undefined, NOW + QUIET_MS);
  expect(actions.some((action) => action.kind === "confirm")).toBe(false);
  expect(
    actions.some(
      (action) =>
        action.kind === "judgment" &&
        action.text.includes("Retained reviewer continuity"),
    ),
  ).toBe(true);
});

test("both harnesses resume the exact saved reviewer in the fresh checkout", () => {
  const sol = reviewerArgv(
    { model: "gpt-6.1-sol", harness: "codex" },
    "confirm",
    null,
    "saved-sol",
    "/synthetic/review",
  );
  expect(sol.slice(0, 3)).toEqual(["codex", "resume", "saved-sol"]);
  expect(sol.slice(-3)).toEqual(["--cd", "/synthetic/review", "confirm"]);
  const opus = reviewerArgv(
    { model: "claude-opus-5-5", harness: "claude" },
    "confirm",
    "new-unused",
    "saved-opus",
  );
  expect(opus).toContain("--resume");
  expect(opus).toContain("saved-opus");
  expect(opus).not.toContain("--session-id");
  expect(opus).not.toContain("new-unused");
});

test("review brief requires a complete first pass, scoped confirmations and explained untouched-code P1s", () => {
  const prompt = reviewerPrompt({
    repo: "example-org/widgets",
    pr: 7,
    head: SHA.fixed,
    reviewer: "rev2",
    title: "Recovery",
    url: "https://example.invalid/pr/7",
    branch: "agent/recovery",
    author: "builder",
    converging: true,
  });
  expect(prompt).toContain("first pass is COMPLETE");
  expect(prompt).toContain("untouched code is OUT OF SCOPE unless it is P1");
  expect(prompt).toContain("why the first complete pass missed it");
  expect(prompt).toContain("same reviewer identity and notes");
  expect(prompt).toContain("READ-ONLY");
  expect(prompt).not.toContain("herdr-world ask");
});

test("React/tooling fixture-only paths need no UI captures; actual visible changes and incomplete paths stay conservative", async () => {
  const { crewUiChange } = await import("./gate/observe");
  const files = (paths: string[]) => ({
    totalCount: paths.length,
    nodes: paths.map((path) => ({ path })),
  });
  expect(
    crewUiChange(
      files([
        "docs/react-version.md",
        "scripts/benchmark-react.ts",
        "web/src/world/SharedViewCreation.browser.tsx",
        "web/src/world/testing/browserBundles.ts",
      ]),
    ),
  ).toBe(false);
  expect(
    crewUiChange(
      files([
        "web/src/world/testing/browserBundles.ts",
        "web/src/world/WorldLoader.tsx",
      ]),
    ),
  ).toBe(true);
  expect(crewUiChange(files(["site/index.html"]))).toBe(true);
  expect(
    crewUiChange({ totalCount: 2, nodes: [{ path: "docs/guide.md" }] }),
  ).toBeNull();
  expect(crewUiChange({ totalCount: 1, nodes: [{}] })).toBeNull();
});
