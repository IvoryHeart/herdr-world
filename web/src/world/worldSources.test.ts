import { describe, expect, test } from "bun:test";
import type {
  WorkItem,
  WorldSourcesSnapshot,
} from "../../../shared/worldSources";
import { fixtureHost, fixtureWorld } from "./board/boardFixture";
import { workCardFacts, workLensColumns } from "./board/workLensModel";
import type { HerdrOfficeProjection } from "./herdrOfficeProjection";
import { sameTownBadges, townDeskBadges } from "./town/townBadges";
import {
  parseWorldSources,
  updateWorldSource,
  workItemsByPane,
  worldSourcesStore,
} from "./worldSources";

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
): WorldSourcesSnapshot => ({
  observedAt: 1,
  refreshing: false,
  sources: [],
  items,
  links,
  actions: [],
});

const link = (
  paneId: string,
  itemKey: string,
  fields: { generation?: number; sessionFingerprint?: string | null } = {},
) => ({
  connectionId: "local-1",
  generation: 1,
  paneId,
  sessionFingerprint: null,
  itemKey,
  via: "branch" as const,
  ...fields,
});

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
        { ...link("p", pr(1).key), connectionId: "c" },
        { ...link("p", pr(2).key), connectionId: "c" },
        { ...link("p", pr(1).key), connectionId: "c", via: "guess" },
        // A link without its runtime generation is not trusted.
        { ...link("p", pr(1).key), connectionId: "c", generation: undefined },
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
        link(leaf.nativeId, pr(2).key, { generation: leaf.generation }),
        // The same pane ID in another runtime generation or agent session
        // is a different pane.
        link(leaf.nativeId, pr(1).key, { generation: leaf.generation + 1 }),
        link(leaf.nativeId, pr(3).key, {
          generation: leaf.generation,
          sessionFingerprint: "f".repeat(64),
        }),
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
      { id: leaf.id, label: "login", idle: false },
    ]);
    expect(columns[0]!.cards.flatMap((card) => card.agents)).toEqual([]);
    const tickets = workLensColumns(data, world, "tickets");
    expect(tickets.map((column) => column.cards.length)).toEqual([0, 1, 0]);
    expect(
      workCardFacts(
        pr(4, { draft: true, mergeable: "conflicting", checks: "fail" }),
      ),
    ).toEqual(["draft", "conflicts", "checks failing"]);
  });

  test("history columns group a busy week by the day each one finished", () => {
    const world = fixtureWorld([]);
    const now = new Date(2026, 2, 10, 15).getTime();
    const at = (day: number, hour: number) =>
      new Date(2026, 2, day, hour).getTime();
    const merged = Array.from({ length: 150 }, (_, index) =>
      pr(100 + index, {
        lane: "merged",
        status: "merged",
        // A comment after merging moves updatedAt, not the day it merged.
        updatedAt: now,
        finishedAt: at(10 - (index % 5), 9),
      }),
    );
    const [column] = workLensColumns(
      snapshot(merged, []),
      world,
      "pull_requests",
      now,
    ).filter((entry) => entry.lane === "merged");
    expect(column!.cards).toHaveLength(150);
    expect(column!.days!.map((day) => [day.key, day.cards.length])).toEqual([
      ["2026-03-10", 30],
      ["2026-03-09", 30],
      ["2026-03-08", 30],
      ["2026-03-07", 30],
      ["2026-03-06", 30],
    ]);
    expect(column!.days!.slice(0, 2).map((day) => day.label)).toEqual([
      "Today",
      "Yesterday",
    ]);
    // A Done ticket groups by when it was resolved, not its last comment.
    const done = workLensColumns(
      snapshot(
        [{ ...ticket, lane: "done", updatedAt: now, finishedAt: at(8, 9) }],
        [],
      ),
      world,
      "tickets",
      now,
    ).find((entry) => entry.lane === "done")!;
    expect(done.days!.map((day) => day.key)).toEqual(["2026-03-08"]);
    const open = workLensColumns(
      snapshot(merged, []),
      world,
      "pull_requests",
      now,
    );
    expect(open[0]!.days).toBeUndefined();
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
                  paneRef: {
                    connectionId: "local-1",
                    generation: 1,
                    nativeId: "p1",
                  },
                },
              ],
            },
            {
              key: "desk-2",
              paneDevices: [
                // A shell pane is never badged.
                {
                  paneRef: {
                    connectionId: "local-1",
                    generation: 1,
                    nativeId: "p2",
                  },
                },
              ],
            },
          ],
        },
      ],
    } as unknown as HerdrOfficeProjection;
    const links = [
      link("p1", ticket.key),
      link("p1", pr(12).key),
      link("p2", pr(13).key),
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
    // Another repository's #12 with the same state is a different badge.
    const elsewhere = new Map([
      [
        "desk-1",
        {
          ...badges.get("desk-1")!,
          url: "https://github.com/example-org/gadgets/pull/12",
        },
      ],
    ]);
    expect(sameTownBadges(badges, elsewhere)).toBe(false);
    const current = () => ({ generation: 1 });
    expect(
      workItemsByPane(snapshot([ticket], links), current).get("local-1\0p1"),
    ).toEqual([ticket]);
    // After a runtime restart reuses p1, the old link shows nothing.
    expect(
      workItemsByPane(snapshot([ticket], links), () => ({ generation: 2 }))
        .size,
    ).toBe(0);
  });

  test("a settings save wins over a refresh that started before it", async () => {
    let answer!: (response: Response) => void;
    worldSourcesStore.useFetch(
      () => new Promise<Response>((resolve) => (answer = resolve)),
    );
    const older = worldSourcesStore.refresh();
    const saved = snapshot([ticket]);
    await updateWorldSource("jira", { enabled: true }, async () =>
      Response.json(saved),
    );
    answer(Response.json(snapshot([pr(1)])));
    await older;
    expect(worldSourcesStore.snapshot().items).toEqual([ticket]);
  });
});
