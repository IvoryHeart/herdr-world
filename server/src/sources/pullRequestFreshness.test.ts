import { describe, expect, test } from "bun:test";
import { pullRequestReadiness } from "../../../shared/pullRequests";
import { refreshGitHub, type ProcessResult, type RunProcess } from "./github";
import { CheckoutResolver } from "./links";
import { DETAIL_MAX_AGE_MS, type CachedDetail } from "./pullRequestDetail";
import { SourcesService } from "./service";

const HEAD = "c".repeat(40);
const ok = (data: unknown): ProcessResult => ({
  code: 0,
  stdout: JSON.stringify({ data }),
  stderr: "",
});
const node = () => ({
  number: 7,
  title: "Synthetic change",
  url: "https://github.com/example-org/widgets/pull/7",
  isDraft: false,
  state: "OPEN",
  updatedAt: "2026-01-01T00:00:00Z",
  headRefName: "agent/change",
  headRefOid: HEAD,
  baseRefName: "main",
  reviewDecision: "APPROVED",
  mergeable: "MERGEABLE",
  repository: { nameWithOwner: "example-org/widgets" },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
});
const detail = (images = 1) => ({
  headRefOid: HEAD,
  body: "![proof](https://example.com/proof.png)".repeat(images),
  author: { login: "synthetic-owner" },
  headRef: { compare: { aheadBy: 0 } },
  files: { totalCount: 1, nodes: [{ path: "web/src/example.tsx" }] },
  commits: {
    nodes: [{ commit: { oid: HEAD, committedDate: "2026-01-01T00:00:00Z" } }],
  },
  latest: { nodes: [{ commit: { oid: HEAD, statusCheckRollup: null } }] },
  reviews: { nodes: [] },
  comments: {
    nodes: [
      {
        id: "comment-1",
        author: { login: "synthetic-owner" },
        authorAssociation: "OWNER",
        body: `Reviewer: rev2\nReviewed commit: ${HEAD}\nRESULT #7: 0/0 resolved, 0 new`,
        url: "https://github.com/example-org/widgets/pull/7#issuecomment-1",
        createdAt: "2026-01-01T00:01:00Z",
      },
    ],
  },
});

function fixture() {
  let current = node();
  let read: () => Promise<ProcessResult> = async () =>
    ok({ p0: { pullRequest: detail() } });
  const calls: string[][] = [];
  const run: RunProcess = async (argv) => {
    calls.push(argv);
    if (argv[1] === "auth") return { code: 0, stdout: "", stderr: "" };
    if (argv[1] === "pr") return { code: 0, stdout: "", stderr: "" };
    const query = argv.at(-1)!;
    if (query.includes("p0: repository")) return read();
    if (query.includes("authored: search"))
      return ok({
        authored: { nodes: [current] },
        reviewing: { nodes: [] },
        assigned: { nodes: [] },
        merged: { nodes: [] },
        issues: { nodes: [] },
      });
    return ok({
      repository: {
        pullRequest: {
          state: "OPEN",
          headRefOid: HEAD,
          reviewDecision: "APPROVED",
        },
      },
    });
  };
  return {
    run,
    calls,
    setRead: (next: typeof read) => {
      read = next;
    },
    setHead: () => {
      current = { ...current, headRefOid: "d".repeat(40) };
    },
  };
}

async function items(
  run: RunProcess,
  now: number,
  cache: Map<string, CachedDetail>,
) {
  const result = await refreshGitHub(run, now, 7, () => now, cache);
  expect(result.ok).toBe(true);
  return result.ok ? result.items : [];
}

