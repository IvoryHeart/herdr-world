import { afterAll, afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  reviewerResults,
  type Post,
} from "../../../server/src/sources/pullRequestDetail";
import { config, input, NOW } from "./cases";
import { copyRule } from "./git";
import { reviewedPosts } from "./review-posts";
import { reviewHistory } from "./observe";
import { evaluate } from "./predicate";
import { plan, SETTINGS_DEFAULTS } from "../crew/plan";
import { setup, cleanupDeliveries } from "../crew-round-delivery-fixture";
import { saveCycle, evaluations } from "../crew/round-policy-store";
import {
  addAction,
  addRun,
  finishRun,
  roundFor,
  setAction,
} from "../crew/store";

afterEach(cleanupDeliveries);

const root = mkdtempSync(join(tmpdir(), "gate-review-posts-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
function git(...args: string[]) {
  const result = Bun.spawnSync(["git", "-C", root, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}
git("init", "-q", "-b", "main");
git("config", "user.name", "Synthetic Reviewer");
git("config", "user.email", "reviewer@example.invalid");
git("commit", "--allow-empty", "-qm", "base");
const base = git("rev-parse", "HEAD");
git("commit", "--allow-empty", "-qm", "reviewed");
const reviewed = git("rev-parse", "HEAD");
git("commit", "--allow-empty", "-qm", "pushed during review");
const head = git("rev-parse", "HEAD");
git("checkout", "-qb", "other", base);
git("commit", "--allow-empty", "-qm", "unrelated");
const other = git("rev-parse", "HEAD");
git("checkout", "-q", "main");
const mirror = join(root, ".git");
const commits = [base, reviewed, head].map((oid, at) => ({ oid, at }));

// The reported review text shapes; only fixture SHAs and the finding path differ.
const bodies = [
  {
    number: 524,
    outcome: "open",
    body: `Reviewer: rev2\nReviewed commit: ${reviewed}\nRESULT #524: 0/0 resolved, 1 new\nP3, docs/evidence/synthetic-room/README.md:12 — The linked laptop capture shows floating pane labels and Fold over grass, without the room floor, perimeter or eight desks rendered. It cannot demonstrate the claimed post-closure room footprint at this viewport. Replace it with a fully rendered capture showing the resized room and remaining desks.\n`,
  },
  {
    number: 507,
    outcome: "confirmed",
    body: `Reviewer: rev2\nReviewed commit: ${reviewed}\nRESULT #507: 0/0 resolved, 0 new\n`,
  },
] as const;

for (const scenario of bodies)
  test(`gate binds the reported #${scenario.number} RESULT to the older reviewed commit`, () => {
    const raw = reviewHistory(
      () => ({
        code: 0,
        stderr: "",
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviews: {
                  nodes: [
                    {
                      id: "synthetic-review",
                      body: scenario.body,
                      authorAssociation: "OWNER",
                      url: "https://github.com/example-org/widgets/pull/7#pullrequestreview-1",
                      submittedAt: new Date(NOW - 60_000).toISOString(),
                      commit: { oid: head },
                    },
                  ],
                  pageInfo: { hasNextPage: false },
                },
                comments: { nodes: [], pageInfo: { hasNextPage: false } },
              },
            },
          },
        }),
      }),
      "example-org/widgets",
      scenario.number,
    );
    expect(raw.complete).toBe(true);
    expect(
      reviewerResults(scenario.number, raw.posts, commits, head)[0],
    ).toMatchObject({ commit: null, outcome: "unknown" });
    const posts = reviewedPosts(
      scenario.number,
      raw.posts,
      commits,
      head,
      mirror,
    );
    const [claim] = reviewerResults(scenario.number, posts, commits, head);
    expect(claim).toMatchObject({
      reviewer: "rev2",
      commit: reviewed,
      outcome: scenario.outcome,
      commitsSince: 1,
    });
    const value = input({
      head,
      commits: [base, reviewed, head],
      posts: [],
      item: { branch: "agent/builder-7" },
    });
    value.number = scenario.number;
    value.item!.number = scenario.number;
    value.item!.pr!.reviewers = [claim!];
    value.history = [claim!];
    value.copies[reviewed] = copyRule(mirror, reviewed, head);
    const verdict = evaluate(
      value,
      { ...config, reviewers: { default: ["rev2"] } },
      NOW,
    );
    expect(verdict.state).not.toBe("READY");
    const actions = plan(
      verdict,
      value,
      { ...SETTINGS_DEFAULTS, roster: { rev2: { model: "gpt-6.1-sol" } } },
      ["builder"],
    );
    expect(
      actions.some(
        (action) =>
          action.kind === "judgment" && action.text.includes("can't read"),
      ),
    ).toBe(false);
    expect(actions.find((action) => action.target === "rev2")).toMatchObject({
      kind: "confirm",
      since: reviewed,
    });
  });

