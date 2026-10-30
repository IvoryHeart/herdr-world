import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProfileStore } from "./profile-store";
import { TerminalSettings } from "./terminal-settings";
import {
  profileTokens,
  readTerminalSettings,
  type PaneRow,
} from "./terminal-tokens";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "terminal-settings-"));
  roots.push(root);
  const hosts = new Map(
    ["alpha", "beta"].map((id, index) => [
      id,
      {
        online: true,
        generation: 1,
        refuse: false,
        panes: [
          { pane_id: "w1:p1", terminal_id: `term_${index}`, tokens: {} },
        ] as PaneRow[],
      },
    ]),
  );
  const writes: unknown[] = [];
  const lease = (id: string) => {
    const host = hosts.get(id)!;
    if (!host.online) return null;
    const generation = host.generation;
    return {
      generation,
      isCurrent: () => host.online && host.generation === generation,
      runtime: {
        herdr: {
          call: async (method: string, params: Record<string, unknown>) => {
            const pane = host.panes.find((p) => p.pane_id === params.pane_id);
            if (method === "pane.list")
              return { panes: structuredClone(host.panes) };
            if (method === "pane.get")
              return { pane: pane && structuredClone(pane) };
            if (method === "pane.report_metadata") {
              if (host.refuse) throw new Error("metadata_token_limit");
              writes.push(params);
              pane!.tokens = {
                ...(pane!.tokens as object),
                ...(params.tokens as object),
              };
              return {};
            }
            throw new Error(`unexpected ${method}`);
          },
        },
      },
    };
  };
  const world = (name: string, now = 10) => {
    const path = join(root, `${name}.json`),
      store = new ProfileStore(path);
    return {
      store,
      path,
      settings: new TerminalSettings(
        store,
        lease,
        () => {},
        () => now,
      ),
    };
  };
  const observe = async (settings: TerminalSettings, id: string) => {
    const host = hosts.get(id)!;
    await settings.observe(id, host.generation, host.panes);
  };
  const target = (id: string) => ({
    connection_id: id,
    connection_generation: hosts.get(id)!.generation,
    pane_id: "w1:p1",
    terminal_id: String(hosts.get(id)!.panes[0]!.terminal_id),
  });
  return { root, hosts, writes, world, observe, target };
}

test("two Worlds read one shared assignment; missing local profiles keep the recorded name", async () => {
  const f = fixture(),
    a = f.world("a"),
    b = f.world("b");
  b.store.delete("builder");
  await f.observe(a.settings, "alpha");
  await a.settings.assign(f.target("alpha"), a.store.profile("builder")!);
  await f.observe(b.settings, "alpha");
  expect(b.settings.get().assignments).toEqual([
    {
      connection_id: "alpha",
      terminal_id: "term_0",
      profile_id: "builder",
      profile_name: "Builder",
    },
  ]);
  expect(b.settings.get().profiles.some((p) => p.id === "builder")).toBe(false);
  expect(a.store.get().assignments).toEqual([]);
  expect(f.writes[0]).toMatchObject({
    source: "herdr-world:terminal-settings",
  });
  expect(f.writes[0]).not.toHaveProperty("ttl_ms");
  expect(f.writes[0]).not.toHaveProperty("seq");
});

test("imports once per connection, keeps a backup and legacy rollback fields, and waits for offline hosts", async () => {
  const f = fixture(),
    a = f.world("a");
  for (const id of ["alpha", "beta"])
    a.store.assign({ ...f.target(id), profile_id: "builder" });
  a.store.assign({
    connection_id: "alpha",
    terminal_id: "ended",
    profile_id: "builder",
  });
  a.store.setTownMaster(f.target("alpha"));
  f.hosts.get("beta")!.online = false;
  await f.observe(a.settings, "alpha");
  expect(a.store.settingsState().imported_connections).toEqual(["alpha"]);
  expect(a.settings.get().assignments).toHaveLength(1);
  const backup = JSON.parse(
    readFileSync(`${a.path}.before-terminal-settings`, "utf8"),
  );
  expect(backup.assignments).toHaveLength(3);
  expect(backup.town_master.terminal_id).toBe("term_0");
  await a.settings.assign(f.target("alpha"), a.store.profile("reviewer")!);
  const reopened = f.world("a");
  await f.observe(reopened.settings, "alpha");
  expect(reopened.settings.get().assignments[0]!.profile_id).toBe("reviewer");
  f.hosts.get("beta")!.online = true;
  await f.observe(reopened.settings, "beta");
  expect(reopened.settings.get().assignments).toHaveLength(2);
  expect(reopened.store.get().assignments).toHaveLength(3);
  // Restored panes get a new terminal and no tokens, never a re-import.
  f.hosts.get("alpha")!.generation++;
  f.hosts.get("alpha")!.panes = [
    { pane_id: "w1:p1", terminal_id: "term_new", tokens: {} },
  ];
  await f.observe(reopened.settings, "alpha");
  expect(reopened.settings.get().assignments).toHaveLength(1);
  expect(reopened.settings.get().town_master).toBeNull();
});

test("a refused write preserves the previous settings and rejects the caller", async () => {
  const f = fixture(),
    a = f.world("a");
  await f.observe(a.settings, "alpha");
  await a.settings.assign(f.target("alpha"), a.store.profile("builder")!);
  f.hosts.get("alpha")!.refuse = true;
  await expect(
    a.settings.assign(f.target("alpha"), a.store.profile("reviewer")!),
  ).rejects.toThrow("metadata_token_limit");
  expect(a.settings.get().assignments[0]!.profile_id).toBe("builder");
  await expect(
    a.settings.setMaster({
      terminal: { ...f.target("alpha"), connection_generation: 0 },
    }),
  ).rejects.toThrow(/runtime/);
});

