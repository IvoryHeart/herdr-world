import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentAddress } from "../../../shared/groups";
import { BoardStore } from "./board-store";
import { createWorldCli, type WorldCliResponse } from "./world-cli";
import { WorldLedger } from "./world-ledger";
import type { WorldSnapshotResult } from "./snapshot";

const directories: string[] = [];
afterEach(() =>
  directories
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true })),
);
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "group-cli-"));
  directories.push(directory);
  const board = new BoardStore(join(directory, "board.json"));
  const topology = {
    connections: [
      {
        connection_id: "connection-a",
        generation: 4,
        snapshot_generation: 4,
        state: "ready",
        stale: false,
        actionable: true,
        snapshot: {
          workspaces: [{ workspace_id: "room-1", label: "Workshop" }],
          tabs: [{ tab_id: "tab-1", workspace_id: "room-1", label: "Review" }],
          panes: ["one", "two"].map((name) => ({
            pane_id: `pane-${name}`,
            terminal_id: `terminal-${name}`,
            workspace_id: "room-1",
            tab_id: "tab-1",
            agent: "codex",
            agent_status: "working",
          })),
          agents: ["one", "two"].map((name) => ({
            pane_id: `pane-${name}`,
            terminal_id: `terminal-${name}`,
            agent: "codex",
            name,
          })),
        },
      },
    ],
  } as unknown as WorldSnapshotResult;
  const cli = createWorldCli({
    board,
    ledger: new WorldLedger(join(directory, "ledger.json"), { persist: false }),
    hosts: () => [],
    defaultConnectionId: () => "connection-a",
    snapshot: async () => topology,
    publishBoard: () => {},
    publishLedger: () => {},
  });
  const run = (command: string, params: Record<string, unknown> = {}) =>
    cli.handle({ command, params }, null);
  const created = async (name: string, kind = "pod") => {
    const reply = await run("group create", { name, kind });
    expect(reply.ok).toBe(true);
    return (reply as { result: { group: { id: string } } }).result.group.id;
  };
  return { board, run, created };
}
const result = (reply: WorldCliResponse) => {
  expect(reply.ok).toBe(true);
  return (reply as { result: unknown }).result;
};

test("World Groups CLI creates intent and projects Room/Desk separately", async () => {
  const { board, run, created } = setup();
  const id = await created("Chat");
  const rows = result(await run("group list")) as { kind: string }[];
  expect(rows.map((row) => row.kind)).toEqual(["pod", "room", "desk"]);
  expect(board.get().relations.groups).toHaveLength(1);
  expect(result(await run("group show", { group: id }))).toMatchObject({
    id,
    name: "Chat",
    owner: "world",
  });
});

test("an absent explicit address can join and every edit keeps actual caller attribution", async () => {
  const { board, run, created } = setup();
  const id = await created("Chat");
  result(
    await run("group add", {
      group: id,
      agent: agentAddress("connection-b", "away"),
      role: "reviewer",
    }),
  );
  const view = result(await run("group show", { group: id })) as {
    members: { resolution: string }[];
  };
  expect(view.members[0]?.resolution).toBe("away");
  expect(board.get().relations.group_changes?.at(-1)?.sender).toMatchObject({
    basis: "reported",
    label: "terminal with no pane",
    via: "cli",
  });
});

test("pooled role transfers require explicit confirmation and preserve reviewers", async () => {
  const { board, run, created } = setup();
  const first = await created("Chat");
  const second = await created("Platform");
  const agent = agentAddress("connection-a", "one");
  result(
    await run("group add", { group: first, agent, role: "builder,reviewer" }),
  );
  const before = board.get();
  expect(await run("group lead", { group: second, agent })).toMatchObject({
    ok: false,
    code: "refused",
  });
  expect(board.get()).toEqual(before);
  expect(
    await run("group lead", { group: second, agent, replace: true }),
  ).toMatchObject({ ok: false, code: "refused" });
  result(
    await run("group lead", {
      group: second,
      agent,
      replace: true,
      confirmed: true,
    }),
  );
  expect(
    board.get().relations.groups.find((group) => group.id === first)?.members[0]
      ?.roles,
  ).toEqual(["reviewer"]);
  expect(
    board.get().relations.groups.find((group) => group.id === second)
      ?.members[0]?.roles,
  ).toEqual(["lead"]);
});

test("reviewer replacement and ordered Now edits are atomic group operations", async () => {
  const { board, run, created } = setup();
  const id = await created("Chat");
  result(await run("group add", { group: id, agent: "one" }));
  result(await run("group reviewers", { group: id, agents: ["one", "two"] }));
  result(await run("group reviewers", { group: id, agents: ["two"] }));
  result(await run("group now", { group: id, items: ["Review", "Ship"] }));
  const group = board.get().relations.groups[0]!;
  expect(
    group.members.find(
      (member) => member.ref === agentAddress("connection-a", "one"),
    )?.roles,
  ).toEqual(["builder"]);
  expect(
    group.members.find(
      (member) => member.ref === agentAddress("connection-a", "two"),
    )?.roles,
  ).toEqual(["reviewer"]);
  expect(group.attrs?.queue).toEqual(["Review", "Ship"]);
});

test("projected groups cannot be created, deleted or assigned roles", async () => {
  const { board, run } = setup();
  for (const kind of ["room", "desk"]) {
    expect(await run("group create", { name: "Example", kind })).toMatchObject({
      ok: false,
      code: "refused",
    });
    for (const command of ["delete", "lead", "reviewers"]) {
      expect(
        await run(`group ${command}`, {
          group: kind === "room" ? "Workshop" : "Review",
          kind,
          agent: "one",
          agents: ["one"],
          confirmed: true,
        }),
      ).toMatchObject({ ok: false, code: "refused" });
    }
    expect(
      await run("group add", {
        group: kind === "room" ? "Workshop" : "Review",
        kind,
        agent: "one",
      }),
    ).toMatchObject({
      ok: false,
      code: "refused",
      error: expect.stringContaining("--herdr"),
    });
  }
  expect(board.get().relations.groups).toEqual([]);
});

test("deletion needs confirmation and retains its recent attribution", async () => {
  const { board, run, created } = setup();
  const id = await created("Chat");
  expect(await run("group delete", { group: id })).toMatchObject({
    ok: false,
    code: "refused",
  });
  result(await run("group delete", { group: id, confirmed: true }));
  expect(board.get().relations.groups).toEqual([]);
  expect(board.get().relations.group_changes?.at(-1)).toMatchObject({
    group_id: id,
    op: "group.delete",
  });
});

test("Team promotion keeps identity and requires an explicit full mapping", async () => {
  const { board, run, created } = setup();
  const id = await created("Pair", "team");
  result(await run("group add", { group: id, agent: "one" }));
  const before = board.get().relations.groups[0]!;
  expect(
    await run("group promote", { group: id, name: "Chat", mapping: [] }),
  ).toMatchObject({ ok: false, code: "refused" });
  result(
    await run("group promote", {
      group: id,
      name: "Chat",
      mapping: [
        {
          from: before.members[0]!.ref,
          to: agentAddress("connection-a", "one"),
          roles: ["lead"],
        },
      ],
    }),
  );
  expect(board.get().relations.groups[0]).toMatchObject({
    id,
    kind: "pod",
    name: "Chat",
    created_at: before.created_at,
  });
});
