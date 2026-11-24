import { expect, test } from "bun:test";
import { mainRun, sealedArtifact, waitForMain } from "./release-walk-gate";

const sha = "a".repeat(40);
const run = {
  id: 1,
  head_sha: sha,
  head_branch: "main",
  event: "push",
  status: "in_progress",
  conclusion: null,
  run_attempt: 1,
};

test("select exact main push even while queued, never another branch or dispatch", () => {
  expect(mainRun([run], sha)).toEqual(run);
  for (const changed of [
    { head_sha: "b".repeat(40) },
    { head_branch: "release/next" },
    { event: "workflow_dispatch" },
  ])
    expect(mainRun([{ ...run, ...changed }], sha)).toBeUndefined();
  expect(mainRun([{ ...run, id: 2 }, run], sha)?.id).toBe(2);
});

test("only a unique live sealed artifact can bypass a complete rebuild", () => {
  const artifact = { id: 4, name: "verified-release", expired: false };
  expect(sealedArtifact([artifact])).toEqual(artifact);
  expect(sealedArtifact([{ ...artifact, expired: true }])).toBeUndefined();
  expect(sealedArtifact([{ ...artifact, name: "archives" }])).toBeUndefined();
  expect(sealedArtifact([])).toBeUndefined();
  expect(() => sealedArtifact([artifact, { ...artifact, id: 5 }])).toThrow(
    "Ambiguous",
  );
});

test("early tags wait through missing, queued and running CI and its one infrastructure retry", async () => {
  const green = {
    ...run,
    status: "completed",
    conclusion: "success",
    run_attempt: 2,
  };
  const states = [
    [],
    [{ ...run, status: "queued" }],
    [run],
    [{ ...run, status: "completed", conclusion: "failure" }],
    [{ ...run, run_attempt: 2 }],
    [green],
  ];
  let tick = 0;
  const selected = await waitForMain(
    sha,
    async () => states.shift()!,
    async () => {
      tick += 30_000;
    },
    () => tick,
  );
  expect(selected).toEqual(green);
  expect(tick).toBe(150_000);
  for (const attempt of [1, 2]) {
    tick = 0;
    await expect(
      waitForMain(
        sha,
        async () => [
          {
            ...run,
            status: "completed",
            conclusion: "failure",
            run_attempt: attempt,
          },
        ],
        async () => {
          tick += 60_000;
        },
        () => tick,
      ),
    ).rejects.toThrow("Main CI failed");
  }
  tick = 0;
  await expect(
    waitForMain(
      sha,
      async () => [],
      async () => {
        tick += 350 * 60_000;
      },
      () => tick,
    ),
  ).rejects.toThrow("timed out");
});
