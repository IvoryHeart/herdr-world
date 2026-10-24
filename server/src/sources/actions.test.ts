import { describe, expect, test } from "bun:test";
import type { WorkItem } from "../../../shared/worldSources";
import {
  HEAD_CHANGED,
  REVIEW_REQUIRED,
  reason,
  runPullRequestVerb,
} from "./actions";
import type { ProcessResult, RunProcess } from "./github";
import { createSourcesHttpHandler, WORLD_SOURCES_PATH } from "./http";
import { CheckoutResolver } from "./links";
import { SourcesService } from "./service";

const HEAD = "c".repeat(40);
const KEY = "github:pr:example-org/widgets#7";

const item = (fields: Partial<WorkItem> = {}): WorkItem => ({
  key: KEY,
  source: "github",
  kind: "pull_request",
  ref: "example-org/widgets#7",
  title: "Synthetic change",
  url: "https://github.com/example-org/widgets/pull/7",
  lane: "ready",
  status: "open",
  roles: ["author"],
  updatedAt: 1,
  number: 7,
  repo: "example-org/widgets",
  base: "main",
  headSha: HEAD,
  draft: false,
  checks: "pass",
  review: "approved",
  mergeable: "mergeable",
  ...fields,
});

const ok = (stdout = ""): ProcessResult => ({ code: 0, stdout, stderr: "" });
const state = (fields: Record<string, unknown> = {}) =>
  ok(
    JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            state: "OPEN",
            headRefOid: HEAD,
            reviewDecision: "APPROVED",
            ...fields,
          },
        },
      },
    }),
  );

/** gh that answers the pre-merge read with `current` and records every call. */
function fakeGh(current: ProcessResult = state(), verb: ProcessResult = ok()) {
  const calls: string[][] = [];
  const run: RunProcess = async (argv) => {
    calls.push(argv);
    if (argv[1] === "api") return current;
    return verb;
  };
  return { run, calls, verbs: () => calls.filter((argv) => argv[1] === "pr") };
}

describe("pull request verbs", () => {
  test("merge reads the pull request again, then merges with a merge commit pinned to the head seen", async () => {
    const gh = fakeGh();
    expect(
      await runPullRequestVerb(gh.run, item(), {
        verb: "merge",
        headSha: HEAD,
      }),
    ).toEqual({ ok: true });
    expect(gh.calls[0]!.slice(0, 3)).toEqual(["gh", "api", "graphql"]);
    expect(gh.verbs()).toEqual([
      [
        "gh",
        "pr",
        "merge",
        "7",
        "--repo",
        "example-org/widgets",
        "--merge",
        "--match-head-commit",
        HEAD,
      ],
    ]);
  });

  test("World never bypasses branch protection", async () => {
    for (const reviewDecision of ["REVIEW_REQUIRED", "CHANGES_REQUESTED"]) {
      const gh = fakeGh(state({ reviewDecision }));
      expect(
        await runPullRequestVerb(gh.run, item(), {
          verb: "merge",
          headSha: HEAD,
        }),
      ).toEqual({ ok: false, detail: REVIEW_REQUIRED });
      expect(gh.verbs()).toEqual([]);
    }
    const gh = fakeGh();
    await runPullRequestVerb(gh.run, item(), { verb: "merge", headSha: HEAD });
    expect(gh.calls.flat()).not.toContain("--admin");
  });

  test("a push since the owner looked stops the merge", async () => {
    const moved = fakeGh(state({ headRefOid: "d".repeat(40) }));
    expect(
      await runPullRequestVerb(moved.run, item(), {
        verb: "merge",
        headSha: HEAD,
      }),
    ).toEqual({ ok: false, detail: HEAD_CHANGED });
    expect(moved.verbs()).toEqual([]);
    // A push between the read and the merge: GitHub's own pin refuses.
    const raced = fakeGh(state(), {
      code: 1,
      stdout: "",
      stderr: "X Head branch was modified. Review and try the merge again.\n",
    });
    expect(
      await runPullRequestVerb(raced.run, item(), {
        verb: "merge",
        headSha: HEAD,
      }),
    ).toEqual({ ok: false, detail: HEAD_CHANGED });
    const gone = fakeGh(state({ state: "MERGED" }));
    expect(
      await runPullRequestVerb(gone.run, item(), {
        verb: "merge",
        headSha: HEAD,
      }),
    ).toEqual({ ok: false, detail: "It is merged already." });
  });

  test("GitHub's refusal comes back in its own words", async () => {
    const gh = fakeGh(state(), {
      code: 1,
      stdout: "",
      stderr:
        "\u001b[31mX\u001b[0m Pull request example-org/widgets#7 is not mergeable: the merge commit cannot be cleanly created.\n",
    });
    expect(
      await runPullRequestVerb(gh.run, item(), {
        verb: "merge",
        headSha: HEAD,
      }),
    ).toEqual({
      ok: false,
      detail:
        "Pull request example-org/widgets#7 is not mergeable: the merge commit cannot be cleanly created.",
    });
    expect(reason({ stdout: "", stderr: "a\u0007b\nc" })).toBe("ab\nc");
    expect(reason({ stdout: "", stderr: "x".repeat(900) })).toHaveLength(500);
  });

  test("close keeps the branch and posts the optional comment; mark ready is for drafts", async () => {
    const gh = fakeGh();
    await runPullRequestVerb(gh.run, item(), {
      verb: "close",
      comment: "Superseded by #8",
    });
    expect(gh.verbs()).toEqual([
      [
        "gh",
        "pr",
        "close",
        "7",
        "--repo",
        "example-org/widgets",
        "--comment",
        "Superseded by #8",
      ],
    ]);
    expect(gh.calls.flat()).not.toContain("--delete-branch");
    const ready = fakeGh();
    expect(
      await runPullRequestVerb(ready.run, item(), { verb: "ready" }),
    ).toEqual({ ok: false, detail: "It is already ready for review." });
    await runPullRequestVerb(ready.run, item({ draft: true }), {
      verb: "ready",
    });
    expect(ready.verbs()).toEqual([
      ["gh", "pr", "ready", "7", "--repo", "example-org/widgets"],
    ]);
  });

  test("acts only on your own open pull requests", async () => {
    const gh = fakeGh();
    for (const other of [
      item({ roles: ["reviewer"] }),
      item({ lane: "merged" }),
      item({ headSha: undefined }),
    ])
      expect(
        await runPullRequestVerb(gh.run, other, { verb: "close" }),
      ).toMatchObject({ ok: false });
    expect(gh.calls).toEqual([]);
  });
});

