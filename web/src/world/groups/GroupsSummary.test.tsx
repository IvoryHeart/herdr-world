import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { buildGroupViews } from "../../../../shared/groupViews";
import { agentAddress, type Group } from "../../../../shared/groups";
import type { WorkItem } from "../../../../shared/worldSources";
import { GroupsSummaryContent } from "./GroupsSummary";
import { TownSummaryPanel } from "../town/TownSummaryPanel";
import type { TownSummary } from "../town/townSummary";

const stored: Group = {
  id: "chat",
  kind: "pod",
  name: "Chat",
  created_at: 1,
  members: [
    {
      ref: agentAddress("connection-a", "builder"),
      roles: ["builder"],
      joined_at: 1,
    },
  ],
  attrs: { queue: ["Review the adapter", "Finish the docs"] },
};
const groups = () =>
  buildGroupViews(
    [stored, { ...stored, id: "pair", kind: "team", members: [] }],
    [],
  );

test("Summary shows Pods from the shared view, with unknown PR evidence and the first Now item", () => {
  const html = renderToStaticMarkup(
    <GroupsSummaryContent groups={groups()} ready />,
  );
  expect(html).toContain("Pod · Chat");
  expect(html).toContain("Open PRs unknown");
  expect(html).toContain("Review the adapter");
  expect(html).not.toContain("Finish the docs");
  expect(html).not.toContain("Team · pair");
  expect(html).toContain("Open Pod · Chat in Groups");
  expect(html).not.toContain("group-over-limit");
});

test("current warnings and cached work remain distinguishable in Summary", () => {
  const group = groups()[0]!;
  const pullRequests: WorkItem[] = Array.from({ length: 3 }, (_, index) => ({
    key: `github:pr:example-org/widgets#${index + 1}`,
    source: "github",
    kind: "pull_request",
    ref: `example-org/widgets#${index + 1}`,
    title: "Synthetic change",
    url: `https://github.com/example-org/widgets/pull/${index + 1}`,
    lane: "review",
    status: "open",
    roles: ["author"],
    updatedAt: 1,
  }));
  const current = {
    ...group,
    workState: "current" as const,
    overLimit: true,
    openPullRequests: pullRequests,
  };
  const html = renderToStaticMarkup(
    <GroupsSummaryContent groups={[current]} ready />,
  );
  expect(html).toContain("3/2 open PRs");
  expect(html).toContain("group-over-limit");
  const cached = renderToStaticMarkup(
    <GroupsSummaryContent
      groups={[{ ...current, workState: "stale", overLimit: false }]}
      ready
    />,
  );
  expect(cached).toContain("3/2 open PRs · cached");
  expect(cached).not.toContain("group-over-limit");
});

test("Summary distinguishes loading, unavailable and an observed empty Pod roster", () => {
  expect(
    renderToStaticMarkup(<GroupsSummaryContent groups={[]} ready={false} />),
  ).toContain("Loading Pods");
  const failed = renderToStaticMarkup(
    <GroupsSummaryContent
      groups={[]}
      ready={false}
      error="Board unavailable"
    />,
  );
  expect(failed).toContain("Board unavailable");
  expect(failed).not.toContain("No Pods yet");
  expect(
    renderToStaticMarkup(<GroupsSummaryContent groups={[]} ready />),
  ).toContain("No Pods yet");
});

test("Town places Pods after Hosts and before Spend without changing reception", () => {
  const summary: TownSummary = {
    counts: { needsYou: 0, working: 0, finished: 0 },
    needsYou: [],
    asks: [],
    finished: [],
    hosts: [],
    spend: { available: false },
  };
  const props = {
    summary,
    now: 1,
    onOpenAgent: () => {},
    onShowRoom: () => {},
    askActions: {
      askers: new Map(),
      answer: async () => null,
      dismiss: async () => null,
      open() {},
    },
  };
  const baseline = renderToStaticMarkup(<TownSummaryPanel {...props} />);
  const html = renderToStaticMarkup(
    <TownSummaryPanel
      {...props}
      groups={<GroupsSummaryContent groups={groups()} ready />}
    />,
  );
  const pods = html.indexOf('id="groups-summary-title"');
  expect(pods).toBeGreaterThan(html.indexOf('id="town-summary-hosts"'));
  expect(pods).toBeLessThan(html.indexOf('id="town-summary-spend"'));
  const reception = (text: string) =>
    text.slice(
      text.indexOf('aria-labelledby="town-summary-needs"'),
      text.indexOf('aria-labelledby="town-summary-hosts"'),
    );
  expect(reception(html)).toBe(reception(baseline));
});
