import { describe, expect, test } from "bun:test";
import {
  ChimeError,
  DEFAULT_CHIMES,
  chimePriority,
  chimeReason,
  motifFor,
  parseChimeSettings,
  shouldChime,
  timbreFor,
} from "./chimes";

const chime = (
  change: Partial<Parameters<typeof shouldChime>[0]> & {
    motif: Parameters<typeof shouldChime>[0]["motif"];
  },
) =>
  shouldChime({
    townMaster: false,
    settings: DEFAULT_CHIMES,
    seen: false,
    ...change,
  });

describe("Chimes", () => {
  test("one mapping from a change to its motif", () => {
    expect(motifFor("blocked")).toBe("needs_you");
    expect(motifFor("message")).toBe("for_you");
    expect(motifFor("completed")).toBe("finished");
  });

  test("the Town master sounds as itself; others use their profile, then the crew's", () => {
    const settings = DEFAULT_CHIMES;
    expect(
      timbreFor({ townMaster: true, profileChime: "glass" }, settings),
    ).toBe("bell");
    expect(
      timbreFor({ townMaster: false, profileChime: "glass" }, settings),
    ).toBe("glass");
    // A profile can't borrow the master's chime.
    expect(
      timbreFor({ townMaster: false, profileChime: "bell" }, settings),
    ).toBe("marimba");
    // An unattributed change is crew.
    expect(timbreFor(null, settings)).toBe("marimba");
  });

  test("interest, motif switches and what's on screen decide the sound", () => {
    expect(chime({ motif: "finished" })).toBe(true);
    expect(chime({ motif: "finished", seen: true })).toBe(false);
    expect(
      chime({
        motif: "finished",
        settings: {
          ...DEFAULT_CHIMES,
          motifs: { ...DEFAULT_CHIMES.motifs, finished: false },
        },
      }),
    ).toBe(false);
    expect(chime({ motif: "needs_you", interest: "muted" })).toBe(false);
    expect(
      chime({ motif: "finished", interest: "focused", anyFocused: true }),
    ).toBe(true);
    // While another agent is focused, a watched one stays quiet...
    expect(chime({ motif: "needs_you", anyFocused: true })).toBe(false);
    // ...except the Town master's needs-you, which breaks Focus.
    expect(
      chime({ motif: "needs_you", townMaster: true, anyFocused: true }),
    ).toBe(true);
    expect(
      chime({ motif: "for_you", townMaster: true, anyFocused: true }),
    ).toBe(false);
  });

  test("bursts rank the Town master first, then needs you, for you, finished", () => {
    const order = [
      chimePriority("needs_you", true),
      chimePriority("finished", true),
      chimePriority("needs_you", false),
      chimePriority("for_you", false),
      chimePriority("finished", false),
    ];
    expect([...order].sort((a, b) => b - a)).toEqual(order);
  });

  test("the reason line names the sender, or says it's unknown", () => {
    expect(
      chimeReason({ who: "reviewer-2", motif: "needs_you", detail: "asks" }),
    ).toBe("reviewer-2 · needs you: asks");
    expect(
      chimeReason({ who: null, motif: "for_you", detail: "Review ready" }),
    ).toBe("For you · sender unknown: Review ready");
    expect(chimeReason({ who: null, motif: "finished" })).toBe(
      "Finished · sender unknown",
    );
  });

  test("settings fall back to defaults and keep the master's chime its own", () => {
    expect(parseChimeSettings(undefined)).toEqual(DEFAULT_CHIMES);
    expect(
      parseChimeSettings({
        timbres: { town_master: "glass", crew: "nope" },
        motifs: { finished: false },
      }),
    ).toEqual({
      timbres: { town_master: "glass", crew: "marimba" },
      motifs: { needs_you: true, for_you: true, finished: false },
    });
    expect(() =>
      parseChimeSettings({ timbres: { town_master: "glass", crew: "glass" } }),
    ).toThrow(ChimeError);
  });
});
