import { describe, expect, test } from "bun:test";
import { STARTER_PROFILES } from "../../../shared/agentProfile";
import {
  harnessLabel,
  profileLookFor,
  readinessNote,
  type ProfilesDocument,
} from "./agentProfiles";

const document: ProfilesDocument = {
  version: 1,
  revision: 3,
  profiles: STARTER_PROFILES,
  assignments: [
    { connection_id: "local", terminal_id: "term_1", profile_id: "designer" },
  ],
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
        { kind: "claude", installed: true, logged_in: false, can_log_in: true },
        { kind: "codex", installed: false, logged_in: null, can_log_in: false },
        { kind: "pi", installed: true, logged_in: null, can_log_in: false },
      ],
    };
    expect(readinessNote("claude", catalog)).toEqual({
      blocked: false,
      text: "Logged out",
      login: true,
    });
    expect(readinessNote("codex", catalog)?.blocked).toBe(true);
    expect(readinessNote("pi", catalog)).toBeNull();
    expect(readinessNote("muse", catalog)?.text).toMatch(/Not supported/);
    expect(readinessNote("claude", null)).toBeNull();
    expect(harnessLabel("claude")).toBe("Claude");
    expect(harnessLabel("opencode")).toBe("Opencode");
  });
});
