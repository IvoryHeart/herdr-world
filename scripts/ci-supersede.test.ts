import { expect, test } from "bun:test";
import { supersede } from "./ci-supersede";

const head = "b".repeat(40);
const tree = "f".repeat(40);
const run = (id: number, status = "in_progress", sha = "c".repeat(40)) => ({
  id,
  status,
  head_sha: sha,
});

test("a new commit keeps a run testing its identical tree and cancels the rest", async () => {
  const trees: Record<number, string | undefined> = {
    1: tree,
    2: "e".repeat(40),
    3: undefined,
  };
  const decisions = await supersede(
    [
      run(1),
      run(2),
      run(3, "queued"),
      run(4, "completed"),
      run(5, "in_progress", head),
    ],
    head,
    tree,
    async (id) => {
      if (id === 6) throw new Error("API unavailable");
      return trees[id];
    },
  );
  expect(decisions).toEqual([
    { id: 1, action: "keep", reason: "tests the identical tree" },
    { id: 2, action: "cancel", reason: "tests a different tree" },
    { id: 3, action: "cancel", reason: "has not recorded its tree yet" },
  ]);
  // An unreadable tree is treated as unknown, as before this check existed.
  expect(
    await supersede([run(6)], head, tree, async () => {
      throw new Error("API unavailable");
    }),
  ).toEqual([
    { id: 6, action: "cancel", reason: "has not recorded its tree yet" },
  ]);
});
