import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  HerdrOfficeProjection,
  OfficeAgent,
  OfficeDesk,
} from "../herdrOfficeProjection";
import { setOfficeReadModel } from "../officeReadModel";
import { boundedDesks } from "../officeDesks";
import type { WorldAsk } from "../worldAsks";
import type { TownCall } from "./TownRail";
import { townFoldedActivity } from "./townFoldedActivity";
import { TownFoldIndicators } from "./TownFoldIndicators";

const agent = (key: string): OfficeAgent =>
  ({
    key,
    roomKey: "room",
    deskKey: key,
    semanticStatus: "done",
    currentTerminalRef: { nativeId: `terminal-${key}` },
  }) as OfficeAgent;
const blocked = agent("hidden-blocked"),
  done = agent("hidden-done"),
  shown = agent("shown");
const call = (agent: OfficeAgent, kind: TownCall["kind"]): TownCall =>
  ({ agent, kind }) as TownCall;
const question = (
  connection = "alpha",
  terminal = "terminal-hidden-done",
  verified = true,
): WorldAsk =>
  ({
    id: "ask",
    actor: {
      label: "Synthetic",
      verified,
      connection_id: connection,
      pane_id: "pane",
      terminal_id: terminal,
    },
  }) as WorldAsk;
function office(revealed = false) {
  const value = {
    rooms: [
      {
        key: "room",
        desks: (revealed ? [shown, blocked, done] : [shown]).map((a) => ({
          key: a.deskKey,
        })),
      },
    ],
  } as HerdrOfficeProjection;
  setOfficeReadModel(value, {
    roomCounts: new Map(),
    agentOf: () => undefined,
    agentForPane: (connection, pane) =>
      connection === "alpha" && pane === "pane" ? done : undefined,
  });
  return value;
}

test("Town folds a prefix of its seat order: pins first, never attention, selection or last tabs", () => {
  const desks = Array.from({ length: 26 }, (_, order) => ({
    key: `desk-${order}`,
    order,
  })) as OfficeDesk[];
  const agents = desks.map((d) => ({
    deskKey: d.key,
    semanticStatus: "working" as const,
  }));
  const choose = (input: OfficeDesk[], pinned: OfficeDesk | undefined) =>
    boundedDesks(
      input,
      agents,
      24,
      (d) => d.key === desks[25]!.key,
      (d) => d === pinned,
      true,
    );
  expect(choose(desks, undefined)).toEqual(desks.slice(0, 24));
  const reordered = [desks[25]!, ...desks.slice(0, 25)];
  expect(choose(reordered, undefined)).toEqual(reordered.slice(0, 24));
  // A pinned later tab is admitted; the last unpinned tab of the prefix folds.
  expect(choose(desks, desks[24])).toEqual([...desks.slice(0, 23), desks[24]!]);
  expect(
    boundedDesks(
      desks,
      [],
      26,
      () => false,
      () => false,
      true,
    ),
  ).toEqual(desks);
});

test("hidden indicators follow shared calls and clear when revealed or calls are removed", () => {
  const calls = [
    call(shown, "blocked"),
    call(blocked, "blocked"),
    call(done, "done"),
  ];
  expect(townFoldedActivity(office(), calls, []).get("room")).toEqual({
    needsYou: true,
    done: true,
  });
  expect(townFoldedActivity(office(true), calls, []).size).toBe(0);
  expect(townFoldedActivity(office(), [], []).size).toBe(0);
  expect(
    townFoldedActivity(office(), [call(done, "done")], []).get("room"),
  ).toEqual({ needsYou: false, done: true });
});

test("hidden ask indicators require verified qualified identity and matching terminal", () => {
  expect(townFoldedActivity(office(), [], [question()]).get("room")).toEqual({
    needsYou: true,
    done: false,
  });
  for (const ask of [
    question("beta"),
    question("alpha", "replaced"),
    question("alpha", "terminal-hidden-done", false),
  ])
    expect(townFoldedActivity(office(), [], [ask]).size).toBe(0);
  expect(townFoldedActivity(office(true), [], [question()]).size).toBe(0);
});

test("fold corners render red needs-you and green completion icons without additional counts", () => {
  const html = renderToStaticMarkup(
    createElement(TownFoldIndicators, {
      activity: { needsYou: true, done: true },
    }),
  );
  expect(html).toContain('class="town-fold-needs"');
  expect(html).toContain('class="town-fold-done"');
  expect(html).toContain(">!</span>");
  expect(html).toContain(">✓</span>");
  expect(html).toContain(
    'aria-label="Hidden desks need you. Hidden desks have unreviewed completions"',
  );
  expect(
    renderToStaticMarkup(
      createElement(TownFoldIndicators, { activity: undefined }),
    ),
  ).toBe("");
});