describe("pull request verb endpoint", () => {
  const listNode = {
    number: 7,
    title: "Synthetic change",
    url: "https://github.com/example-org/widgets/pull/7",
    isDraft: false,
    state: "OPEN",
    updatedAt: "2026-01-01T00:00:00Z",
    headRefName: "agent/fix",
    headRefOid: HEAD,
    baseRefName: "main",
    reviewDecision: "APPROVED",
    mergeable: "MERGEABLE",
    repository: { nameWithOwner: "example-org/widgets" },
    headRepository: { nameWithOwner: "example-org/widgets" },
    commits: { nodes: [] },
  };

  function setup(verb: ProcessResult = ok()) {
    let now = 1_000;
    let release: (() => void) | null = null;
    const calls: string[][] = [];
    const run: RunProcess = async (argv) => {
      calls.push(argv);
      if (argv[0] !== "gh") return ok();
      if (argv[1] === "auth") return ok();
      if (argv[1] === "pr") {
        if (release === null && argv[2] === "close")
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        return verb;
      }
      const query = argv.at(-1)!;
      if (query.includes("headRefOid reviewDecision")) return state();
      if (query.includes("pullRequest(number:"))
        return ok(JSON.stringify({ data: {} }));
      return ok(
        JSON.stringify({
          data: {
            authored: { nodes: [listNode] },
            reviewing: { nodes: [] },
            assigned: { nodes: [] },
            merged: { nodes: [] },
            issues: { nodes: [] },
          },
        }),
      );
    };
    const service = new SourcesService({
      settings: {},
      persistSettings: async () => {},
      secrets: { read: () => ({}), write: () => {} },
      run,
      topology: async () => [],
      resolver: new CheckoutResolver(run, () => ({ kind: "local" })),
      now: () => now,
    });
    const handle = createSourcesHttpHandler(service);
    const post = (body: unknown) =>
      handle(
        new Request(
          `http://world.example${WORLD_SOURCES_PATH}/github/pull-request`,
          {
            method: "POST",
            body: JSON.stringify(body),
          },
        ),
        `${WORLD_SOURCES_PATH}/github/pull-request`,
      );
    return {
      service,
      post,
      calls,
      release: () => release?.(),
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  test("runs a confirmed verb, records who asked, and answers with the refreshed snapshot", async () => {
    const world = setup();
    await world.service.snapshot();
    const response = (await world.post({
      key: KEY,
      verb: "merge",
      headSha: HEAD,
    }))!;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.action).toEqual({
      verb: "merge",
      itemKey: KEY,
      ref: "example-org/widgets#7",
      at: 1_000,
      outcome: "done",
      sender: { basis: "reported", via: "browser" },
    });
    expect(body.snapshot.actions).toEqual([body.action]);
    expect(world.calls.some((argv) => argv[2] === "merge")).toBe(true);
  });

  test("a refusal is recorded with GitHub's reason", async () => {
    const world = setup({
      code: 1,
      stdout: "",
      stderr: "Pull request is not mergeable",
    });
    await world.service.snapshot();
    const body = await (await world.post({
      key: KEY,
      verb: "merge",
      headSha: HEAD,
    }))!.json();
    expect(body.action).toMatchObject({
      outcome: "failed",
      detail: "Pull request is not mergeable",
    });
  });

  test("refuses malformed requests, unknown pull requests and a second verb while one runs", async () => {
    const world = setup();
    await world.service.snapshot();
    for (const [body, error] of [
      [{ key: KEY, verb: "approve" }, "The verb is merge, close or ready"],
      [{ key: KEY, verb: "merge" }, "Merge needs the head you reviewed"],
      [
        { key: KEY, verb: "merge", headSha: "abc" },
        "headSha must be a full commit SHA",
      ],
      [
        { key: KEY, verb: "ready", comment: "x" },
        "A comment goes with close, up to 4000 characters",
      ],
      [
        { key: KEY, verb: "close", admin: true },
        "A pull request action takes key, verb, headSha and comment",
      ],
      [
        { key: "jira:ABC-1", verb: "close" },
        "Name the pull request by its key",
      ],
    ] as const) {
      const response = (await world.post(body))!;
      expect([response.status, (await response.json()).error]).toEqual([
        400,
        error,
      ]);
    }
    const unknown = (await world.post({
      key: "github:pr:example-org/widgets#99",
      verb: "close",
    }))!;
    expect(unknown.status).toBe(404);
    const first = world.post({ key: KEY, verb: "close" });
    await Bun.sleep(5);
    const second = (await world.post({ key: KEY, verb: "close" }))!;
    expect([second.status, (await second.json()).error]).toEqual([
      409,
      "An action on #7 is still running",
    ]);
    world.release();
    expect((await first)!.status).toBe(200);
  });
});
