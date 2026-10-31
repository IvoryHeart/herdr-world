import { afterEach, expect, test } from "bun:test";
import { openCrewStore } from "./store";
import { config, input, NOW, SHA } from "../gate/cases";
import type { Run } from "../gate/observe";
import { cachedObserve, budgetIntervals } from "./github-cache";
import { GitHubPass } from "./github-requests";
import { readCrewPosts } from "./review-facts";
import { metaWithPrefix } from "./store";

const stores: ReturnType<typeof openCrewStore>[] = [];
const store = () => {
  const db = openCrewStore(":memory:");
  stores.push(db);
  return db;
};
afterEach(() => {
  for (const db of stores.splice(0)) db.close();
});
const json = (value: unknown) => ({
  code: 0,
  stdout: JSON.stringify(value),
  stderr: "",
});
const http = (value: unknown, headers = "", status = 200) => ({
  code: 0,
  stdout: `HTTP/2.0 ${status} OK\r\n${headers}\r\n${status === 304 ? "" : JSON.stringify(value)}`,
  stderr: "",
});

test("unchanged PR costs only quota and list; safety net and changed heads reread", () => {
  const db = store();
  let reads = 0;
  let head = "a";
  const run: Run = (argv) =>
    argv.includes("rate_limit")
      ? http({
          resources: {
            core: { remaining: 4000 },
            graphql: { remaining: 4000 },
          },
        })
      : json({
          data: {
            open: {
              issueCount: 1,
              nodes: [
                {
                  number: 7,
                  state: "OPEN",
                  headRefOid: head,
                  updatedAt: "today",
                },
              ],
            },
          },
        });
  const observe = () => {
    reads++;
    return [input({ head: SHA.reviewed, posts: [] })];
  };
  const pass = (now: number) => {
    const github = new GitHubPass(db, "example-org/widgets", run, now);
    const result = cachedObserve(
      db,
      { run: github.run, config, numbers: [], mirror: "unused", now },
      observe,
    );
    return { github, result };
  };
  const first = pass(NOW);
  expect(reads).toBe(1);
  const second = pass(NOW + 60_000);
  expect(reads).toBe(1);
  expect(second.github.calls).toBe(2);
  expect(second.result[0]?.item?.prObservation).toEqual(
    first.result[0]?.item?.prObservation,
  );
  pass(NOW + 10 * 60_000);
  expect(reads).toBe(2);
  head = "b";
  pass(NOW + 11 * 60_000);
  expect(reads).toBe(3);
});

test("finished jobs persist across passes; running jobs remain conditional", () => {
  const db = store();
  const seen: string[][] = [];
  const run: Run = (argv) => {
    if (argv.includes("rate_limit"))
      return http({ resources: { core: { remaining: 4000 } } });
    seen.push(argv);
    return http(
      {
        id: 12,
        status: argv.some((arg) => arg.endsWith("/12"))
          ? "completed"
          : "in_progress",
      },
      'ETag: "job"\r\n',
    );
  };
  for (const now of [NOW, NOW + 600_000]) {
    const pass = new GitHubPass(db, "example-org/widgets", run, now);
    pass.run(["gh", "api", "repos/example-org/widgets/actions/jobs/12"]);
    pass.run(["gh", "api", "repos/example-org/widgets/actions/jobs/13"]);
  }
  expect(
    seen.filter((args) => args.some((arg) => arg.endsWith("/12"))),
  ).toHaveLength(1);
  expect(seen.at(-1)).toContain('If-None-Match: "job"');
});

test("304 reuses the matching body and pagination counts each HTTP call", () => {
  const db = store();
  let reads = 0;
  const run: Run = (args) => {
    if (args.includes("rate_limit"))
      return http({ resources: { core: { remaining: 2000 } } });
    reads++;
    if (args.includes('If-None-Match: "page"')) return http(null, "", 304);
    const next = args.some((arg) => arg.includes("page=2"));
    return http(
      [{ id: next ? 2 : 1 }],
      `ETag: "page"\r\n${next ? "" : 'Link: <https://api.github.com/repos/example-org/widgets/issues/7/comments?page=2>; rel="next"\r\n'}`,
    );
  };
  const args = [
    "gh",
    "api",
    "--paginate",
    "--slurp",
    "repos/example-org/widgets/issues/7/comments",
  ];
  const first = new GitHubPass(db, "example-org/widgets", run, NOW);
  expect(JSON.parse(first.run(args).stdout)).toEqual([
    [{ id: 1 }],
    [{ id: 2 }],
  ]);
  expect(first.calls).toBe(3);
  const second = new GitHubPass(db, "example-org/widgets", run, NOW + 600_000);
  expect(JSON.parse(second.run(args).stdout)).toEqual([
    [{ id: 1 }],
    [{ id: 2 }],
  ]);
  expect(second.notModified).toBe(2);
  expect(reads).toBe(4);
});

test("quota thresholds lengthen both cadences without shortening configured intervals", () => {
  expect(budgetIntervals(1500, { interval: 300, busyInterval: 60 })).toEqual({
    interval: 300,
    busyInterval: 60,
  });
  expect(budgetIntervals(1499, { interval: 300, busyInterval: 60 })).toEqual({
    interval: 600,
    busyInterval: 120,
  });
  expect(budgetIntervals(200, { interval: 900, busyInterval: 180 })).toEqual({
    interval: 900,
    busyInterval: 180,
  });
});