describe("PR detail freshness is independent of list success", () => {
  test("expired failed detail retains linked evidence without confirming readiness, then recovers", async () => {
    const fx = fixture();
    const cache = new Map<string, CachedDetail>();
    const first = (await items(fx.run, 1000, cache))[0]!;
    expect(first).toMatchObject({
      prObservation: {
        source: "github",
        state: "fresh",
        readAt: 1000,
        headSha: HEAD,
      },
    });
    fx.setRead(async () => ({
      code: 1,
      stdout: "",
      stderr: "synthetic failure",
    }));
    const stale = (await items(fx.run, 1000 + DETAIL_MAX_AGE_MS, cache))[0]!;
    expect(stale.pr?.reviewers).toHaveLength(1);
    expect(stale).toMatchObject({
      prObservation: { state: "stale", readAt: 1000 },
    });
    expect(
      pullRequestReadiness(stale)
        .filter((r) => ["findings", "screenshots"].includes(r.id))
        .map((r) => r.state),
    ).toEqual(["unknown", "unknown"]);
    fx.setRead(async () => ok({ p0: { pullRequest: detail(2) } }));
    const recovered = (
      await items(fx.run, 2000 + DETAIL_MAX_AGE_MS, cache)
    )[0]!;
    expect(recovered.pr?.images).toBe(2);
    expect(recovered).toMatchObject({
      prObservation: { state: "fresh", readAt: 2000 + DETAIL_MAX_AGE_MS },
    });
  });

  test("reuse inside the TTL preserves the original observation time", async () => {
    const fx = fixture();
    const cache = new Map<string, CachedDetail>();
    await items(fx.run, 1000, cache);
    fx.setRead(async () => {
      throw new Error("should not read detail");
    });
    const reused = (await items(fx.run, 2000, cache))[0]!;
    expect(reused).toMatchObject({
      prObservation: { state: "fresh", readAt: 1000 },
    });
  });

  test("a changed head never receives old detail, and partial detail cannot become fresh", async () => {
    const fx = fixture();
    const cache = new Map<string, CachedDetail>();
    await items(fx.run, 1000, cache);
    fx.setHead();
    fx.setRead(async () => ok({ p0: { pullRequest: detail() } }));
    const changed = (await items(fx.run, 2000, cache))[0]!;
    expect(changed.pr).toBeUndefined();
    expect(changed).toMatchObject({
      prObservation: { state: "unavailable", readAt: null },
    });
    const partialFx = fixture();
    partialFx.setRead(async () =>
      ok({ p0: { pullRequest: { headRefOid: HEAD } } }),
    );
    const partial = (await items(partialFx.run, 2000, new Map()))[0]!;
    expect(partial.pr).toBeUndefined();
    expect(partial).toMatchObject({ prObservation: { state: "unavailable" } });
  });

  test("null aliases and missing queried sections cannot refresh old evidence", async () => {
    for (const section of [
      "headRefOid",
      "body",
      "author",
      "headRef",
      "files",
      "commits",
      "latest",
      "reviews",
      "comments",
      null,
    ]) {
      const fx = fixture();
      const cache = new Map<string, CachedDetail>();
      await items(fx.run, 1000, cache);
      const partial: Record<string, unknown> = { ...detail() };
      if (section) delete partial[section];
      fx.setRead(async () =>
        ok({ p0: { pullRequest: section ? partial : null } }),
      );
      const result = (await items(fx.run, 1000 + DETAIL_MAX_AGE_MS, cache))[0]!;
      expect(result).toMatchObject({
        prObservation: { state: "stale", readAt: 1000 },
      });
    }
  });

  test("complete aliases stay fresh while an unanswered neighbor stays unavailable", async () => {
    const fx = fixture();
    const run: RunProcess = async (argv, timeout) => {
      if (argv.at(-1)?.includes("authored: search"))
        return ok({
          authored: {
            nodes: [
              node(),
              {
                ...node(),
                number: 8,
                url: "https://github.com/example-org/widgets/pull/8",
              },
            ],
          },
          reviewing: { nodes: [] },
          assigned: { nodes: [] },
          merged: { nodes: [] },
          issues: { nodes: [] },
        });
      return fx.run(argv, timeout);
    };
    const result = await items(run, 1000, new Map());
    expect(result.map((item) => item.prObservation?.state)).toEqual([
      "fresh",
      "unavailable",
    ]);
  });

  test("GraphQL errors cannot turn partial detail data into a successful observation", async () => {
    const fx = fixture();
    fx.setRead(async () => ({
      code: 0,
      stderr: "",
      stdout: JSON.stringify({
        data: { p0: { pullRequest: detail() } },
        errors: [{ message: "synthetic partial failure" }],
      }),
    }));
    const result = (await items(fx.run, 1000, new Map()))[0]!;
    expect(result.pr).toBeUndefined();
    expect(result).toMatchObject({
      prObservation: { state: "unavailable", readAt: null },
    });
  });

  test("twenty details in ten-item batches, then the unread tail before cached entries", async () => {
    const batches: number[] = [];
    const run: RunProcess = async (argv) => {
      if (argv[1] === "auth") return { code: 0, stdout: "", stderr: "" };
      const query = argv.at(-1)!;
      if (query.includes("authored: search"))
        return ok({
          authored: {
            nodes: Array.from({ length: 25 }, (_, i) => ({
              ...node(),
              number: i + 1,
              url: `https://github.com/example-org/widgets/pull/${i + 1}`,
            })),
          },
          reviewing: { nodes: [] },
          assigned: { nodes: [] },
          merged: { nodes: [] },
          issues: { nodes: [] },
        });
      const aliases = [...query.matchAll(/p(\d+): repository/gu)];
      batches.push(aliases.length);
      return ok(
        Object.fromEntries(
          aliases.map((match) => [`p${match[1]}`, { pullRequest: detail() }]),
        ),
      );
    };
    const cache = new Map<string, CachedDetail>();
    const first = await items(run, 1000, cache);
    expect(batches).toEqual([10, 10]);
    expect(
      first.filter((item) => item.prObservation?.state === "fresh"),
    ).toHaveLength(20);
    const second = await items(run, 2000, cache);
    expect(batches).toEqual([10, 10, 5]);
    expect(
      second.filter((item) => item.prObservation?.readAt === 2000),
    ).toHaveLength(5);
    expect(second.every((item) => item.prObservation?.state === "fresh")).toBe(
      true,
    );
  });
});

