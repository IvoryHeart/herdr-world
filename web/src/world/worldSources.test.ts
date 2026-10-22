import { describe, expect, test } from "bun:test";
import type {
  WorkItem,
  WorldSourcesSnapshot,
} from "../../../shared/worldSources";
import { fixtureHost, fixtureWorld } from "./board/boardFixture";
import { workCardFacts, workLensColumns } from "./board/workLensModel";
import type { HerdrOfficeProjection } from "./herdrOfficeProjection";
import { sameTownBadges, townDeskBadges } from "./town/townBadges";
import { parseWorldSources, workItemsByPane } from "./worldSources";

const pr = (number: number, fields: Partial<WorkItem> = {}): WorkItem => ({
  key: `github:pr:example-org/widgets#${number}`,
  source: "github",
  kind: "pull_request",
  ref: `example-org/widgets#${number}`,
  title: `Synthetic ${number}`,
  url: `https://github.com/example-org/widgets/pull/${number}`,
  lane: "review",
  status: "open",
  roles: ["author"],
  updatedAt: number,
  number,
  repo: "example-org/widgets",
  checks: "pending",
  ...fields,
});

const ticket: WorkItem = {
  key: "jira:ABC-1",
  source: "jira",
  kind: "ticket",
  ref: "ABC-1",
  title: "Synthetic ticket",
  url: "https://example.atlassian.net/browse/ABC-1",
  lane: "doing",
  status: "In Progress",
  roles: ["assignee"],
  updatedAt: 5,
};

const snapshot = (
  items: WorkItem[],
  links: WorldSourcesSnapshot["links"] = [],
): WorldSourcesSnapshot => ({ observedAt: 1, sources: [], items, links });

describe("World sources in the browser", () => {
  test("decoding drops malformed items, unsafe URLs and links to unknown items", () => {
    const decoded = parseWorldSources({
      observedAt: 7,
      sources: [
        {
          id: "jira",
          label: "Jira",
          enabled: true,
          state: "connected",
          detail: "ok",
          checkedAt: 1,
          lastSuccessAt: 1,
          itemCount: 1,
          config: {
            kind: "jira",
            site: null,
            email: null,
            jql: "x",
            tokenSet: true,
            token: "leak",
          },
        },
        { id: "other", state: "connected" },
      ],
      items: [
        pr(1),
        { ...pr(2), url: "javascript:alert(1)" },
        { ...pr(3), lane: "nowhere" },
      ],
      links: [
        { connectionId: "c", paneId: "p", itemKey: pr(1).key, via: "branch" },
        { connectionId: "c", paneId: "p", itemKey: pr(2).key, via: "branch" },
        { connectionId: "c", paneId: "p", itemKey: pr(1).key, via: "guess" },
      ],
    });
    expect(decoded.items.map((item) => item.number)).toEqual([1]);
    expect(decoded.links).toHaveLength(1);
    expect(decoded.sources.map((source) => source.id)).toEqual(["jira"]);
    expect(JSON.stringify(decoded)).not.toContain("leak");
  });

  test("the Work lens lays pull requests by lane and names linked agents", () => {
    const world = fixtureWorld([
      fixtureHost("local-1", [
        { label: "widgets", tabs: [{ label: "login", panes: [["working"]] }] },
      ]),
    ]);
    const leaf = world.leaves[0]!;
    const data = snapshot(
      [
        pr(1),
        pr(2, { lane: "fixing", checks: "fail" }),
        pr(3, { lane: "review", updatedAt: 9 }),
        ticket,
      ],
      [
        {
          connectionId: "local-1",
          paneId: leaf.nativeId,
          itemKey: pr(2).key,
          via: "branch",
        },
      ],
    );
    const columns = workLensColumns(data, world, "pull_requests");
    expect(columns.map((column) => column.lane)).toEqual([
      "review",
      "fixing",
      "green",
      "ready",
      "merged",
    ]);
    expect(columns[0]!.cards.map((card) => card.item.number)).toEqual([3, 1]);
    expect(columns[1]!.cards[0]!.agents).toEqual([
      { id: leaf.id, label: "login" },
    ]);
    const tickets = workLensColumns(data, world, "tickets");
    expect(tickets.map((column) => column.cards.length)).toEqual([0, 1, 0]);
    expect(
      workCardFacts(
        pr(4, { draft: true, mergeable: "conflicting", checks: "fail" }),
      ),
    ).toEqual(["draft", "conflicts", "checks failing"]);
  });

  test("a desk shows its agent's open pull request before a ticket", () => {
    const projection = {
      rooms: [
        {
          desks: [
            {
              key: "desk-1",
              paneDevices: [
                {
                  agentKey: "a1",
                  paneRef: { connectionId: "local-1", nativeId: "p1" },
                },
              ],
            },
            {
              key: "desk-2",
              paneDevices: [
                // A shell pane is never badged.
                { paneRef: { connectionId: "local-1", nativeId: "p2" } },
              ],
            },
          ],
        },
      ],
    } as unknown as HerdrOfficeProjection;
    const links = [
      {
        connectionId: "local-1",
        paneId: "p1",
        itemKey: ticket.key,
        via: "branch" as const,
      },
      {
        connectionId: "local-1",
        paneId: "p1",
        itemKey: pr(12).key,
        via: "branch" as const,
      },
      {
        connectionId: "local-1",
        paneId: "p2",
        itemKey: pr(13).key,
        via: "branch" as const,
      },
    ];
    const badges = townDeskBadges(
      projection,
      snapshot(
        [ticket, pr(12, { lane: "fixing", checks: "fail" }), pr(13)],
        links,
      ),
    );
    expect([...badges]).toEqual([
      [
        "desk-1",
        {
          text: "#12 ✗",
          tone: "fail",
          url: "https://github.com/example-org/widgets/pull/12",
        },
      ],
    ]);
    expect(sameTownBadges(badges, new Map(badges))).toBe(true);
    expect(sameTownBadges(badges, new Map())).toBe(false);
    expect(
      workItemsByPane(snapshot([ticket], links)).get("local-1\0p1"),
    ).toEqual([ticket]);
  });
});
