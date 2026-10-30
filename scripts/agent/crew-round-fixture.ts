import { config, input, NOW, SHA } from "./gate/cases";
import { evaluate } from "./gate/predicate";
import type { Deps } from "./crew/deps";
import { plan, SETTINGS_DEFAULTS } from "./crew/plan";
import type { CrewPost } from "./crew/review-facts";
import { roundPolicy } from "./crew/round-policy";
import { saveCycle } from "./crew/round-policy-store";
import { openCrewStore, roundFor } from "./crew/store";

const roster = {
  builder: { model: "gpt-6.1-sol" },
  rev2: { model: "gpt-6.1-sol" },
  evaluator: { model: "claude-opus-5-5", effort: "high" },
  splitter: { model: "gpt-6-astra" },
  visionary: { model: "claude-opus-5-5" },
};
const settings = { ...SETTINGS_DEFAULTS, roster, authors: { "7": "builder" } };
export const reviewPost: CrewPost = {
  id: "101",
  body: `Reviewer: rev2\nReviewed commit: ${SHA.reviewed}\nRESULT #7: 0/0 resolved, 1 new\nP2 src/widget.ts:10 broken recovery`,
  at: NOW - 60_000,
  url: "https://github.com/example-org/widgets/pull/7#pullrequestreview-101",
  commit: SHA.reviewed,
};
export const finding = {
  id: "rev2:101:1",
  reviewer: "rev2",
  file: "src/widget.ts",
  line: 10,
  text: "P2 src/widget.ts:10 broken recovery",
  at: reviewPost.at,
  url: reviewPost.url,
};
const databases: ReturnType<typeof openCrewStore>[] = [];
export function cleanupFixtures() {
  for (const db of databases.splice(0)) db.close();
}

export function fixture(ordinal = 1) {
  const db = openCrewStore(":memory:");
  databases.push(db);
  const round = roundFor(db, 7, SHA.reviewed, NOW - 3_600_000);
  saveCycle(db, {
    pr: 7,
    round: round.round,
    ordinal,
    head: SHA.reviewed,
    reviewers: ["rev2"],
    trigger: {
      replies: [],
      quietSince: NOW - 3_600_000,
      reason: "first full review",
    },
  });
  let posts = [reviewPost];
  let files = ["src/widget.ts"];
  let mainOnly = false;
  const deps: Deps = {
    run: (argv) => {
      let stdout = "";
      if (argv[0] === "gh") {
        const rows = argv.at(-1)!.includes("/reviews?") ? posts : [];
        stdout = rows
          .map((post) =>
            JSON.stringify({
              id: post.id,
              body: post.body,
              created_at: new Date(post.at).toISOString(),
              html_url: post.url,
              commit_id: post.commit,
            }),
          )
          .join("\n");
      } else if (argv.includes("rev-list"))
        stdout = mainOnly
          ? `${SHA.fixed} ${SHA.reviewed} ${SHA.other}\n`
          : `${SHA.fixed} ${SHA.reviewed}\n`;
      else if (argv.includes("diff")) stdout = files.join("\0") + "\0";
      return { code: 0, stdout, stderr: "" };
    },
    spawn: () => {
      throw new Error("pure policy must not spawn");
    },
    alive: () => true,
    kill: () => {},
    closeTab: () => true,
    openTab: () => null,
    usage: () => null,
    out: () => {},
  };
  const value = (head = SHA.fixed, count = 1) =>
    input({
      head,
      posts: [
        {
          reviewer: "rev2",
          commit: SHA.reviewed,
          result: `0/0 resolved, ${count} new`,
        },
      ],
      item: { branch: "agent/builder-7" },
    });
  const pass = (gateInput = value(), now = NOW, dryRun = false) =>
    roundPolicy({
      crew: db,
      input: gateInput,
      actions: plan(
        evaluate(
          gateInput,
          { ...config, reviewers: { default: ["rev2"] } },
          NOW,
        ),
        gateInput,
        settings,
        ["builder"],
      ),
      settings,
      repo: config.repo,
      dir: "/synthetic/gate",
      now,
      dryRun,
      author: "builder",
      deps,
      requiredReviewers: ["rev2"],
    });
  const reply = () =>
    posts.push({
      id: "102",
      body: "[builder]\nrev2:101:1 fixed in bbbbbbb",
      at: NOW,
      url: "https://github.com/example-org/widgets/pull/7#issuecomment-102",
    });
  return {
    db,
    deps,
    value,
    pass,
    reply,
    setPosts: (next: CrewPost[]) => {
      posts = next;
    },
    setFiles: (next: string[]) => {
      files = next;
    },
    main: () => {
      mainOnly = true;
    },
  };
}
