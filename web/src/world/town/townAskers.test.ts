import { expect, test } from "bun:test";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import type { WorldAsk } from "../worldAsks";
import type { WorldLeafObject } from "../worldObject";
import { townAskers } from "./townAskers";

const leaf = (id: string, pane: string, terminal: string) =>
  ({
    id,
    connectionId: "alpha",
    generation: 1,
    terminalId: terminal,
    pane: { pane_id: pane },
    actionable: true,
    stale: false,
  }) as WorldLeafObject;

const asked = (id: string, pane: string, terminal?: string): WorldAsk => ({
  id,
  at: 1,
  question: "Which?",
  options: [],
  owner_only: true,
  actor: {
    label: `unverified ${pane}`,
    verified: false,
    pane_id: pane,
    ...(terminal
      ? {
          connection_id: "alpha",
          connection_generation: 1,
          terminal_id: terminal,
          name: "herdr-name",
        }
      : {}),
  },
});

test("no questions require no topology or roster lookup", () => {
  const unused = new Proxy(
    {},
    {
      get() {
        throw new Error("read unrelated topology for an empty question list");
      },
    },
  );
  expect(
    townAskers(
      [],
      unused as Parameters<typeof townAskers>[1],
      unused as Parameters<typeof townAskers>[2],
    ).size,
  ).toBe(0);
});

test("every placed asker is named as Town labels its desk, others by what they carry", () => {
  const office = {
    roster: [{ agent: { key: "agent-leaf", displayLabel: "dispatch" } }],
    paneRoster: [
      { device: { nodeId: "shell-leaf", displayLabel: "watcher shell" } },
    ],
  } as unknown as Pick<HerdrOfficeProjection, "roster" | "paneRoster">;
  const world = {
    leaves: [
      leaf("agent-leaf", "w1:p1", "term-a"),
      leaf("shell-leaf", "w1:p2", "term-b"),
    ],
  };
  const askers = townAskers(
    [
      asked("q-agent", "w1:p1", "term-a"),
      asked("q-agent-again", "w1:p1", "term-a"),
      asked("q-shell", "w1:p2", "term-b"),
      asked("q-gone", "w1:p1", "term-old"),
      asked("q-bare", "w1:p9"),
    ],
    world,
    office,
  );
  expect(Object.fromEntries(askers)).toEqual({
    "q-agent": { name: "dispatch", key: "agent-leaf", terminal: false },
    // A second question from the same pane is placed and named the same.
    "q-agent-again": { name: "dispatch", key: "agent-leaf", terminal: false },
    // A pane without an agent opens its terminal.
    "q-shell": { name: "watcher shell", key: "shell-leaf", terminal: true },
    // Its terminal is gone: named as it asked, with nothing to open.
    "q-gone": { name: "herdr-name", key: null, terminal: false },
    "q-bare": { name: "w1:p9", key: null, terminal: false },
  });
});
