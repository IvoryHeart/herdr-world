import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_ASSIGNMENTS, ProfileStore } from "./profile-store";

const fresh = () =>
  join(mkdtempSync(join(tmpdir(), "world-profiles-")), "agent-profiles.json");

describe("Profile store", () => {
  test("seeds the starters, which the owner can edit and delete", () => {
    const path = fresh();
    const store = new ProfileStore(path);
    expect(store.get().profiles.map((p) => p.id)).toEqual([
      "reviewer",
      "builder",
      "designer",
      "firstmate",
    ]);
    const builder = store.profile("builder")!;
    store.save({ ...builder, model: "opus" });
    expect(store.profile("builder")).toMatchObject({
      model: "opus",
      starter: true,
    });
    store.delete("designer");
    const reopened = new ProfileStore(path);
    expect(reopened.get().profiles.map((p) => p.id)).not.toContain("designer");
    expect(reopened.get().revision).toBe(2);
  });

  test("a new profile cannot claim to be a starter", () => {
    const store = new ProfileStore(fresh());
    store.save({ ...store.profile("builder")!, id: "otter", name: "otter" });
    expect(store.profile("otter")?.starter).toBeUndefined();
  });

  test("assignments are bounded and one per terminal", () => {
    const store = new ProfileStore(fresh());
    for (let i = 0; i < MAX_ASSIGNMENTS + 5; i += 1)
      store.assign({
        connection_id: "local",
        terminal_id: `term_${i}`,
        profile_id: "builder",
      });
    store.assign({
      connection_id: "local",
      terminal_id: `term_${MAX_ASSIGNMENTS}`,
      profile_id: "reviewer",
    });
    const { assignments } = store.get();
    expect(assignments).toHaveLength(MAX_ASSIGNMENTS);
    expect(assignments.at(-1)).toMatchObject({ profile_id: "reviewer" });
    expect(
      assignments.filter((a) => a.terminal_id === `term_${MAX_ASSIGNMENTS}`),
    ).toHaveLength(1);
  });

  test("an unreadable file is kept aside and the starters return", () => {
    const path = fresh();
    writeFileSync(path, "{not json");
    const store = new ProfileStore(path, { now: () => 7 });
    expect(store.get().profiles).toHaveLength(4);
    expect(existsSync(`${path}.unreadable-7`)).toBe(true);
  });

  test("nothing secret reaches the file", () => {
    const path = fresh();
    const store = new ProfileStore(path);
    expect(() =>
      store.save({
        ...store.profile("builder")!,
        brief: "token ghp_abcdefghijklmnopqrstuvwxyz0123",
      }),
    ).toThrow(/credential/);
    expect(existsSync(path) && readFileSync(path, "utf8")).toBeFalsy();
  });
});
