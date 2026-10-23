import { expect, test } from "bun:test";
import { judge, parseDelta } from "./web-asset-headroom";

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
});
