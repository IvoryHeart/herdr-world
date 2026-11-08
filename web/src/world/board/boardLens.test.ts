import { expect, test } from "bun:test";
import type {
  WorkItem,
  WorldSourcesSnapshot,
} from "../../../../shared/worldSources";
import {
  projectWorldOffice,
  TOWN_PRESENTATION_BOUNDS,
} from "../herdrOfficeProjection";
import { deskBadges } from "../town/townBadges";
import {
  lensView,
  TOWN_LENSES,
  townLensView,
  type TownLensMark,
} from "../town/townLens";
import { townModelFromProjection } from "../town/townModel";
import { townScaleLensFacts } from "../town/townScaleLens";
import { townScaleConnections } from "../town/townScaleScene";
import { buildWorldObject } from "../worldObject";
import { fixtureHost, fixtureWorld } from "./boardFixture";
import {
  boardDeskWork,
  boardLensDeskKey,
  boardLensMark,
  boardLensPlaces,
  boardLensReadout,
  boardLensSelected,
  boardSceneWork,
} from "./boardLens";
import { projectBoard } from "./boardModel";

const NOW = Date.UTC(2026, 10, 8, 12);

function scale() {
  const hosts = townScaleConnections();
  const world = buildWorldObject(hosts, hosts[0]!.connectionId);
  const town = townModelFromProjection(
    projectWorldOffice(world, 1, null, TOWN_PRESENTATION_BOUNDS),
  );
  return { world, town, board: projectBoard(world) };
}

function facts(places: ReturnType<typeof boardLensPlaces>) {
  return townScaleLensFacts(NOW, (workspaceId) => {
    const room = places.rooms.find(
      (candidate) => candidate.workspaceRef.nativeId === workspaceId,
    );
    return room ? room.desks.map((desk) => desk.tabRef.nativeId) : [];
  });
}

const words = (marks: ReadonlyMap<string, TownLensMark>) =>
  [...marks].map(([key, mark]) => [key, mark.swatch, mark.words]);

test("every lens reads the same fact on Board's cards as on Town's places", () => {
  const { town, board } = scale();
  const places = boardLensPlaces(board);
  expect(places.rooms.map((room) => room.key).sort()).toEqual(
    [...town.rooms.keys()].sort(),
  );
  for (const lens of TOWN_LENSES) {
    const onTown = townLensView(lens, town, facts(places));
    const onBoard = lensView(lens, places, facts(places));
    if (lens === "attention") {
      expect(onTown).toBeNull();
      expect(onBoard).toBeNull();
      continue;
    }
    expect(onBoard!.rooms.size).toBeGreaterThan(0);
    // The scene's rooms fit Town's bounds: both views show every desk.
    expect(board.tabs.length).toBe(town.desks.size);
    expect(words(onBoard!.rooms).sort()).toEqual(words(onTown!.rooms).sort());
    expect(words(onBoard!.desks).sort()).toEqual(words(onTown!.desks).sort());
    expect(words(onBoard!.agents).sort()).toEqual(words(onTown!.agents).sort());
    expect(onBoard!.note).toBe(onTown!.note);
    // Each workspace and tab card finds its own reading.
    for (const space of board.workspaces)
      expect(boardLensMark(onBoard, board, space.key)).toBe(
        onBoard!.rooms.get(space.space.id),
      );
    for (const tab of board.tabs)
      expect(boardLensMark(onBoard, board, tab.key)).toBe(
        onBoard!.desks.get(boardLensDeskKey(tab)),
      );
  }
});

test("the scale scene badges the tabs its Pull requests lens colours", () => {
  const { board } = scale();
  const places = boardLensPlaces(board);
  const work = boardSceneWork(places, NOW);
  expect(work.size).toBeGreaterThan(10);
  const pulls = lensView("pulls", places, facts(places))!;
  expect([...work.keys()].sort()).toEqual([...pulls.desks.keys()].sort());
  const badges = deskBadges(work);
  for (const [key, item] of work)
    expect(badges.get(key)!.text).toStartWith(`#${item.number}`);
});

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

