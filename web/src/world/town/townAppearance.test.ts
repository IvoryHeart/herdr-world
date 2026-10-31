import { expect, test } from "bun:test";
import { createTownLookResolver } from "./townAppearance";
import { avatarLook } from "../../../../shared/appearance";
import { STARTER_PROFILES } from "../../../../shared/agentProfile";
import { townLookOf, type ProfilesDocument } from "../agentProfiles";
import type { OfficeAgent } from "../herdrOfficeProjection";
test("pane look is stable between frames and reset restores profile defaults", () => {
  const profile = structuredClone(STARTER_PROFILES[0]!);
  const document = {
    version: 1,
    revision: 1,
    profiles: [profile],
    assignments: [
      {
        connection_id: "alpha",
        terminal_id: "terminal-1",
        profile_id: profile.id,
      },
    ],
  } as ProfilesDocument;
  const agent = {
    currentTerminalRef: { connectionId: "alpha", nativeId: "terminal-1" },
    appearance: { avatar: "builder" },
  } as OfficeAgent;
  const resolve = createTownLookResolver(() => document),
    chosen = resolve(agent, "agent-1");
  expect(chosen).toEqual(townLookOf(avatarLook("builder")!));
  expect(resolve(agent, "agent-1")).toBe(chosen);
  agent.appearance = undefined;
  expect(resolve(agent, "agent-1")).toEqual(townLookOf(profile.look));
  const before = resolve(agent, "agent-1");
  profile.look.shirt = "#123456";
  document.revision += 1;
  expect(resolve(agent, "agent-1")).not.toBe(before);
  expect(resolve(agent, "agent-1").shirt).toBe("#123456");
});
