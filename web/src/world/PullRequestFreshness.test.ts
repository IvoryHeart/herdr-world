import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkItem } from "../../../shared/worldSources";
import { PullRequestCard } from "./PullRequestCard";
import { parseWorldSources } from "./worldSources";

const item: WorkItem = {
  key: "github:pr:example-org/widgets#7",
  source: "github",
  kind: "pull_request",
  ref: "example-org/widgets#7",
  title: "Synthetic change",
  url: "https://github.com/example-org/widgets/pull/7",
  lane: "ready",
  status: "open",
  roles: ["author"],
  updatedAt: 1000,
  number: 7,
  headSha: "c".repeat(40),
  checks: "pass",
  review: "approved",
  mergeable: "mergeable",
  prObservation: {
    source: "github",
    state: "stale",
    headSha: "c".repeat(40),
    readAt: 1000,
    expiresAt: 601000,
  },
  pr: {
    baseRef: "main",
    behindBy: 0,
    checks: [{ name: "Old context", state: "fail", required: true }],
    checksTruncated: false,
    reviewers: [
      {
        reviewer: "rev2",
        url: "https://example.com/review",
        at: 1000,
        outcome: "confirmed",
        line: "0/0 resolved, 0 new",
        commit: "c".repeat(40),
        commitsSince: 0,
      },
    ],
    uiChange: false,
    images: 0,
  },
};

test("browser retains detail provenance and treats old/malformed qualifications as unknown", () => {
  const decode = (entry: WorkItem) =>
    parseWorldSources({ items: [entry] }).items[0]!;
  expect(decode(item).prObservation).toEqual(item.prObservation);
  expect(
    decode({ ...item, prObservation: undefined }).prObservation,
  ).toBeUndefined();
  expect(
    decode({
      ...item,
      prObservation: { ...item.prObservation!, expiresAt: 99999 },
    }).prObservation,
  ).toBeUndefined();
  const html = renderToStaticMarkup(
    createElement(PullRequestCard, { item: decode(item) }),
  );
  expect(html).toContain("GitHub details stale · cached evidence");
  expect(html).toContain('data-detail-state="stale"');
  expect(html).toContain("Refresh Sources before merge");
  expect(html).toContain("cached confirmed");
  expect(html).toContain("CI pass");
  expect(html).not.toContain("Old context");
  expect(html).not.toContain("Merge…");
  expect(html).not.toContain('data-ready="true"');
  const fresh = renderToStaticMarkup(
    createElement(PullRequestCard, {
      item: {
        ...item,
        prObservation: { ...item.prObservation!, state: "fresh" },
      },
    }),
  );
  expect(fresh).toContain("GitHub details fresh");
  expect(fresh).toContain("Merge…");
});
