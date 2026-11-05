import { expect, test } from "bun:test";
import { freshPullRequestDetail } from "../../../shared/pullRequestFreshness";
import { refreshGitHub, type RunProcess } from "./github";
import { CheckoutResolver } from "./links";
import type { CachedDetail } from "./pullRequestDetail";
import { SourcesService } from "./service";

const HEAD = "a".repeat(40);
const NOW = Date.parse("2026-03-10T12:00:00Z");
const empty = { nodes: [], pageInfo: { hasNextPage: false } };
const node = (number: number) => ({
  number,
  title: "Synthetic budget change",
  url: `https://github.com/example-org/widgets/pull/${number}`,
  state: "OPEN",
  updatedAt: "2026-03-09T00:00:00Z",
  repository: { nameWithOwner: "example-org/widgets" },
  headRepository: { nameWithOwner: "example-org/widgets" },
  headRefName: `agent/change-${number}`,
  headRefOid: HEAD,
  baseRefName: "main",
  reviewDecision: "APPROVED",
  mergeable: "MERGEABLE",
  commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
});
const detail = {
  headRefOid: HEAD,
  body: "",
  author: { login: "synthetic-author" },
  headRef: null,
  files: { totalCount: 0, nodes: [] },
  commits: { nodes: [{ commit: { oid: HEAD } }] },
  latest: { nodes: [{ commit: { oid: HEAD, statusCheckRollup: null } }] },
  reviews: { nodes: [] },
  comments: { nodes: [] },
};

/** Measured-cost schedule: open work ~6s total, details 4s/batch, history 5s/page. */
function fixture(
  total = 400,
  mergedMs = 5_000,
  openMs = 2_000,
  authMs = 1_000,
) {
  let elapsed = 0;
  const calls: { query: string; timeout: number }[] = [];
  const config = { total, failPage: -1, count: true, dates: true };
  const run: RunProcess = async (argv, timeout) => {
    const query = argv.at(-1)!;
    calls.push({ query, timeout });
    const auth = argv[1] === "auth";
    const merged = query.includes("merged: search(");
    const details = query.includes("p0: repository");
    const cost = auth ? authMs : merged ? mergedMs : details ? 4_000 : openMs;
    elapsed += Math.min(cost, timeout);
    if (cost >= timeout)
      return { code: 1, stdout: "", stderr: "synthetic timeout" };
    if (auth) return { code: 0, stdout: "", stderr: "" };
    let data: Record<string, unknown>;
    if (merged) {
      const page = Number(/after: "page-(\d+)"/u.exec(query)?.[1] ?? 0);
      if (page === config.failPage)
        return { code: 1, stdout: "", stderr: "synthetic failure" };
      data = {
        merged: {
          ...(config.count ? { issueCount: config.total } : {}),
          nodes: Array.from(
            { length: Math.min(50, Math.max(0, config.total - page * 50)) },
            (_, i) => ({
              ...node(1_000 + page * 50 + i),
              state: "MERGED",
              mergedAt: config.dates
                ? `2026-03-0${9 - page}T08:00:00Z`
                : "invalid",
            }),
          ),
          pageInfo: {
            hasNextPage: (page + 1) * 50 < config.total,
            endCursor: `page-${page + 1}`,
          },
        },
      };
    } else if (details) {
      data = Object.fromEntries(
        [...query.matchAll(/p(\d+): repository/gu)].map((match) => [
          `p${match[1]}`,
          { pullRequest: detail },
        ]),
      );
    } else {
      data = {
        authored: {
          ...empty,
          nodes: Array.from({ length: 20 }, (_, i) => node(i + 1)),
        },
        reviewing: empty,
        assigned: empty,
        issues: empty,
      };
    }
    return { code: 0, stdout: JSON.stringify({ data }), stderr: "" };
  };
  return { run, calls, config, clock: () => elapsed };
}

test("400 merged PRs fit the measured schedule after both action-detail batches", async () => {
  const fx = fixture();
  const cache = new Map<string, CachedDetail>();
  const result = await refreshGitHub(fx.run, NOW, 7, fx.clock, cache);
  expect(result).toMatchObject({ ok: true, pullRequestsComplete: true });
  if (!result.ok) throw new Error(result.detail);
  expect(result.items).toHaveLength(420);
  expect(fx.clock()).toBe(55_000);
  expect(
    result.items
      .filter((item) => item.lane !== "merged")
      .every((item) => freshPullRequestDetail(item, NOW)),
  ).toBe(true);
  expect(
    fx.calls
      .slice(1, 4)
      .map(
        ({ query }) =>
          query.match(/(authored|reviewing|assigned): search/u)?.[1],
      ),
  ).toEqual(["authored", "reviewing", "assigned"]);
  expect(
    fx.calls.slice(4, 6).every(({ query }) => query.includes("p0: repository")),
  ).toBe(true);
  expect(
    fx.calls.slice(6).every(({ query }) => query.includes("merged: search(")),
  ).toBe(true);
  expect(
    fx.calls.filter(({ query }) => query.includes("issueCount")),
  ).toHaveLength(1);
  expect(
    Math.max(...fx.calls.map(({ timeout }) => timeout)),
  ).toBeLessThanOrEqual(20_000);
});