function serviceFor(run: RunProcess, clock: () => number) {
  return new SourcesService({
    settings: { jira: { enabled: false } },
    persistSettings: async () => {},
    secrets: { read: () => ({}), write: () => {} },
    run,
    topology: async () => [],
    resolver: new CheckoutResolver(run, () => null),
    now: clock,
    waitMs: 1,
  });
}

describe("detail cache configuration and action admission", () => {
  test.each(["re-enable", "merged window"])(
    "a retired response cannot pollute the cache after %s",
    async (change) => {
      const fx = fixture();
      let now = 1000;
      let release!: (result: ProcessResult) => void;
      let started!: () => void;
      const began = new Promise<void>((resolve) => {
        started = resolve;
      });
      const held = new Promise<ProcessResult>((resolve) => {
        release = resolve;
      });
      fx.setRead(async () => {
        started();
        return held;
      });
      const service = serviceFor(fx.run, () => now);
      await service.snapshot();
      await began;
      if (change === "re-enable")
        await service.configureGitHub({ enabled: false });
      fx.setRead(async () => ok({ p0: { pullRequest: detail(2) } }));
      await service.configureGitHub(
        change === "re-enable" ? { enabled: true } : { mergedDays: 30 },
      );
      release(ok({ p0: { pullRequest: detail(1) } }));
      await new Promise<void>((resolve) => setImmediate(resolve));
      now += 6000;
      const snapshot = await service.snapshot(true);
      expect(snapshot.items[0]?.pr?.images).toBe(2);
    },
  );

  test("expiry and a failed list refresh downgrade snapshots without changing last detail read", async () => {
    const fx = fixture();
    let now = 1000;
    let fail = false;
    const run: RunProcess = async (argv, timeout) =>
      fail && argv.at(-1)?.includes("authored: search")
        ? { code: 1, stdout: "", stderr: "synthetic failure" }
        : fx.run(argv, timeout);
    const service = serviceFor(run, () => now);
    await service.snapshot();
    now += 6000;
    fail = true;
    const failed = await service.snapshot(true);
    expect(failed.items[0]).toMatchObject({
      prObservation: { state: "stale", readAt: 1000 },
    });
    expect(failed.sources[0]?.state).toBe("error");
    fail = false;
    now += 6000;
    await service.snapshot(true);
    now = 1000 + DETAIL_MAX_AGE_MS;
    expect(service.current().items[0]).toMatchObject({
      prObservation: { state: "stale", readAt: 1000 },
    });
    const result = await service.pullRequestVerb(failed.items[0]!.key, {
      verb: "merge",
      headSha: HEAD,
    });
    expect(result.action.outcome).toBe("failed");
    expect(fx.calls.filter((argv) => argv[1] === "pr")).toHaveLength(0);
  });

  test("detail expiry during the live merge check blocks dispatch", async () => {
    const fx = fixture();
    let now = 1000;
    let release!: (result: ProcessResult) => void;
    let started!: () => void;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise<ProcessResult>((resolve) => {
      release = resolve;
    });
    const run: RunProcess = async (argv, timeout) => {
      if (argv.at(-1)?.includes("query=query { repository(")) {
        started();
        return held;
      }
      return fx.run(argv, timeout);
    };
    const service = serviceFor(run, () => now);
    const first = await service.snapshot();
    const pending = service.pullRequestVerb(first.items[0]!.key, {
      verb: "merge",
      headSha: HEAD,
    });
    await began;
    now += DETAIL_MAX_AGE_MS;
    release(
      ok({
        repository: {
          pullRequest: {
            state: "OPEN",
            headRefOid: HEAD,
            reviewDecision: "APPROVED",
          },
        },
      }),
    );
    expect((await pending).action).toMatchObject({
      outcome: "failed",
      detail: expect.stringContaining("stale or unavailable"),
    });
    expect(fx.calls.filter((argv) => argv[1] === "pr")).toHaveLength(0);
  });

  test("a source retired during the live pre-merge read cannot dispatch a merge", async () => {
    const fx = fixture();
    let release!: (result: ProcessResult) => void;
    let started!: () => void;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise<ProcessResult>((resolve) => {
      release = resolve;
    });
    const run: RunProcess = async (argv, timeout) => {
      if (argv.at(-1)?.includes("query=query { repository(")) {
        started();
        return held;
      }
      return fx.run(argv, timeout);
    };
    const service = serviceFor(run, () => 1000);
    const first = await service.snapshot();
    const pending = service.pullRequestVerb(first.items[0]!.key, {
      verb: "merge",
      headSha: HEAD,
    });
    await began;
    await service.configureGitHub({ enabled: false });
    release(
      ok({
        repository: {
          pullRequest: {
            state: "OPEN",
            headRefOid: HEAD,
            reviewDecision: "APPROVED",
          },
        },
      }),
    );
    const result = await pending;
    expect(result.action.outcome).toBe("failed");
    expect(fx.calls.filter((argv) => argv[1] === "pr")).toHaveLength(0);
  });
});
