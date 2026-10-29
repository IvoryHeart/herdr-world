import { afterEach, describe, expect, test } from "bun:test";
import { NOW, SHA } from "./gate/cases";
import { fixture, cleanupFixtures } from "./crew-round-fixture";
import { preserveRoundAction, QUIET_MS } from "./crew/round-policy";
import {
  recordPush,
  reviewCycles,
  skippedPushes,
} from "./crew/round-policy-store";

afterEach(cleanupFixtures);

describe("review round admission", () => {
  test("a merge of main records a skip and never supersedes a running reviewer", () => {
    const f = fixture();
    f.main();
    const actions = f.pass();
    expect(actions.some((action) => action.kind === "confirm")).toBe(false);
    expect(skippedPushes(f.db, 7)[0]!.reason).toContain(
      "only a merge of origin/main",
    );
    expect(
      preserveRoundAction(
        {
          key: "run",
          pr: 7,
          head: SHA.reviewed,
          kind: "review",
          target: "rev2",
          text: "",
        },
        true,
      ),
    ).toBe(true);
    expect(reviewCycles(f.db, 7)).toHaveLength(1);
  });

  test("an unrelated push is skipped until every finding is answered, then confirmed after quiet", () => {
    const f = fixture();
    f.setFiles(["src/unrelated.ts"]);
    f.pass();
    f.pass(undefined, NOW + QUIET_MS);
    expect(reviewCycles(f.db, 7)).toHaveLength(1);
    expect(skippedPushes(f.db, 7)[0]!.reason).toContain(
      "no open finding's files",
    );
    f.reply();
    expect(
      f
        .pass(undefined, NOW + QUIET_MS)
        .some((action) => action.kind === "confirm"),
    ).toBe(true);
  });

  test("unanswered CI pushes wait; replies can trigger their scoped confirmation", () => {
    const f = fixture();
    f.setFiles([
      ".github/workflows/ci.yml",
      "web/src/world/testing/fixture.ts",
    ]);
    f.pass();
    f.pass(undefined, NOW + QUIET_MS);
    expect(skippedPushes(f.db, 7)[0]!.reason).toContain("CI or test-harness");
    expect(reviewCycles(f.db, 7)).toHaveLength(1);
    f.reply();
    expect(
      f
        .pass(undefined, NOW + QUIET_MS)
        .some((action) => action.kind === "confirm"),
    ).toBe(true);
  });

  test("round 2 requires all finding replies and ten quiet minutes, with a durable trigger", () => {
    const f = fixture();
    f.pass();
    f.pass(undefined, NOW + QUIET_MS);
    expect(reviewCycles(f.db, 7)).toHaveLength(1);
    f.reply();
    const actions = f.pass(undefined, NOW + QUIET_MS);
    const next = reviewCycles(f.db, 7).at(-1)!;
    expect(next).toMatchObject({
      ordinal: 2,
      since: SHA.reviewed,
      head: SHA.fixed,
      trigger: {
        quietSince: NOW,
        reason: "all finding replies and quiet period",
      },
    });
    expect(next.trigger.replies[0]).toContain("rev2:101:1");
    expect(actions.find((action) => action.target === "rev2")).toMatchObject({
      kind: "confirm",
      since: SHA.reviewed,
    });
    expect(
      skippedPushes(f.db, 7).some((push) => push.reason.includes("reply")),
    ).toBe(true);
    f.pass(undefined, NOW + QUIET_MS + 1);
    expect(reviewCycles(f.db, 7)).toHaveLength(2);
  });

  test("a new push restarts the quiet period and an incomplete previous round waits", () => {
    const f = fixture();
    f.reply();
    f.pass();
    f.pass(f.value(SHA.other), NOW + QUIET_MS - 1);
    f.pass(f.value(SHA.other), NOW + QUIET_MS);
    expect(reviewCycles(f.db, 7)).toHaveLength(1);
    const incomplete = { ...f.value(), history: [] };
    f.pass(incomplete, NOW + 2 * QUIET_MS);
    expect(
      skippedPushes(f.db, 7).some(
        (push) => push.reason === "previous round still running",
      ),
    ).toBe(true);
  });

  test("dry runs record neither skipped pushes nor round admission", () => {
    const f = fixture();
    f.reply();
    f.pass(undefined, NOW, true);
    expect(skippedPushes(f.db, 7)).toEqual([]);
    expect(reviewCycles(f.db, 7)).toHaveLength(1);
    recordPush(f.db, 7, SHA.fixed, NOW, "synthetic evidence");
    expect(skippedPushes(f.db, 7)).toHaveLength(1);
  });

  test("incomplete GitHub replies cannot open a new round", () => {
    const f = fixture();
    const original = f.deps.run;
    f.deps.run = (argv) =>
      argv[0] === "gh"
        ? { code: 1, stdout: "", stderr: "unavailable" }
        : original(argv);
    expect(f.pass().some((action) => action.kind === "judgment")).toBe(false);
    expect(reviewCycles(f.db, 7)).toHaveLength(1);
  });

  test("explanatory replies can trigger a scoped confirmation on the same head", () => {
    const f = fixture();
    f.pass(f.value(SHA.reviewed));
    f.reply();
    const actions = f.pass(f.value(SHA.reviewed), NOW + QUIET_MS);
    expect(reviewCycles(f.db, 7).at(-1)).toMatchObject({
      ordinal: 2,
      head: SHA.reviewed,
      since: SHA.reviewed,
    });
    expect(
      actions.some(
        (action) =>
          action.kind === "confirm" && action.key.endsWith(":round-2"),
      ),
    ).toBe(true);
  });
});
