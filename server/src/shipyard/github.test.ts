import { expect, test } from "bun:test";
import { readShipyardGitHub } from "./github";
import { githubFixture, MAIN_SHA, MERGE_SHA } from "./testing/fixture";
import { SHIPYARD_LIMITS as L } from "../../../shared/shipyard";
import type { RunProcess } from "../sources/github";

test("waiting PRs are all-author merge commits in the pinned release-to-main graph", async () => {
  const fixture = githubFixture();
  const result = await readShipyardGitHub(fixture.run, "example-org/widgets");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.main.sha).toBe(MAIN_SHA);
  expect(result.data.main.health).toBe("pass");
  expect(result.data.waiting.complete).toBe(true);
  expect(result.data.waiting.pullRequests.map((pr) => pr.number)).toEqual([42]);
  expect(result.data.waiting.commits).toEqual([MERGE_SHA]);
  expect(result.data.waiting.baseline?.tag).toBe("v1.0.0");
  expect(result.data.releases.items.map((r) => r.channel)).toEqual([
    "prerelease",
    "stable",
  ]);
  expect(
    fixture.calls.some((argv) => argv.join(" ").includes(`...${MAIN_SHA}`)),
  ).toBe(true);
  expect(
    fixture.calls.every(
      (argv) =>
        argv[1] === "auth" || argv.includes("GET") || argv.includes("graphql"),
    ),
  ).toBe(true);
});

test("a workflow from an old head never turns current main green", async () => {
  const result = await readShipyardGitHub(
    githubFixture("old-head").run,
    "example-org/widgets",
  );
  expect(result.ok && result.data.main.health).toBe("unknown");
});

test("latest workflow attempts determine pending/failure, and returned URLs are safe", async () => {
  for (const conclusion of ["failure", null]) {
    const fixture = githubFixture();
    const result = await readShipyardGitHub(async (argv, timeout) => {
      const response = await fixture.run(argv, timeout);
      if (argv.at(-1)?.includes("/actions/runs?")) {
        const body = JSON.parse(response.stdout);
        const first = body.workflow_runs[0];
        body.total_count = 2;
        body.workflow_runs = [
          first,
          {
            ...first,
            id: 18,
            run_attempt: 2,
            status: conclusion === null ? "queued" : "completed",
            conclusion,
            html_url: "https://example.com/private",
          },
        ];
        response.stdout = JSON.stringify(body);
      }
      return response;
    }, "example-org/widgets");
    expect(result.ok && result.data.main.health).toBe(
      conclusion === null ? "pending" : "fail",
    );
    expect(result.ok && result.data.main.workflows.items[0]!.id).toBe(18);
    expect(JSON.stringify(result)).not.toContain("example.com/private");
  }
});

test("no published release is an unknown baseline, never an empty complete queue", async () => {
  const result = await readShipyardGitHub(
    githubFixture("empty").run,
    "example-org/widgets",
  );
  expect(result.ok && result.data.waiting.state).toBe("no_baseline");
  expect(result.ok && result.data.waiting.complete).toBe(false);
});

test("shortened comparisons preserve witnesses without claiming a complete queue", async () => {
  const result = await readShipyardGitHub(
    githubFixture("limited").run,
    "example-org/widgets",
  );
  expect(result.ok && result.data.waiting.state).toBe("limited");
  expect(result.ok && result.data.waiting.complete).toBe(false);
});

test("diverged main and failed optional Actions reads are explicit", async () => {
  const result = await readShipyardGitHub(
    githubFixture("diverged").run,
    "example-org/widgets",
  );
  expect(result.ok && result.data.waiting.state).toBe("diverged");
  const noActions = await readShipyardGitHub(
    githubFixture("no-actions").run,
    "example-org/widgets",
  );
  expect(noActions.ok && noActions.data.main.health).toBe("unknown");
  expect(noActions.ok && noActions.data.main.workflows.complete).toBe(false);
});

test("latest stable is retained beyond the release display window and drafts never ship", async () => {
  const fixture = githubFixture();
  const result = await readShipyardGitHub(async (argv, timeout) => {
    const response = await fixture.run(argv, timeout);
    if (argv.at(-1)?.includes("/releases?")) {
      const candidate = JSON.parse(response.stdout)[0];
      response.stdout = JSON.stringify(
        Array.from({ length: L.releases }, (_, i) => ({
          ...candidate,
          id: i + 2,
          tag_name: `v1.1.0-rc.${i + 1}`,
        })),
      );
    }
    return response;
  }, "example-org/widgets");
  expect(result.ok && result.data.releases.items.length).toBe(L.releases);
  expect(result.ok && result.data.releases.complete).toBe(false);
  expect(result.ok && result.data.waiting.baseline?.tag).toBe("v1.0.0");
  expect(result.ok && result.data.waiting.complete).toBe(true);
});

test("shortened PR associations and missing merge identities cannot prove an empty queue", async () => {
  for (const missing of [false, true]) {
    const fixture = githubFixture();
    const result = await readShipyardGitHub(async (argv, timeout) => {
      const response = await fixture.run(argv, timeout);
      if (argv.includes("graphql")) {
        const body = JSON.parse(response.stdout);
        if (missing)
          body.data.repository.c0.associatedPullRequests.nodes[0].mergeCommit =
            null;
        else
          body.data.repository.c0.associatedPullRequests.pageInfo.hasNextPage = true;
        response.stdout = JSON.stringify(body);
      }
      return response;
    }, "example-org/widgets");
    expect(result.ok && result.data.waiting.complete).toBe(false);
    expect(result.ok && result.data.waiting.state).toBe("limited");
  }
});

test("sign-in failures, malformed data and oversized output never echo subprocess text", async () => {
  const failures: RunProcess[] = [
    async () => {
      throw Object.assign(new Error("private host"), { code: "ENOENT" });
    },
    async () => ({
      code: 127,
      stdout: "private credential",
      stderr: "private host",
    }),
    async () => ({
      code: 1,
      stdout: "private credential",
      stderr: "private host",
    }),
    async (argv) => ({
      code: 0,
      stdout: argv[1] === "auth" ? "" : "private malformed JSON",
      stderr: "",
    }),
    async () => ({
      code: 0,
      stdout: "x".repeat(L.outputBytes + 1),
      stderr: "private host",
    }),
  ];
  for (const run of failures) {
    const result = await readShipyardGitHub(run, "example-org/widgets");
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private");
  }
});

test("one shared deadline bounds requests and leaves unavailable sections explicit", async () => {
  const fixture = githubFixture();
  let clock = 0;
  const timeouts: number[] = [];
  const result = await readShipyardGitHub(
    async (argv, timeout) => {
      timeouts.push(timeout);
      clock += 9_000;
      return fixture.run(argv, timeout);
    },
    "example-org/widgets",
    () => clock,
  );
  expect(result.ok).toBe(true);
  expect(result.ok && result.data.waiting.complete).toBe(false);
  expect(fixture.calls.length).toBeLessThanOrEqual(7);
  expect(timeouts.every((ms) => ms > 0 && ms <= L.requestMs)).toBe(true);
});
