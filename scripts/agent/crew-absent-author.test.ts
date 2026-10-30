import { afterEach, expect, test } from "bun:test";
import { cleanupDeliveries, setup } from "./crew-round-delivery-fixture";
import { NOW, SHA } from "./gate/cases";
import { activeRuns, addRun, finishRun } from "./crew/store";

afterEach(cleanupDeliveries);

function absentAuthor(neverPrompt: string[] = []) {
  const f = setup({
    seedCycle: false,
    roster: { builder: { model: "claude-opus-5-5" } },
    neverPrompt,
  });
  const original = f.deps.run;
  let dirty = false;
  f.deps.run = (argv) => {
    const result = original(argv);
    if (
      argv[0] === "git" &&
      argv.includes("--porcelain") &&
      argv.includes("list")
    )
      return {
        code: 0,
        stdout: `worktree /synthetic/pr-worktree\nHEAD ${SHA.reviewed}\nbranch refs/heads/agent/builder-7\n\n`,
        stderr: "",
      };
    if (argv[0] === "git" && argv.includes("status"))
      return { code: 0, stdout: dirty ? " M synthetic.ts\n" : "", stderr: "" };
    if (argv[0] === "git" && argv.includes("rev-parse"))
      return { code: 0, stdout: SHA.reviewed, stderr: "" };
    return result;
  };
  const asks = () =>
    f.calls.filter(
      (argv) =>
        argv[0] === "herdr-world" &&
        argv[1] === "ask" &&
        !["get", "withdraw"].includes(argv[2]!),
    );
  return {
    ...f,
    asks,
    dirty: () => {
      dirty = true;
    },
  };
}

test("an absent author gets one fresh fixer without requiring an earlier prompt elsewhere", () => {
  const f = absentAuthor();
  f.pass();
  f.pass(SHA.reviewed, NOW + 60_000);
  expect(f.spawned.map((argv) => argv[2])).toEqual(["fix"]);
  expect(f.spawned[0]).toContain("builder");
  expect(activeRuns(f.crew)[0]).toMatchObject({
    reviewer: "builder",
    cwd: "/synthetic/pr-worktree",
    head: SHA.reviewed,
  });
  expect(f.asks()).toEqual([]);
  expect(
    f.calls.some((argv) => argv[0] === "herdr" && argv[2] === "prompt"),
  ).toBe(false);
});

test("an absent author's fixer waits for a run slot and starts when one is free", () => {
  const f = absentAuthor();
  const id = addRun(
    f.crew,
    {
      actionKey: "other-review",
      pr: 8,
      head: SHA.other,
      reviewer: "rev2",
      log: "synthetic.log",
    },
    NOW,
  );
  f.pass();
  expect(f.spawned).toEqual([]);
  expect(f.asks()).toEqual([]);
  finishRun(f.crew, id, 0, null, NOW + 1);
  f.pass(SHA.reviewed, NOW + 60_000);
  expect(f.spawned.map((argv) => argv[2])).toEqual(["fix"]);
});

test("a missing seat does not bypass the clean worktree requirement", () => {
  const f = absentAuthor();
  f.dirty();
  f.pass();
  expect(f.spawned).toEqual([]);
  expect(f.asks()).toHaveLength(1);
});

test("a missing never-prompt seat is not replaced by a fixer", () => {
  const f = absentAuthor(["builder"]);
  f.pass();
  expect(f.spawned).toEqual([]);
  expect(f.asks()).toHaveLength(1);
});
