import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PullRequestReviews } from "./PullRequestCard";
import type { PullRequestReviewer } from "../../../shared/pullRequests";

test("unattributed RESULT posts each render their own source and unknown attribution", () => {
  const reviewers: PullRequestReviewer[] = [1, 2].map((id) => ({
    reviewer: null,
    sourceId: `review-${id}`,
    url: `https://github.com/example-org/widgets/pull/7#pullrequestreview-${id}`,
    at: id,
    outcome: "unknown",
    line: "0/0 resolved, 0 new",
    commit: "c".repeat(40),
    commitsSince: 0,
  }));
  const markup = renderToStaticMarkup(
    createElement(PullRequestReviews, { reviewers }),
  );
  expect(markup.match(/Unknown reviewer/g)).toHaveLength(2);
  expect(markup.match(/Attribution unknown/g)).toHaveLength(2);
  expect(markup.match(/View RESULT source/g)).toHaveLength(2);
  for (const entry of reviewers)
    expect(markup).toContain(`href="${entry.url}"`);
  expect(markup).not.toContain("No reviewer result yet");
  expect(markup).toContain("sender claims, not verified identities");
});