test("round-policy replies follow the PR observation and remain inside the two-call unchanged pass", () => {
  const db = store();
  let updated = "first";
  let replyReads = 0;
  const run: Run = (argv) => {
    if (argv.includes("rate_limit"))
      return http({ resources: { core: { remaining: 4000 } } });
    if (argv.includes("graphql"))
      return json({
        data: {
          open: {
            issueCount: 1,
            nodes: [{ number: 7, state: "OPEN", updatedAt: updated }],
          },
        },
      });
    replyReads++;
    return http([], 'ETag: "replies"\r\n');
  };
  const pass = (now: number) => {
    const github = new GitHubPass(db, config.repo, run, now);
    cachedObserve(
      db,
      { run: github.run, config, numbers: [], mirror: "unused", now },
      () => [input({ head: SHA.reviewed, posts: [] })],
    );
    readCrewPosts(github.run, config.repo, 7);
    return github.calls;
  };
  expect(pass(NOW)).toBe(5);
  expect(pass(NOW + 60_000)).toBe(2);
  expect(replyReads).toBe(3);
  updated = "reply arrived";
  expect(pass(NOW + 120_000)).toBe(5);
  expect(replyReads).toBe(6);
  expect(pass(NOW + 120_000 + 600_000)).toBe(5);
});

test("completed run details are reused until the live run list reports a rerun", () => {
  const db = store();
  let attempt = 1;
  let status = "completed";
  let detailReads = 0;
  const run: Run = (argv) => {
    if (argv.includes("rate_limit"))
      return http({ resources: { core: { remaining: 4000 } } });
    const value = { id: 42, run_attempt: attempt, status };
    if (argv.some((arg) => arg.includes("head_sha=")))
      return http({ workflow_runs: [value] });
    detailReads++;
    return http(value);
  };
  const pass = () => {
    const github = new GitHubPass(db, config.repo, run, NOW);
    github.run(["gh", "api", `repos/${config.repo}/actions/runs?head_sha=abc`]);
    return JSON.parse(
      github.run(["gh", "api", `repos/${config.repo}/actions/runs/42`]).stdout,
    );
  };
  expect(pass().run_attempt).toBe(1);
  expect(pass().run_attempt).toBe(1);
  expect(detailReads).toBe(0);
  attempt = 2;
  status = "in_progress";
  expect(pass().run_attempt).toBe(2);
  expect(detailReads).toBe(1);
  status = "completed";
  expect(pass().run_attempt).toBe(2);
  expect(detailReads).toBe(1);
});

test("critical quota skips expensive reads for held or pending PRs and preserves their list identity", () => {
  const db = store();
  const nodes = [
    { number: 7, state: "OPEN", labels: { nodes: [{ name: "on-hold" }] } },
    { number: 8, state: "OPEN", labels: { nodes: [] } },
  ];
  let reads = 0;
  const result = cachedObserve(
    db,
    {
      run: () => json({ data: { open: { issueCount: 2, nodes } } }),
      config,
      numbers: [],
      mirror: "unused",
      now: NOW,
    },
    () => {
      reads++;
      return [];
    },
    { mergeOnly: true },
  );
  expect(reads).toBe(0);
  expect(result.map((entry) => entry.number)).toEqual([7, 8]);
  expect(result[0]?.labels).toContain("on-hold");
  expect(result.every((entry) => entry.historyComplete === false)).toBe(true);
});

test("dry-run transport does not write the crew cache", () => {
  const db = store();
  const github = new GitHubPass(
    db,
    config.repo,
    (argv) =>
      http(
        argv.includes("rate_limit")
          ? { resources: { core: { remaining: 4000 } } }
          : { id: 42, status: "completed" },
      ),
    NOW,
    false,
  );
  github.run(["gh", "api", `repos/${config.repo}/actions/jobs/42`]);
  expect(metaWithPrefix(db, "github:")).toHaveLength(0);
});

test("completed earlier-attempt pages are immutable, and failed REST reads cannot replace cached evidence", () => {
  const db = store();
  let reads = 0;
  let fail = false;
  const run: Run = (argv) => {
    if (argv.includes("rate_limit"))
      return http({ resources: { core: { remaining: 4000 } } });
    reads++;
    return fail
      ? { code: 1, stdout: "", stderr: "HTTP 503" }
      : http(
          { jobs: [{ id: 12, status: "completed" }] },
          'ETag: "attempt"\r\n',
        );
  };
  const path = `repos/${config.repo}/actions/runs/42/attempts/1/jobs?per_page=100`;
  new GitHubPass(db, config.repo, run, NOW).run(["gh", "api", path]);
  fail = true;
  const later = new GitHubPass(db, config.repo, run, NOW + 600_000);
  expect(later.run(["gh", "api", path]).code).toBe(0);
  expect(reads).toBe(1);
  const failed = later.run([
    "gh",
    "api",
    `repos/${config.repo}/actions/jobs/13`,
  ]);
  expect(failed.code).toBe(1);
  expect(
    metaWithPrefix(
      db,
      `github:rest:${config.repo}:repos/${config.repo}/actions/jobs/13`,
    ),
  ).toHaveLength(0);
});