function claim(body: string, metadata = head) {
  const post: Post = {
    id: "synthetic-review",
    at: NOW - 60_000,
    body,
    commit: metadata,
  };
  return reviewerResults(
    7,
    reviewedPosts(7, [post], commits, head, mirror),
    commits,
    head,
  )[0]!;
}

test("conflicting explicit commits and unrelated histories still fail closed", () => {
  expect(
    claim(
      `Reviewer: rev2\nReviewed commit: ${reviewed}\nReviewed head: ${head}\nRESULT #7: 0/0 resolved, 1 new`,
    ),
  ).toMatchObject({ commit: null, outcome: "unknown" });
  expect(
    claim(
      `Reviewer: rev2\nReviewed commit: ${other}\nRESULT #7: 0/0 resolved, 1 new`,
    ),
  ).toMatchObject({ commit: null, outcome: "unknown" });
});

test("unattributed or quoted review text does not acquire pinned authority", () => {
  expect(
    claim(`Reviewed commit: ${reviewed}\nRESULT #7: 0/0 resolved, 1 new`),
  ).toMatchObject({ reviewer: null, commit: null, outcome: "unknown" });
  expect(
    claim(
      `Reviewer: rev2\n> Reviewed commit: ${reviewed}\nRESULT #7: 0/0 resolved, 1 new`,
    ),
  ).toMatchObject({ commit: head, outcome: "open" });
});

test("recovering the gate's pinned claim does not change the shared parser's conservative rule", () => {
  expect(
    reviewerResults(
      7,
      [
        {
          at: NOW,
          commit: head,
          body: `Reviewer: rev2\nReviewed commit: ${reviewed}\nRESULT #7: 0/0 resolved, 0 new`,
        },
      ],
      commits,
      head,
    )[0],
  ).toMatchObject({ commit: null, outcome: "unknown" });
});

test("recovering posted old-head results prevents stale checkout relaunches after adoption", () => {
  const body = bodies[0]!.body.replaceAll("#524", "#7");
  const post: Post = {
    id: "synthetic-review",
    at: NOW - 60_000,
    body,
    commit: head,
    url: "https://github.com/example-org/widgets/pull/7#pullrequestreview-1",
  };
  for (const recover of [false, true]) {
    const f = setup({ seedCycle: false });
    f.setPosts([
      {
        id: 1,
        body,
        created_at: new Date(post.at).toISOString(),
        html_url: String(post.url),
      },
    ]);
    const round = roundFor(f.crew, 7, reviewed, NOW - 120_000);
    const superseded = {
      key: `7:${reviewed}:confirm:rev2`,
      pr: 7,
      head: reviewed,
      kind: "confirm" as const,
      target: "rev2",
      since: base,
      text: "old confirmation",
    };
    addAction(f.crew, superseded, NOW - 120_000);
    const run = addRun(
      f.crew,
      {
        actionKey: superseded.key,
        pr: 7,
        head: reviewed,
        reviewer: "rev2",
        round: round.round,
        log: "synthetic.log",
      },
      NOW - 120_000,
    );
    finishRun(f.crew, run, -15, null, NOW - 90_000);
    setAction(f.crew, superseded.key, "superseded", NOW - 90_000);
    saveCycle(f.crew, {
      pr: 7,
      round: round.round,
      ordinal: 2,
      head: reviewed,
      since: base,
      reviewers: ["rev2"],
      reviewActions: [
        {
          key: `7:${reviewed}:review:rev2`,
          pr: 7,
          head: reviewed,
          kind: "review",
          target: "rev2",
          text: "adopted full review",
        },
      ],
      trigger: {
        replies: [],
        quietSince: NOW - 90_000,
        reason: "adopted existing reviewer round",
      },
    });
    const posts = recover
      ? reviewedPosts(7, [post], commits, head, mirror)
      : [post];
    const value = input({
      head,
      commits: [base, reviewed, head],
      posts: [],
      item: { branch: "agent/builder-7" },
    });
    value.history = reviewerResults(7, posts, commits, head);
    value.item!.pr!.reviewers = value.history;
    value.copies[reviewed] = copyRule(mirror, reviewed, head);
    f.passInput(value);
    expect(f.spawned).toHaveLength(1);
    const argv = f.spawned[0]!;
    // Without recovery, the valid posted review looks absent and the old
    // adopted assignment starts another checkout of the stale round head.
    expect(argv[2]).toBe(recover ? "evaluate" : "review");
    expect(argv[argv.indexOf("--head") + 1]).toBe(recover ? head : reviewed);
    if (recover) expect(evaluations(f.crew, 7)[0]?.head).toBe(head);
  }
});
