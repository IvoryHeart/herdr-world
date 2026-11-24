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
    10,
  );
  expect(decisions).toEqual([
    { id: 1, action: "keep", reason: "tests the identical tree" },
    { id: 2, action: "cancel", reason: "tests a different tree" },
    { id: 3, action: "cancel", reason: "has not recorded its tree yet" },
  ]);
  // An unreadable tree is treated as unknown, as before this check existed.
  expect(
    await supersede(
      [run(6)],
      head,
      tree,
      async () => {
        throw new Error("API unavailable");
      },
      10,
    ),
  ).toEqual([
    { id: 6, action: "cancel", reason: "has not recorded its tree yet" },
  ]);
});

test("a handler never cancels a run created after its own, whatever the delivery order", async () => {
  // Push A's handler (run 20) sees push B's queued CI (run 21): GitHub may
  // deliver A's event late, and B's tree is not recorded yet.
  const read: number[] = [];
  const decisions = await supersede(
    [run(21, "queued", "d".repeat(40)), run(19, "in_progress")],
    head,
    tree,
    async (id) => {
      read.push(id);
      return undefined;
    },
    20,
  );
  expect(decisions).toEqual([
    { id: 19, action: "cancel", reason: "has not recorded its tree yet" },
  ]);
  expect(read).toEqual([19]);
});
