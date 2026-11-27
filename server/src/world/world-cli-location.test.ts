import { afterEach, expect, test } from "bun:test";
import { coreCallerSource } from "../herdr-core/ask-caller";
import { moveCore } from "../herdr-core/town-move";
import { coreWorld } from "../herdr-core/testing/core-world";
import { BoardStore, emptyBoardDocument } from "./board-store";
import {
  createWorldCli,
  type CliHost,
  type WorldCliResponse,
} from "./world-cli";
import type { CoreCallerSource } from "./world-cli-actor";
import { paneActor } from "./world-cli-actor";
import type { WorldCliRequest } from "./world-cli-protocol";
import { WorldLedger, type CliActor } from "./world-ledger";

const worlds: Awaited<ReturnType<typeof coreWorld>>[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.dispose();
});

function fixture() {
  let pane = {
    pane_id: "w1:p1",
    tab_id: "w1:t1",
    workspace_id: "w1",
    terminal_id: "term_a",
    agent: "claude",
    agent_status: "idle",
  };
  let live = true;
  const aliases = new Set([pane.pane_id]);
  const host: CliHost = {
    connection_id: "tui",
    generation: 2,
    local: true,
    async call(method, params) {
      if (method === "pane.move") {
        pane = {
          ...pane,
          pane_id: "w2:p3",
          tab_id: "w2:t3",
          workspace_id: "w2",
        };
        aliases.add(pane.pane_id);
        return { pane };
      }
      if (method === "agent.get") return { agent: { name: "Builder" } };
      if (live && aliases.has(String(params.pane_id))) {
        if (method === "pane.process_info")
          return { process_info: { pane_id: pane.pane_id, shell_pid: 100 } };
        if (method === "pane.get") return { pane: { ...pane } };
      }
      throw new Error("pane_not_found");
    },
  };
  let core: CoreCallerSource | null = null;
  const board = new BoardStore({ read: emptyBoardDocument, commit() {} });
  const ledger = new WorldLedger("/synthetic/ledger.json", { persist: false });
  const cli = createWorldCli({
    board,
    ledger,
    hosts: () => [host],
    core: () => core,
    defaultConnectionId: () => "tui",
    snapshot: async () => ({
      revision: 1,
      observed_at: 1,
      connections: [
        {
          connection_id: "tui",
          label: "TUI",
          source: "test",
          is_default: true,
          state: "ready",
          generation: 2,
          snapshot_generation: 2,
          stale: false,
          actionable: true,
          snapshot: {
            workspaces: [{ workspace_id: pane.workspace_id }],
            tabs: [{ tab_id: pane.tab_id, workspace_id: pane.workspace_id }],
            panes: live ? [{ ...pane }] : [],
            agents: [],
            coverage: {} as never,
            watch_admission: {} as never,
          },
        },
      ],
    }),
    publishBoard() {},
    publishLedger() {},
  });
  const run = (
    command: string,
    params: Record<string, unknown> = {},
    caller: WorldCliRequest["caller"] = { pane_id: "w1:p1" },
    ancestors = [900, 100],
  ) =>
    cli.handle({ command, params, caller }, (roots) =>
      roots.some((pid) => ancestors.includes(pid))
        ? ancestors.map((pid, index) => ({
            pid,
            ppid: ancestors[index + 1] ?? 1,
            pgrp: pid,
          }))
        : null,
    );
  return {
    run,
    host,
    ledger,
    core(source: CoreCallerSource) {
      core = source;
    },
    live(value: boolean) {
      live = value;
    },
  };
}

function result(reply: WorldCliResponse) {
  expect(reply.ok).toBe(true);
  if (!reply.ok) throw new Error(JSON.stringify(reply));
  return reply.result;
}

test("a moved asker cannot answer questions from before or after its move", async () => {
  const w = fixture();
  const before = result(
    await w.run("ask", { question: "Continue before moving?" }),
  ) as { id: string };
  const saved = structuredClone(w.ledger.ask(before.id));
  await w.host.call("pane.move", { pane_id: "w1:p1", tab_id: "w2:t3" });
  const after = result(
    await w.run("ask", { question: "Continue after moving?" }),
  ) as { id: string };
  for (const { id } of [before, after]) {
    expect(await w.run("ask answer", { id, answer: "yes" })).toMatchObject({
      ok: false,
      code: "refused",
      error: "an agent cannot answer its own question",
      actor: { pane_id: "w2:p3", terminal_id: "term_a" },
    });
    expect(w.ledger.ask(id)?.answer).toBeUndefined();
  }
  expect(w.ledger.ask(before.id)).toEqual(saved);
});

async function record(
  run: (
    command: string,
    params?: Record<string, unknown>,
  ) => Promise<WorldCliResponse>,
  actor: Partial<CliActor>,
) {
  expect(result(await run("whoami"))).toMatchObject(actor);
  const ask = result(await run("ask", { question: "Continue?" }));
  const report = result(
    await run("result", { task: "TASK-1", summary: "Checked" }),
  );
  expect(
    result(await run("ask get", { id: (ask as { id: string }).id })),
  ).toMatchObject({ actor });
  expect(report).toMatchObject({ actor });
}