const link = (paneId: string, itemKey: string) => ({
  connectionId: "local-1",
  generation: 1,
  paneId,
  sessionFingerprint: null,
  itemKey,
  via: "branch" as const,
});

test("a tab card shows its agent's linked pull request, never a shell's", () => {
  const board = projectBoard(
    fixtureWorld([
      fixtureHost("local-1", [
        {
          label: "api",
          tabs: [
            { label: "fix", panes: [["working"]] },
            { label: "shell", panes: [["idle", false]] },
          ],
        },
      ]),
    ]),
  );
  const sources: WorldSourcesSnapshot = {
    observedAt: 1,
    refreshing: false,
    sources: [],
    items: [pr(12, { lane: "fixing", checks: "fail" }), pr(13)],
    links: [link("w1:p1", pr(12).key), link("w1:p2", pr(13).key)],
    actions: [],
  };
  const work = boardDeskWork(board, sources);
  const [fix, shell] = board.tabs;
  expect(work.get(boardLensDeskKey(fix!))?.number).toBe(12);
  expect(work.has(boardLensDeskKey(shell!))).toBe(false);
  expect(deskBadges(work).get(boardLensDeskKey(fix!))).toMatchObject({
    text: "#12 ✗",
    tone: "fail",
  });
  // The Pull requests lens colours that card failing, and reads it.
  const places = boardLensPlaces(board);
  const view = lensView("pulls", places, {
    now: NOW,
    activityAt: () => undefined,
    economy: () => ({ status: "none" }),
    work: (desk) => work.get(desk.key),
    quest: () => undefined,
  });
  expect(boardLensReadout(view, board, { key: fix!.key })).toBe(
    "fix: #12 CI failing",
  );
  expect(boardLensReadout(view, board, { key: shell!.key })).toBe(
    "shell: nothing to show",
  );
  expect(
    boardLensReadout(view, board, boardLensSelected(board, "space:local-1:w1")),
  ).toBe("api: 1 failing");
  expect(boardLensReadout(null, board, { key: fix!.key })).toBeNull();
});

test("a tab card's badge shows its pull request's state, from World sources", async () => {
  const { createElement: h } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { worldSourcesStore } = await import("../worldSources");
  const { BoardTabBadge, BoardWorkBadges } = await import("./BoardLenses");
  const board = projectBoard(
    fixtureWorld([
      fixtureHost("local-1", [
        {
          label: "api",
          tabs: [
            { label: "fix", panes: [["working"]] },
            { label: "docs", panes: [["idle"]] },
          ],
        },
      ]),
    ]),
  );
  // The shared store: restored after, for the other tests in this run.
  const before = worldSourcesStore.snapshot();
  worldSourcesStore.publishSettled({
    observedAt: 1,
    refreshing: false,
    sources: [],
    items: [pr(12, { lane: "fixing", checks: "fail" })],
    links: [link("w1:p1", pr(12).key)],
    actions: [],
  });
  const render = (tab: (typeof board.tabs)[number]) =>
    renderToStaticMarkup(
      h(BoardWorkBadges, {
        model: board,
        children: h(BoardTabBadge, { tab }),
      }),
    );
  const [fix, docs] = board.tabs;
  const badge = render(fix!);
  expect(badge).toContain('class="board-work-badge"');
  expect(badge).toContain('data-tone="fail"');
  expect(badge).toContain("#12 ✗");
  // A pull request World cannot act on links to it, as on Town's desks.
  expect(badge).toContain('aria-label="#12 ✗ at fix"');
  expect(badge).toContain(`href="${pr(12).url}"`);
  // A tab with no linked work has no badge.
  expect(render(docs!)).toBe("");
  worldSourcesStore.publishSettled(before);
});
