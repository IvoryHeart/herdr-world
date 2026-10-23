import { expect, test } from "bun:test";
import { profileLinkFor } from "./profileLink";

const document = {
  profiles: [{ id: "p-builder", name: "Builder" }],
  assignments: [
    { connection_id: "local", terminal_id: "t1", profile_id: "p-builder" },
    { connection_id: "local", terminal_id: "t2", profile_id: "p-gone" },
  ],
} as unknown as Parameters<typeof profileLinkFor>[0];

test("the agent-settings link edits the profile an agent was launched from", () => {
  expect(profileLinkFor(document, "local", "t1")).toEqual({
    profileId: "p-builder",
    label: "Edit profile · Builder",
  });
  // Unassigned terminal, an assignment to a deleted profile, another host,
  // no terminal and no document all fall back to the editor.
  for (const [conn, term, doc] of [
    ["local", "t9", document],
    ["local", "t2", document],
    ["remote", "t1", document],
    ["local", undefined, document],
    ["local", "t1", null],
  ] as const)
    expect(profileLinkFor(doc, conn, term)).toEqual({ label: "Profiles…" });
});