test("an interrupted import retries without replacing settings another World has written", async () => {
  const f = fixture(),
    a = f.world("a");
  a.store.assign({ ...f.target("alpha"), profile_id: "builder" });
  f.hosts.get("alpha")!.refuse = true;
  await expect(f.observe(a.settings, "alpha")).rejects.toThrow(
    "metadata_token_limit",
  );
  expect(a.store.settingsState().imported_connections).toEqual([]);
  f.hosts.get("alpha")!.refuse = false;
  f.hosts.get("alpha")!.panes[0]!.tokens = profileTokens(
    "term_0",
    "reviewer",
    "Reviewer",
  );
  await f.observe(a.settings, "alpha");
  expect(a.settings.get().assignments[0]!.profile_id).toBe("reviewer");
  expect(a.store.settingsState().imported_connections).toEqual(["alpha"]);
});

test("a returning offline holder loses to the newer assignment even across a World restart and a backwards clock", async () => {
  const f = fixture(),
    a = f.world("a", 100);
  await f.observe(a.settings, "alpha");
  await f.observe(a.settings, "beta");
  await a.settings.setMaster({ terminal: f.target("alpha") });
  f.hosts.get("alpha")!.online = false;
  const restarted = f.world("a", 1);
  await f.observe(restarted.settings, "beta");
  await restarted.settings.setMaster({
    terminal: f.target("beta"),
    replace: true,
  });
  expect(restarted.store.settingsState().highest_master_revision).toBe(101);
  f.hosts.get("alpha")!.online = true;
  await f.observe(restarted.settings, "alpha");
  expect(restarted.settings.get().town_master?.connection_id).toBe("beta");
  expect(
    readTerminalSettings(f.hosts.get("alpha")!.panes[0]!).master,
  ).toBeUndefined();
});

test("moving the role requires confirmation; offline state is retained unresolved", async () => {
  const f = fixture(),
    a = f.world("a");
  await f.observe(a.settings, "alpha");
  await f.observe(a.settings, "beta");
  await a.settings.setMaster({ terminal: f.target("alpha") });
  await expect(
    a.settings.setMaster({ terminal: f.target("beta") }),
  ).rejects.toThrow(/another agent/);
  f.hosts.get("alpha")!.online = false;
  expect(a.settings.get().town_master?.connection_id).toBe("alpha");
  await a.settings.setMaster({ terminal: f.target("beta"), replace: true });
  expect(readTerminalSettings(f.hosts.get("alpha")!.panes[0]!).master).toBe(10);
  await expect(a.settings.setMaster({ terminal: null })).rejects.toThrow(
    /unavailable/,
  );
  expect(a.settings.get().town_master?.connection_id).toBe("beta");
  f.hosts.get("alpha")!.online = true;
  await f.observe(a.settings, "alpha");
  await a.settings.setMaster({ terminal: null });
  expect(a.settings.get().town_master).toBeNull();
});

test("exhaustive P7: two Worlds × two hosts, ties, both observation orders, offline returns and restarts converge", async () => {
  let cases = 0;
  for (const offline of [null, "alpha", "beta"])
    for (const restart of [0, 1, 2, 3])
      for (const bClock of [9, 10, 11])
        for (const reverseAssignments of [false, true])
          for (const reverseA of [false, true])
            for (const reverseB of [false, true]) {
              const f = fixture();
              let a = f.world("a", 10),
                b = f.world("b", bClock);
              // Concurrent assignments: neither World has yet observed the other's claim.
              await f.observe(a.settings, "alpha");
              await f.observe(b.settings, "beta");
              const assignments = [
                () => a.settings.setMaster({ terminal: f.target("alpha") }),
                () => b.settings.setMaster({ terminal: f.target("beta") }),
              ];
              for (const assign of reverseAssignments
                ? assignments.reverse()
                : assignments)
                await assign();
              if (offline) f.hosts.get(offline)!.online = false;
              if (restart & 1) a = f.world("a", 1);
              if (restart & 2) b = f.world("b", 1);
              if (offline) {
                const reachable = offline === "alpha" ? "beta" : "alpha";
                await f.observe(a.settings, reachable);
                await f.observe(b.settings, reachable);
                f.hosts.get(offline)!.online = true;
              }
              for (const id of reverseA ? ["beta", "alpha"] : ["alpha", "beta"])
                await f.observe(a.settings, id);
              for (const id of reverseB ? ["beta", "alpha"] : ["alpha", "beta"])
                await f.observe(b.settings, id);
              for (const id of ["alpha", "beta"])
                await f.observe(a.settings, id);
              const winner = bClock >= 10 ? "beta" : "alpha";
              expect(a.settings.get().town_master).toEqual({
                connection_id: winner,
                terminal_id: winner === "beta" ? "term_1" : "term_0",
              });
              expect(b.settings.get().town_master).toEqual(
                a.settings.get().town_master,
              );
              expect(
                readTerminalSettings(
                  f.hosts.get(winner === "beta" ? "alpha" : "beta")!.panes[0]!,
                ).master,
              ).toBeUndefined();
              cases++;
            }
  expect(cases).toBe(288);
}, 60_000);
