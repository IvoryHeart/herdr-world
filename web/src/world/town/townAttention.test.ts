import { expect, test } from "bun:test";
import type {
  HerdrOfficeProjection,
  OfficeAgent,
  OfficeRosterEntry,
} from "../herdrOfficeProjection";
import type { WorldAsk } from "../worldAsks";
import { townAttentionDesks } from "./townAttention";
import { townCalls, unseenTownCompletions } from "./TownRail";
import { withTownFinished } from "./townFinished";

function entry(
  key: string,
  status: OfficeAgent["semanticStatus"],
  connection = "alpha",
  stale = false,
): OfficeRosterEntry {
  return {
    agent: {
      key,
      displayLabel: key,
      canOpenInSpaces: true,
      deskKey: `desk-${key}`,
      semanticStatus: status,
      stale,
      currentPaneRef: { connectionId: connection, nativeId: `pane-${key}` },
      currentTerminalRef: { nativeId: `terminal-${key}` },
    },
  } as OfficeRosterEntry;
}
const ask = (key: string, verified = true, connection = "alpha"): WorldAsk => ({
  id: key,
  at: 1,
  actor: {
    label: "Synthetic asker",
    verified,
    connection_id: connection,
    pane_id: `pane-${key}`,
    terminal_id: `terminal-${key}`,
  },
  question: "Continue?",
  options: [],
  owner_only: true,
});

test("admission uses the shared calls, completion overlay and qualified asks, then releases removed items", () => {
  const roster = [
    entry("blocked", "blocked"),
    entry("done", "done"),
    entry("reviewed", "done"),
    entry("fresh", "idle"),
    entry("ask", "idle"),
    entry("unverified", "idle"),
    entry("other-host", "idle", "beta"),
    entry("stale", "idle", "alpha", true),
  ];
  const office = {
    roster,
    rooms: [],
    receptions: [],
    barAgents: [],
  } as unknown as HerdrOfficeProjection;
  const checked = new Set(["reviewed"]);
  const finished = new Set(["fresh"]);
  const semantic = withTownFinished(office, finished, checked);
  const unseen = unseenTownCompletions(semantic.roster, checked);
  const calls = townCalls(semantic.roster, new Map(), unseen, (key) =>
    semantic.roster.find(({ agent }) => agent.key === key),
  );
  const asks = [
    ask("ask"),
    ask("unverified", false),
    ask("other-host"),
    ask("stale"),
  ];
  expect([...townAttentionDesks(calls, asks, semantic.roster)].sort()).toEqual([
    "desk-ask",
    "desk-blocked",
    "desk-done",
    "desk-fresh",
    "desk-stale",
  ]);
  // A reviewed finish and a removed question release their desk; no status-based rediscovery.
  expect([...townAttentionDesks([], [], semantic.roster)]).toEqual([]);
  const reviewed = withTownFinished(
    office,
    new Set(),
    new Set(["reviewed", "done"]),
  );
  const remaining = townCalls(reviewed.roster, new Map(), [], (key) =>
    reviewed.roster.find(({ agent }) => agent.key === key),
  );
  expect([...townAttentionDesks(remaining, [], reviewed.roster)]).toEqual([
    "desk-blocked",
  ]);
  const mismatchedTerminal = ask("ask");
  mismatchedTerminal.actor.terminal_id = "replaced-terminal";
  expect([
    ...townAttentionDesks([], [mismatchedTerminal], semantic.roster),
  ]).toEqual([]);
});
