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
  let missing = false;
  let head = SHA.reviewed;
  f.deps.run = (argv) => {
    const result = original(argv);
    if (
      argv[0] === "git" &&
      argv.includes("--porcelain") &&
      argv.includes("list")
    )
      return {
        code: 0,
        stdout: missing
          ? ""
          : `worktree /synthetic/pr-worktree\nHEAD ${head}\nbranch refs/heads/agent/builder-7\n\n`,
        stderr: "",
      };
    if (argv[0] === "git" && argv.includes("status"))
      return { code: 0, stdout: dirty ? " M synthetic.ts\n" : "", stderr: "" };
    if (argv[0] === "git" && argv.includes("rev-parse"))
      return { code: 0, stdout: head, stderr: "" };
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
    block: (kind: string) => {
      dirty = kind === "dirty";
      missing = kind === "missing";
      head = kind === "head" ? SHA.other : SHA.reviewed;
    },
  };
}

test.each([
  { code: 1, stdout: "", stderr: "unavailable" },
  { code: 0, stdout: "not json", stderr: "" },
  { code: 0, stdout: '{"result":{}}', stderr: "" },
  { code: 0, stdout: '{"result":{"agents":{}}}', stderr: "" },
  { code: 0, stdout: '{"result":{"agents":[null]}}', stderr: "" },
  { code: 0, stdout: '{"result":{"agents":[{"name":42}]}}', stderr: "" },
])("an unreadable seat inventory never authorizes a fixer: %j", (inventory) => {
  const f = absentAuthor();
  const original = f.deps.run;
  f.deps.run = (argv) => {
    const result = original(argv);
    return argv[0] === "herdr" && argv[2] === "list" ? inventory : result;
  };
  f.pass();
  f.pass(SHA.reviewed, NOW + 60_000);
  expect(f.spawned).toEqual([]);
  expect(
    f.calls.some((argv) => argv[0] === "herdr" && argv[2] === "prompt"),
  ).toBe(false);
  f.deps.run = original;
  f.pass(SHA.reviewed, NOW + 120_000);
  expect(f.spawned.map((argv) => argv[2])).toEqual(["fix"]);
});

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

test.each([
  ["dirty", "its worktree has uncommitted changes"],
  ["missing", "no worktree has agent/builder-7 checked out"],
  ["head", "its worktree isn't at the PR's head"],
])(
  "a capacity wait escalates once when the fixer is blocked by %s",
  (kind, why) => {
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
    expect(f.asks()).toEqual([]);
    finishRun(f.crew, id, 0, null, NOW + 1);
    f.block(kind!);
    f.pass(SHA.reviewed, NOW + 60_000);
    f.pass(SHA.reviewed, NOW + 120_000);
    expect(f.spawned).toEqual([]);
    expect(f.asks()).toHaveLength(1);
    expect(f.asks()[0]![2]).toContain(why!);
    f.block("clear");
    f.pass(SHA.reviewed, NOW + 180_000);
    expect(f.spawned.map((argv) => argv[2])).toEqual(["fix"]);
    expect(
      f.calls.some((argv) => argv[1] === "ask" && argv[2] === "withdraw"),
    ).toBe(true);
  },
);

test("a missing never-prompt seat is not replaced by a fixer", () => {
  const f = absentAuthor(["builder"]);
  f.pass();
  expect(f.spawned).toEqual([]);
  expect(f.asks()).toHaveLength(1);
});
