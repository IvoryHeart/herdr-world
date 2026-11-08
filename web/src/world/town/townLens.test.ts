import { expect, test } from "bun:test";
import { ClipboardList, UserPlus } from "lucide-react";
import type { WorkItem } from "../../../../shared/worldSources";
import {
  projectWorldOffice,
  TOWN_PRESENTATION_BOUNDS,
} from "../herdrOfficeProjection";
import { buildWorldObject } from "../worldObject";
import type { TownCenterAction } from "./TownCenterMenu";
import { townLensReadout, townLensTargets, withLensAction } from "./TownLenses";
import {
  TOWN_LENSES,
  townHarnessOf,
  townIdleSwatch,
  townIdleWords,
  townLensStep,
  townLensView,
  townPullState,
  townQuestShare,
  townRoomIdle,
  townSpendMarks,
  type TownLensFacts,
  type TownLensId,
} from "./townLens";
import { townModelFromProjection } from "./townModel";
import type { TownPlaceEconomy } from "./townPlaceUsage";
import { townScaleLensFacts } from "./townScaleLens";
import { townScaleConnections } from "./townScaleScene";
import type { TownTarget } from "./townTargets";

const NOW = Date.UTC(2026, 10, 8, 12);

function scaleModel() {
  const hosts = townScaleConnections();
  const office = projectWorldOffice(
    buildWorldObject(hosts, hosts[0]!.connectionId),
    1,
    null,
    TOWN_PRESENTATION_BOUNDS,
  );
  return townModelFromProjection(office);
}

function scaleFacts(model: ReturnType<typeof scaleModel>) {
  return townScaleLensFacts(NOW, (workspaceId) => {
    const room = [...model.rooms.values()].find(
      (candidate) => candidate.workspaceRef.nativeId === workspaceId,
    );
    return room ? room.desks.map((desk) => desk.tabRef.nativeId) : [];
  });
}

const ready = (
  tokens: number,
  costUsd: number | null = tokens / 1000,
): TownPlaceEconomy => ({
  status: "ready",
  costUsd,
  price: costUsd === null ? "no-table" : "priced",
  tokens,
  models: ["m"],
  partial: false,
});

test("idle time runs warm to cold in five bands, with its value in words", () => {
  const minute = 60_000;
  expect(townIdleSwatch(0)).toBe(0);
  expect(townIdleSwatch(4 * minute)).toBe(0);
  expect(townIdleSwatch(5 * minute)).toBe(1);
  expect(townIdleSwatch(45 * minute)).toBe(2);
  expect(townIdleSwatch(3 * 60 * minute)).toBe(3);
  expect(townIdleSwatch(9 * 60 * minute)).toBe(4);
  expect(townIdleWords(30_000)).toBe("under a minute");
  expect(townIdleWords(12 * minute)).toBe("12 m");
  expect(townIdleWords(192 * minute)).toBe("3 h 12 m");
  expect(townIdleWords(26 * 60 * minute)).toBe("1 d 2 h");
  // A room with one forgotten agent among workers still reads cold.
  expect(townRoomIdle([0, 0, 0, 120 * minute])).toBe(120 * minute);
  expect(townRoomIdle([5 * minute])).toBe(5 * minute);
});

test("spend never draws a missing number as zero", () => {
  const { marks } = townSpendMarks(
    new Map<string, TownPlaceEconomy>([
      ["top", ready(1_000_000)],
      ["low", ready(50_000)],
      ["zero", { status: "none" }],
      ["host", { status: "no-data" }],
      ["reading", { status: "loading" }],
      ["old", { status: "stale" }],
      ["failed", { status: "unavailable" }],
    ]),
  );
  expect(marks.get("top")).toEqual({
    swatch: 4,
    words: "~$1000.00 today · 1.0M tokens",
    short: "~$1000.00",
  });
  expect(marks.get("low")?.swatch).toBe(1);
  // Recorded zero usage is its own "None", a real reading.
  expect(marks.get("zero")).toEqual({
    swatch: 0,
    words: "No usage today",
    short: "0",
  });
  for (const key of ["host", "reading", "old", "failed"])
    expect(marks.get(key)?.swatch).toBe("no-data");
  expect(marks.get("host")?.words).toBe("No usage data from this host");
});

test("spend scales by tokens when any place is unpriced, and says so", () => {
  const { marks, by } = townSpendMarks(
    new Map<string, TownPlaceEconomy>([
      ["priced", ready(100_000, 5)],
      ["unpriced", ready(400_000, null)],
    ]),
  );
  expect(by).toBe("tokens");
  expect(marks.get("unpriced")).toEqual({
    swatch: 4,
    words: "400.0k tokens today, not priced",
    short: "400.0k",
  });
  expect(marks.get("priced")?.swatch).toBe(2);
});

