import { describe, expect, test } from "bun:test";
import { STARTER_PROFILES } from "../../../shared/agentProfile";
import { unknownHarnessReadiness } from "../../../shared/harnessReadiness";
import { DEFAULT_CHIMES } from "../../../shared/chimes";
import {
  harnessLabel,
  profileLookFor,
  readinessNote,
  parseLauncherCatalog,
  retainedOutcome,
  type LaunchTarget,
  type ProfilesDocument,
} from "./agentProfiles";

const document: ProfilesDocument = {
  version: 1,
  revision: 3,
  profiles: STARTER_PROFILES,
  assignments: [
    { connection_id: "local", terminal_id: "term_1", profile_id: "designer" },
  ],
  chimes: DEFAULT_CHIMES,
  town_master: null,
};

describe("Agent profiles in the browser", () => {
  test("an agent launched from a profile wears its look; others keep theirs", () => {
    expect(profileLookFor(document, "local", "term_1")).toMatchObject({
      outfit: "dress",
      accessory: "pencil",
      style: 3,
    });
    expect(profileLookFor(document, "other", "term_1")).toBeNull();
    expect(profileLookFor(null, "local", "term_1")).toBeNull();
  });

  test("readiness says what blocks a harness and when to log in", () => {
    const catalog = {
      kinds: ["claude", "codex", "pi"],
      skills: [],
      readiness: [
        {
          kind: "claude",
          installed: true,
          logged_in: false,
          can_log_in: true,
          probe: {
            source: "world-harness-probe" as const,
            state: "ok" as const,
            reason: "complete" as const,
            observed_at: 123,
          },
        },
        {
          kind: "codex",
          installed: false,
          logged_in: null,
          can_log_in: false,
          probe: {
            source: "world-harness-probe" as const,
            state: "ok" as const,
            reason: "complete" as const,
            observed_at: 123,
          },
        },
        {
          ...unknownHarnessReadiness("pi", "auth-unsupported", 123),
          installed: true,
        },
      ],
    };
    expect(readinessNote("claude", catalog)).toEqual({
      blocked: false,
      text: "Logged out",
      login: true,
    });
    expect(readinessNote("codex", catalog)?.blocked).toBe(true);
    expect(readinessNote("pi", catalog)).toMatchObject({
      blocked: false,
      login: false,
      text: "Installed; login check not supported",
    });
    expect(readinessNote("muse", catalog)?.text).toMatch(/Not supported/);
    expect(readinessNote("claude", null)).toBeNull();
    expect(harnessLabel("claude")).toBe("Claude");
    expect(harnessLabel("opencode")).toBe("Opencode");
  });

  test("a retained outcome keeps the host its launch ran on", () => {
    const hostA: LaunchTarget = {
      connectionId: "host-a",
      generation: 2,
      workspaceId: "w1",
      workspaceLabel: "api",
    };
    const outcome = retainedOutcome(hostA, {
      status: "uncertain",
      message: "It may still be starting.",
      terminal_id: "term_7",
    });
    // The room then changes to host B; the outcome still opens A's terminal.
    expect(outcome).toEqual({
      message: "It may still be starting.",
      failed: false,
      terminal: { connectionId: "host-a", terminalId: "term_7" },
    });
    expect(retainedOutcome(hostA, { status: "failed" })).toEqual({
      message: "",
      failed: true,
      terminal: null,
    });
  });
});

test("unknown and older readiness cannot block a supported kind or offer login", () => {
  for (const readiness of [
    undefined,
    [{ kind: "codex", installed: false }],
    [{ kind: "codex", installed: "no" }],
  ]) {
    const catalog = parseLauncherCatalog({
      kinds: ["codex"],
      skills: [],
      readiness,
    });
    expect(catalog.readiness[0]?.installed).toBeNull();
    expect(readinessNote("codex", catalog)).toEqual({
      blocked: false,
      login: false,
      text: "Readiness unknown — Check again",
    });
  }
  const windows = {
    kinds: ["codex"],
    skills: [],
    readiness: [unknownHarnessReadiness("codex", "windows-unsupported", 123)],
  };
  expect(readinessNote("codex", windows)).toMatchObject({
    blocked: false,
    login: false,
    text: "Readiness is not checked on Windows",
  });
});

test("duplicate readiness and unknown auth remain distinct from sign-out", () => {
  const ready = {
    ...unknownHarnessReadiness("codex", "unreadable-status", 123),
    installed: true,
    can_log_in: true,
  };
  const catalog = parseLauncherCatalog({
    kinds: ["codex"],
    readiness: [ready],
  });
  expect(readinessNote("codex", catalog)).toEqual({
    blocked: false,
    login: false,
    text: "Login status unknown — Check again",
  });
  expect(
    parseLauncherCatalog({ kinds: ["codex"], readiness: [ready, ready] })
      .readiness[0]?.installed,
  ).toBeNull();
});