test("TUI launch aliases resolve to the current pane, tab and room for every new record", async () => {
  const w = fixture();
  const old = {
    verified: true,
    connection_id: "tui",
    pane_id: "w1:p1",
    tab_id: "w1:t1",
    workspace_id: "w1",
    terminal_id: "term_a",
    label: "claude in w1:p1",
  };
  await record(w.run, old);
  result(await w.run("board card pin", { target: "me", x: 10, y: 20 }));
  const before = structuredClone(w.ledger.get());
  await w.host.call("pane.move", { pane_id: "w1:p1", tab_id: "w2:t3" });
  const current = {
    ...old,
    pane_id: "w2:p3",
    tab_id: "w2:t3",
    workspace_id: "w2",
    label: "claude in w2:p3",
  };
  await record(w.run, current);
  const change = result(
    await w.run("board card pin", { target: "me", x: 30, y: 40 }),
  );
  expect(change).toMatchObject({ actor: current });
  const after = w.ledger.get();
  expect(after.asks[0]).toEqual(before.asks[0]);
  expect(after.results[0]).toEqual(before.results[0]);
  expect(after.changes[0]).toEqual(before.changes[0]);
  expect(
    (await w.run("whoami", {}, { pane_id: "w1:p1" }, [900, 200])).actor
      ?.verified,
  ).toBe(false);
  // Recipient checks never opt in to caller alias resolution. A moved pane
  // cannot silently become the target of an answer captured at its old ID.
  expect((await paneActor(w.host, "w1:p1")).state).toBe("unknown");
  const unverified = result(
    await w.run(
      "ask",
      { question: "Unverified?" },
      { pane_id: "w1:p1" },
      [900, 200],
    ),
  ) as { id: string };
  expect(w.ledger.ask(unverified.id)?.actor).toEqual({
    label: "unverified w1:p1",
    verified: false,
    pane_id: "w1:p1",
  });
});

test("core moves and resumed runtime claims record the current location without changing prior records", async () => {
  const core = await coreWorld();
  worlds.push(core);
  const address = core.fake.create({
    argv: ["claude"],
    pid: 200,
    foreground: { pid: 200, name: "claude", argv: ["claude"] },
    labels: {
      "herdr.space": "source",
      "herdr.tab": "one",
      where: "Source / One",
    },
  });
  core.fake.report(address, { state: "working", app: "claude" });
  core.fake.create({
    labels: {
      "herdr.space": "target",
      "herdr.tab": "two",
      where: "Target / Two",
    },
  });
  await core.connect();
  const source = coreCallerSource(() => ({
    manager: core.core.manager,
    host: () => ({}),
  }));
  const w = fixture();
  w.core(source);
  await record(w.run, { pane_id: "w1:p1", workspace_id: "w1" });
  const beforeTui = structuredClone(w.ledger.get());
  // A resumed agent inherits the destination's core ID. A stale outer TUI
  // claim is still possible; only the destination program is its ancestor.
  w.live(false);
  const runCore = (command: string, params = {}) =>
    w.run(
      command,
      params,
      { pane_id: "w1:p1", core_terminal: address },
      [900, 200],
    );
  const rows = await core.rows();
  const original = rows.panes.find((p) => p.pane_id === address)!;
  const target = rows.panes.find((p) => p.pane_id !== address)!;
  const actor = {
    verified: true,
    connection_id: "box",
    pane_id: address,
    terminal_id: address,
    tab_id: String(original.tab_id),
    workspace_id: String(original.workspace_id),
  };
  await record(runCore, actor);
  const beforeMove = structuredClone(w.ledger.get());
  expect(
    await moveCore(core.lease(), core.topology, {
      kind: "pane",
      pane_id: address,
      tab_id: String(target.tab_id),
    }),
  ).toMatchObject({ status: "moved" });
  await core.settle();
  await record(runCore, {
    ...actor,
    tab_id: String(target.tab_id),
    workspace_id: String(target.workspace_id),
  });
  // On a resume back to TUI, an inherited HC_TERMINAL_ID cannot override
  // the actual destination process ancestry.
  w.live(true);
  await w.host.call("pane.move", { pane_id: "w1:p1", tab_id: "w2:t3" });
  await record(
    (command, params) =>
      w.run(command, params, { pane_id: "w2:p3", core_terminal: address }),
    {
      verified: true,
      connection_id: "tui",
      pane_id: "w2:p3",
      tab_id: "w2:t3",
      workspace_id: "w2",
    },
  );
  expect(w.ledger.get().asks.slice(0, 2)).toEqual(beforeMove.asks);
  expect(w.ledger.get().results.slice(0, 2)).toEqual(beforeMove.results);
  expect(w.ledger.get().asks[0]).toEqual(beforeTui.asks[0]);
});