test("a linked pull request reads as the Work lens does", () => {
  const pr = (fields: Partial<WorkItem>): WorkItem => ({
    key: "k",
    source: "github",
    kind: "pull_request",
    ref: "example/town#7",
    title: "t",
    url: "https://example.com/7",
    lane: "review",
    status: "open",
    roles: ["author"],
    updatedAt: 0,
    number: 7,
    ...fields,
  });
  expect(townPullState(pr({ lane: "fixing", checks: "fail" }))).toEqual({
    state: "failing",
    words: "#7 CI failing",
  });
  expect(townPullState(pr({ lane: "ready", checks: "pass" }))?.words).toBe(
    "#7 ready to merge",
  );
  expect(townPullState(pr({ lane: "review", checks: "pending" }))?.words).toBe(
    "#7 checks running",
  );
  expect(townPullState(pr({ lane: "review", draft: true }))?.state).toBe(
    "draft",
  );
  expect(townPullState(pr({ lane: "merged" }))?.state).toBe("merged");
  expect(townPullState(pr({ kind: "ticket" }))).toBeNull();
});

test("quests and harnesses map to their scales", () => {
  const quest = { title: "q", progress: "2/4", done: 2, total: 4 };
  expect(townQuestShare({ ...quest, status: "active" })).toBe(0.5);
  expect(townQuestShare({ ...quest, status: "done" })).toBe(1);
  expect(townQuestShare({ ...quest, total: 0, status: "active" })).toBe(0);
  expect(townHarnessOf({ harness: "Claude" })).toBe("claude");
  expect(townHarnessOf({ harness: "aider" })).toBe("other");
  expect(townHarnessOf({})).toBe("other");
});

test("L steps through every lens and wraps to Attention", () => {
  let lens: TownLensId = "attention";
  const seen: TownLensId[] = [];
  for (let i = 0; i < TOWN_LENSES.length; i++)
    seen.push((lens = townLensStep(lens, 1)));
  expect(seen).toEqual([...TOWN_LENSES.slice(1), "attention"]);
  expect(townLensStep("attention", -1)).toBe("harness");
});

test("Attention is Town as usual: no lens view at all", () => {
  const model = scaleModel();
  expect(townLensView("attention", model, scaleFacts(model))).toBeNull();
});

test("the scale scene gives every lens a varied map", () => {
  const model = scaleModel();
  const facts = scaleFacts(model);
  for (const lens of TOWN_LENSES.slice(1)) {
    const view = townLensView(lens, model, facts)!;
    const swatches = new Set(
      [...view.rooms.values(), ...view.desks.values()].map(
        (mark) => mark.swatch,
      ),
    );
    // At least three looks per lens across the town.
    expect(swatches.size).toBeGreaterThanOrEqual(3);
    for (const mark of [...view.rooms.values(), ...view.desks.values()])
      expect(mark.words.length).toBeGreaterThan(0);
  }
});

test("spend in the scene: one host has no data, named, never zero", () => {
  const model = scaleModel();
  const view = townLensView("spend", model, scaleFacts(model))!;
  const zephyr = [...model.rooms.values()].filter((room) =>
    room.workspaceRef.connectionId.endsWith("zephyr"),
  );
  expect(zephyr.length).toBeGreaterThan(0);
  for (const room of zephyr)
    expect(view.rooms.get(room.key)?.swatch).toBe("no-data");
  expect(view.noData).toBe(true);
  expect(view.note).toContain("No data: zephyr");
  // Other hosts' rooms have real readings.
  const others = [...model.rooms.values()].filter(
    (room) => !zephyr.includes(room),
  );
  expect(
    others.every(
      (room) => typeof view.rooms.get(room.key)?.swatch === "number",
    ),
  ).toBe(true);
});

test("an agent without activity reads unknown, not fresh", () => {
  const model = scaleModel();
  const facts: TownLensFacts = {
    ...scaleFacts(model),
    activityAt: () => undefined,
  };
  const view = townLensView("idle", model, facts)!;
  for (const agent of model.agents.values()) {
    const mark = view.agents.get(agent.key)!;
    if (agent.semanticStatus === "working" && !agent.stale)
      expect(mark.words).toBe("Working now");
    else expect(mark.swatch).toBe("no-data");
  }
});

test("targets and the legend name a place's reading", () => {
  const model = scaleModel();
  const view = townLensView("harness", model, scaleFacts(model))!;
  const room = [...model.rooms.values()][0]!;
  const target: TownTarget = {
    key: room.key,
    kind: "room",
    label: "Room orbit, atlas",
    rect: { x: 0, y: 0, width: 1, height: 1 },
    canActivate: true,
  };
  const [named] = townLensTargets([target], view);
  expect(named!.label).toBe(
    `Room orbit, atlas. Harness: ${view.rooms.get(room.key)!.words}`,
  );
  expect(townLensTargets([target], null)[0]).toBe(target);
  expect(townLensReadout(view, model, room.key)).toBe(
    `${room.displayLabel}: ${view.rooms.get(room.key)!.words}`,
  );
});

test("the ring offers Lenses right after Summary", () => {
  const action = (id: string, icon = UserPlus): TownCenterAction => ({
    id,
    label: id,
    icon,
    run: () => {},
  });
  const state = {
    lens: "attention" as const,
    choosing: false,
    shown: false,
    pick() {},
    step() {},
    cycle() {},
    open() {},
    choose() {},
    close() {},
  };
  const ids = withLensAction(
    [action("launch"), action("summary", ClipboardList), action("room")],
    state,
  ).map((candidate) => candidate.id);
  expect(ids).toEqual(["launch", "summary", "lenses", "room"]);
});