test("401 merged PRs stop cheaply after one page without invalidating fresh action details", async () => {
  const fx = fixture(401);
  const cache = new Map<string, CachedDetail>();
  expect(await refreshGitHub(fx.run, NOW, 7, fx.clock, cache)).toMatchObject({
    ok: false,
    state: "error",
  });
  expect(
    fx.calls.filter(({ query }) => query.includes("merged: search(")),
  ).toHaveLength(1);
  expect(fx.clock()).toBe(20_000);
  expect(cache.size).toBe(20);
  expect(
    [...cache.values()].every((entry) => entry.readAt === NOW && !entry.failed),
  ).toBe(true);
});

test("a changing or unavailable count cannot pass the eight-page cap as complete", async () => {
  for (const count of [true, false]) {
    const fx = fixture(401, 1_000);
    const run: RunProcess = async (argv, timeout) => {
      const answer = await fx.run(argv, timeout);
      if (!argv.at(-1)!.includes("merged: search(")) return answer;
      const body = JSON.parse(answer.stdout);
      if (count) body.data.merged.issueCount = 400;
      else delete body.data.merged.issueCount;
      return { ...answer, stdout: JSON.stringify(body) };
    };
    expect(await refreshGitHub(run, NOW, 7, fx.clock)).toMatchObject({
      ok: false,
      detail: expect.stringContaining("history was shortened"),
    });
    expect(
      fx.calls.filter(({ query }) => query.includes("merged: search(")),
    ).toHaveLength(8);
  }
});

test("the history witness is the oldest valid merged row actually observed", async () => {
  const fx = fixture(401);
  const run: RunProcess = async (argv, timeout) => {
    const answer = await fx.run(argv, timeout);
    if (!argv.at(-1)!.includes("merged: search(")) return answer;
    const body = JSON.parse(answer.stdout);
    const rows = body.data.merged.nodes;
    rows[0].mergedAt = "invalid";
    rows[1].mergedAt = "2026-03-07T08:00:00Z";
    rows[2].mergedAt = "2026-03-08T08:00:00Z";
    rows[3].state = "OPEN";
    rows[3].mergedAt = "2026-01-01T00:00:00Z";
    return { ...answer, stdout: JSON.stringify(body) };
  };
  expect(await refreshGitHub(run, NOW, 7, fx.clock)).toMatchObject({
    ok: false,
    detail: expect.stringContaining("oldest confirmed merge: 2026-03-07."),
  });
});

test("deadline truncation uses only accepted page dates and preserves the detail cache", async () => {
  const fx = fixture(400, 8_000);
  const cache = new Map<string, CachedDetail>();
  expect(await refreshGitHub(fx.run, NOW, 7, fx.clock, cache)).toMatchObject({
    ok: false,
    detail:
      "GitHub history was shortened; oldest confirmed merge: 2026-03-05. World keeps the last complete list. Shorten the merged window in Settings > Sources.",
  });
  expect(fx.clock()).toBe(60_000);
  expect(fx.calls.at(-1)!.timeout).toBe(5_000);
  expect([...cache.values()].every((entry) => !entry.failed)).toBe(true);
});

test("deadline before any accepted history page has no invented merge date", async () => {
  const fx = fixture(400, 8_000, 9_000, 19_000);
  expect(await refreshGitHub(fx.run, NOW, 7, fx.clock)).toMatchObject({
    ok: false,
    detail: expect.stringContaining("before a merge date could be confirmed"),
  });
  expect(fx.clock()).toBe(60_000);
  expect(fx.calls.at(-1)!.timeout).toBe(6_000);
});

test("a failed history page still returns a source error after action details were read", async () => {
  const fx = fixture();
  fx.config.failPage = 1;
  const cache = new Map<string, CachedDetail>();
  expect(await refreshGitHub(fx.run, NOW, 7, fx.clock, cache)).toMatchObject({
    ok: false,
    detail: expect.stringContaining("GitHub did not answer"),
  });
  expect([...cache.values()].every((entry) => !entry.failed)).toBe(true);
});

test("shortened or failed history retains the last list and refuses action authority", async () => {
  const fx = fixture(50);
  let now = NOW;
  const service = new SourcesService({
    settings: { jira: { enabled: false } },
    persistSettings: async () => {},
    secrets: { read: () => ({}), write: () => {} },
    run: fx.run,
    topology: async () => [],
    resolver: new CheckoutResolver(fx.run, () => ({ kind: "local" })),
    now: () => now,
  });
  const first = await service.snapshot();
  expect(first.sources[0]!.state).toBe("connected");
  for (const mode of ["cap", "page failure"] as const) {
    now += 60_000;
    fx.config.total = mode === "cap" ? 401 : 100;
    fx.config.failPage = mode === "cap" ? -1 : 1;
    const after = await service.snapshot();
    expect(after.sources[0]).toMatchObject({
      state: "error",
      lastSuccessAt: NOW,
      itemCount: 70,
    });
    expect(after.items.map((item) => item.key)).toEqual(
      first.items.map((item) => item.key),
    );
    expect(
      after.items
        .filter((item) => item.lane !== "merged")
        .every((item) => !freshPullRequestDetail(item, now)),
    ).toBe(true);
    const before = fx.calls.length;
    const outcome = await service.pullRequestVerb(
      "github:pr:example-org/widgets#1",
      { verb: "merge", headSha: HEAD },
    );
    expect(outcome.action).toMatchObject({
      outcome: "failed",
      detail:
        "GitHub source changed or is unavailable. Refresh Sources and try again.",
    });
    expect(fx.calls).toHaveLength(before);
  }
});
