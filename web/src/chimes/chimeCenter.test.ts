import { describe, expect, test } from "bun:test";
import { STARTER_PROFILES } from "../../../shared/agentProfile";
import {
  DEFAULT_CHIMES,
  type Motif,
  type Timbre,
} from "../../../shared/chimes";
import type { ProfilesDocument } from "../world/agentProfiles";
import {
  BURST_MS,
  type Change,
  createChimeCenter,
  setChimeInterestSource,
} from "./chimeCenter";

const document: ProfilesDocument = {
  version: 1,
  revision: 1,
  profiles: STARTER_PROFILES.map((profile) =>
    profile.id === "designer" ? { ...profile, chime: "glass" } : profile,
  ),
  assignments: [
    { connection_id: "local", terminal_id: "term_d", profile_id: "designer" },
    { connection_id: "local", terminal_id: "term_f", profile_id: "firstmate" },
  ],
  chimes: DEFAULT_CHIMES,
  town_master: { connection_id: "local", terminal_id: "term_f" },
};

function harness(options: { ready?: boolean; on?: boolean } = {}) {
  let clock = 1_000;
  const played: [Timbre, Motif][] = [];
  const timers: { at: number; run: () => void }[] = [];
  const { announce } = createChimeCenter({
    now: () => clock,
    document: () => document,
    device: () => ({ on: options.on ?? true, volume: 0.5 }),
    ready: () => options.ready ?? true,
    play: (timbre, motif) => {
      played.push([timbre, motif]);
      return true;
    },
    setTimer: (run, ms) => timers.push({ at: clock + ms, run }),
  });
  return {
    announce,
    played,
    advance(ms: number) {
      clock += ms;
      for (const timer of timers.splice(0))
        if (timer.at <= clock) timer.run();
        else timers.push(timer);
    },
  };
}
const change = (patch: Partial<Change>): Change => ({
  kind: "completed",
  connectionId: "local",
  terminalId: "term_x",
  agent: "claude",
  detail: null,
  ...patch,
});

describe("Chime center", () => {
  test("names the sender and plays its timbre", () => {
    const h = harness();
    expect(
      h.announce(change({ kind: "blocked", terminalId: "term_d" })),
    ).toEqual({
      message: "Designer · needs you",
      reasons: ["Designer · needs you"],
      chimed: true,
      silent: true,
    });
    expect(h.played).toEqual([["glass", "needs_you"]]);
  });

  test("a change without a pane is crew and says the sender is unknown", () => {
    const h = harness();
    const result = h.announce(
      change({
        kind: "message",
        terminalId: null,
        agent: null,
        detail: "Review ready",
      }),
    );
    expect(result.message).toBe("For you · sender unknown: Review ready");
    expect(h.played).toEqual([["marimba", "for_you"]]);
  });

  test("a burst plays one chime and escalates once at the window's end", () => {
    const h = harness();
    h.announce(change({ kind: "completed" }));
    h.advance(500);
    h.announce(
      change({ kind: "message", terminalId: null, agent: null, detail: "hi" }),
    );
    h.advance(500);
    // The Town master needing you outranks everything.
    const last = h.announce(change({ kind: "blocked", terminalId: "term_f" }));
    expect(last.message).toBe("3 changes");
    expect(last.reasons).toEqual([
      "claude · finished",
      "For you · sender unknown: hi",
      "FirstMate · needs you",
    ]);
    expect(h.played).toEqual([["marimba", "finished"]]);
    h.advance(BURST_MS);
    expect(h.played).toEqual([
      ["marimba", "finished"],
      ["bell", "needs_you"],
    ]);
    // A new window starts fresh.
    expect(h.announce(change({})).message).toBe("claude · finished");
    expect(h.played).toHaveLength(3);
  });

  test("a lower-priority change in a burst plays nothing more", () => {
    const h = harness();
    h.announce(change({ kind: "blocked" }));
    h.announce(change({ kind: "completed" }));
    h.advance(BURST_MS);
    expect(h.played).toEqual([["marimba", "needs_you"]]);
  });

  test("the OS stays quiet only when World plays the sound or the device is off", () => {
    expect(harness({ ready: false }).announce(change({}))).toMatchObject({
      chimed: false,
      silent: false,
    });
    const off = harness({ on: false });
    expect(off.announce(change({}))).toMatchObject({
      chimed: false,
      silent: true,
    });
    expect(off.played).toEqual([]);
  });

  test("a muted agent stays quiet, and focus quiets the others", () => {
    const h = harness();
    setChimeInterestSource({
      interestOf: (_, terminalId) =>
        terminalId === "term_d" ? "muted" : "watching",
      anyFocused: () => true,
    });
    try {
      h.announce(change({ kind: "blocked", terminalId: "term_d" }));
      h.advance(BURST_MS);
      h.announce(change({ kind: "blocked", terminalId: "term_x" }));
      h.advance(BURST_MS);
      expect(h.played).toEqual([]);
      // The Town master's needs-you breaks Focus.
      h.announce(change({ kind: "blocked", terminalId: "term_f" }));
      expect(h.played).toEqual([["bell", "needs_you"]]);
    } finally {
      setChimeInterestSource(null);
    }
  });
});
