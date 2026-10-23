import { describe, expect, test } from "bun:test";
import { interestKey } from "../../../shared/interest";
import type { Pane } from "../types";
import type { WorldRuntimeConnection, WorldRuntimeState } from "./runtimeStore";
import {
  agentInterest,
  focusReachable,
  keepInterests,
  liveTerminalKeys,
} from "./useAgentInterest";

const pane = (terminal_id: string) => ({ terminal_id }) as Pane;
const connection = (
  connectionId: string,
  terminals: string[],
  ready = true,
): WorldRuntimeConnection =>
  ({
    connectionId,
    state: ready ? "ready" : "reconnecting",
    actionable: ready,
    stale: !ready,
    snapshot: { panes: terminals.map(pane) },
  }) as unknown as WorldRuntimeConnection;
const world = (...connections: WorldRuntimeConnection[]) =>
  ({ connections }) as WorldRuntimeState;

describe("agent interest for chimes", () => {
  test("an agent without a record is watching", () => {
    const some = agentInterest(
      { [interestKey("conn-a", "term_1")]: "muted" },
      false,
    );
    expect(some.interestOf("conn-a", "term_1")).toBe("muted");
    expect(some.interestOf("conn-a", "term_2")).toBe("watching");
  });

  test("a focus counts only while World can reach its terminal", () => {
    const focused = { [interestKey("conn-b", "term_1")]: "focused" as const };
    const online = liveTerminalKeys(world(connection("conn-b", ["term_1"])));
    expect(focusReachable(focused, online)).toBe(true);
    // Its host offline, removed, or the terminal gone: other agents chime.
    const offline = world(connection("conn-b", ["term_1"], false));
    expect(focusReachable(focused, liveTerminalKeys(offline))).toBe(false);
    expect(focusReachable(focused, liveTerminalKeys(world()))).toBe(false);
    const gone = world(connection("conn-b", ["term_2"]));
    expect(focusReachable(focused, liveTerminalKeys(gone))).toBe(false);
    // A mute never gates anyone.
    const muted = { [interestKey("conn-b", "term_1")]: "muted" as const };
    expect(focusReachable(muted, online)).toBe(false);
  });

  test("records keep their identity until one changes", () => {
    const last = { a: "muted" as const };
    expect(keepInterests(last, { a: "muted" })).toBe(last);
    const next = { a: "focused" as const };
    expect(keepInterests(last, next)).toBe(next);
  });
});
