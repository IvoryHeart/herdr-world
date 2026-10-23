import { expect, test } from "bun:test";
import {
  CONTEXT,
  judge,
  mainDescription,
  parseDelta,
  parseMain,
  settleVerdict,
} from "./web-asset-headroom";

const MiB = 1024 * 1024;
const budget = { files: 150, bytes: 13.25 * MiB };

test("a PR is judged against current main plus its own delta", () => {
  // Fit the main it was tested on, but not the main it would merge into.
  const delta = { files: 1, bytes: 60 * 1024 };
  expect(judge({ files: 131, bytes: 13.1 * MiB }, delta, budget).state).toBe(
    "success",
  );
  const later = judge({ files: 144, bytes: 13.2 * MiB }, delta, budget);
  expect(later.state).toBe("failure");
  expect(later.description).toContain("over budget");
  expect(later.description.length).toBeLessThanOrEqual(140);
});

test("above 95% of a budget the status warns but passes", () => {
  const close = judge(
    { files: 120, bytes: 12.7 * MiB },
    { files: 0, bytes: 0 },
    budget,
  );
  expect(close.state).toBe("success");
  expect(close.description).toContain("warning: 96% of budget");
  // File count counts too.
  expect(
    judge({ files: 150, bytes: MiB }, { files: 1, bytes: 0 }, budget).state,
  ).toBe("failure");
});

test("the recorded delta round-trips through the status description", () => {
  const { description } = judge(
    { files: 140, bytes: 13 * MiB },
    { files: -2, bytes: -4096 },
    budget,
  );
  expect(parseDelta(description)).toEqual({ files: -2, bytes: -4096 });
  expect(parseDelta("something else")).toBeUndefined();
  // Main's own record is not a PR delta, and round-trips separately.
  const main = mainDescription({ files: 144, bytes: 13937949 });
  expect(parseDelta(main)).toBeUndefined();
  expect(parseMain(main)).toEqual({ files: 144, bytes: 13937949 });
});

test("the workflow judges PRs and re-judges them on every main push", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(
      new URL("../.github/workflows/web-asset-headroom.yml", import.meta.url),
    ).text(),
  ) as any;
  expect(workflow.on.push).toEqual({ branches: ["main"] });
  expect(workflow.permissions.statuses).toBe("write");
  const runs = workflow.jobs.headroom.steps.map((step: any) => step.run);
  expect(runs).toContain("bun scripts/web-asset-headroom.ts pr");
  expect(runs).toContain("bun scripts/web-asset-headroom.ts main");
  // The PR job compares the merge with its first parent, the base.
  expect(workflow.jobs.headroom.steps[0].with["fetch-depth"]).toBe(2);
  // The job must not share the status's name, or requiring that name could
  // be satisfied by a job that exited 0.
  expect(workflow.jobs.headroom.name).not.toBe(CONTEXT);
  const pr = workflow.jobs.headroom.steps.find(
    (step: any) => step.run === "bun scripts/web-asset-headroom.ts pr",
  );
  expect(pr.env.PR_FROM_FORK).toContain(
    "head.repo.full_name != github.repository",
  );
});

test("main advancing before the PR's last post cannot leave a stale pass", async () => {
  const delta = { files: 0, bytes: 100 * 1024 };
  const base = { files: 140, bytes: 13 * MiB };
  // Main moves twice while the PR run posts; each new tip's size is recorded
  // (its own run re-judged open PRs, which this run's posts could overwrite).
  const tips = ["main-2", "main-3", "main-3"];
  const sizes: Record<string, { files: number; bytes: number }> = {
    "main-2": { files: 142, bytes: 13.1 * MiB },
    "main-3": { files: 144, bytes: 13.24 * MiB },
  };
  const posts: string[] = [];
  const verdict = await settleVerdict({
    baseSha: "main-1",
    base,
    delta,
    readTip: async () => tips.shift()!,
    readMainSize: async (sha) => sizes[sha],
    post: async (state) => {
      posts.push(state);
    },
  });
  expect(verdict.state).toBe("failure");
  // The last post is the verdict against the newest main.
  expect(posts.at(-1)).toBe("failure");
});

test("a new tip without a recorded size is left to main's own run", async () => {
  const posts: string[] = [];
  const verdict = await settleVerdict({
    baseSha: "main-1",
    base: { files: 140, bytes: 13 * MiB },
    delta: { files: 0, bytes: 0 },
    readTip: async () => "main-2",
    readMainSize: async () => undefined,
    post: async (state) => {
      posts.push(state);
    },
  });
  expect(verdict.state).toBe("success");
  expect(posts).toEqual(["success"]);
});
