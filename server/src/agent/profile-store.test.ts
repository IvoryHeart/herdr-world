import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_ASSIGNMENTS, ProfileStore, profileWrite } from "./profile-store";

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

  test("chime settings are synced and keep the Town master's chime its own", () => {
    const path = fresh();
    const store = new ProfileStore(path);
    expect(store.get().chimes.timbres).toEqual({
      town_master: "bell",
      crew: "marimba",
    });
    store.saveChimes({
      timbres: { town_master: "glass", crew: "marimba" },
      motifs: { needs_you: true, for_you: true, finished: false },
    });
    expect(new ProfileStore(path).get().chimes).toMatchObject({
      timbres: { town_master: "glass" },
      motifs: { finished: false },
    });
    // Crew can't share it, and neither can a profile.
    expect(() =>
      store.saveChimes({ timbres: { town_master: "glass", crew: "glass" } }),
    ).toThrow(/Town master/);
    const builder = store.profile("builder")!;
    expect(() => store.save({ ...builder, chime: "glass" })).toThrow(
      /Town master's chime; Builder/,
    );
    store.save({ ...builder, chime: "kalimba" });
    expect(() =>
      store.saveChimes({
        timbres: { town_master: "kalimba", crew: "marimba" },
      }),
    ).toThrow(/Builder can't use it/);
  });

  test("one Town master, assigned by the owner and moved only on request", () => {
    const path = fresh();
    const store = new ProfileStore(path);
    expect(store.get().town_master).toBeNull();
    const first = { connection_id: "local", terminal_id: "term_1" };
    const second = { connection_id: "remote", terminal_id: "term_2" };
    store.setTownMaster(first);
    expect(() => store.setTownMaster(second)).toThrow(/another agent/);
    expect(store.get().town_master).toEqual(first);
    store.setTownMaster(second, { replace: true });
    expect(new ProfileStore(path).get().town_master).toEqual(second);
    store.setTownMaster(null);
    expect(store.get().town_master).toBeNull();
    expect(() => store.setTownMaster({ terminal_id: "x" })).toThrow(/terminal/);
  });

  test("a document from before chimes loads with the defaults", () => {
    const path = fresh();
    const store = new ProfileStore(path);
    // Strip the fields chimes added, as an older World wrote the file.
    const old: Record<string, unknown> = { ...store.get() };
    delete old.chimes;
    delete old.town_master;
    const profiles = store.get().profiles.map((profile) => {
      const plain: Record<string, unknown> = { ...profile };
      delete plain.chime;
      delete plain.town_master;
      return plain;
    });
    writeFileSync(path, JSON.stringify({ ...old, profiles }));
    const reopened = new ProfileStore(path).get();
    expect(reopened.chimes.timbres.town_master).toBe("bell");
    expect(reopened.town_master).toBeNull();
    expect(reopened.profiles.every((p) => p.chime === null)).toBe(true);
    expect(
      reopened.profiles.find((p) => p.id === "firstmate")?.town_master,
    ).toBe(false);
  });

  test("the profiles RPCs map to the store's writes; others don't", () => {
    const store = new ProfileStore(fresh());
    const terminal = { connection_id: "local", terminal_id: "term_a" };
    profileWrite("world.town_master.set")!(store, { terminal });
    expect(store.get().town_master).toEqual(terminal);
    expect(() =>
      profileWrite("world.town_master.set")!(store, {
        terminal: { ...terminal, terminal_id: "term_b" },
      }),
    ).toThrow("another agent is the Town master");
    profileWrite("world.profiles.delete")!(store, { id: "designer" });
    expect(store.profile("designer")).toBeUndefined();
    expect(profileWrite("world.profiles.list")).toBeNull();
    expect(profileWrite("toString")).toBeNull();
  });
});
