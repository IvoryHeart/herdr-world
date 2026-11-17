import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "./board-store";
import type { CallerProcess } from "./caller-identity";
import { createWorldCli, dismissAsk, type CliHost } from "./world-cli";
import { WorldLedger, type LedgerStatus } from "./world-ledger";
import { STATUS_LIMITS } from "./world-cli-status";
import { openWorldLedger } from "../storage/world-storage";
import type { OutboxEffect } from "../storage/world-protocol";

/* Synthetic host "studio": agent pane w1:p1 (shell 100), w1:p2 (shell 200). */
const PANES = [
  {
    pane_id: "w1:p1",
    tab_id: "w1:t1",
    workspace_id: "w1",
    terminal_id: "term_a",
    agent: "claude",
    shell: 100,
  },
  {
    pane_id: "w1:p2",
    tab_id: "w1:t2",
    workspace_id: "w1",
    terminal_id: "term_b",
    agent: "codex",
    shell: 200,
  },
];
const host: CliHost = {
  connection_id: "studio",
  generation: 2,
  local: true,
  async call(method, params) {
    const pane = PANES.find((entry) => entry.pane_id === params.pane_id);
    if (method === "pane.process_info")
      return pane
        ? { process_info: { pane_id: pane.pane_id, shell_pid: pane.shell } }
        : Promise.reject(new Error("pane not found"));
    if (method === "pane.get")
      return pane ? { pane } : Promise.reject(new Error("pane not found"));
    if (method === "agent.get") return { agent: { name: "builder" } };
    throw new Error(`unexpected ${method}`);
  },
};
const inPane = (shell: number): CallerProcess[] => [
  { pid: 900, ppid: 800, pgrp: 800 },
  { pid: 800, ppid: shell, pgrp: 800 },
  { pid: shell, ppid: 1, pgrp: shell },
];

let root: string;
let clock: number;
beforeEach(() => {
  root = join(tmpdir(), `world-status-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  clock = 1_000;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function setup() {
  const ledger = new WorldLedger(join(root, "ledger.json"), {
    persist: false,
    now: () => clock,
  });
  // The JSON ledger ignores declared effects; record them as storage would.
  const effects: OutboxEffect[] = [];
  const update = ledger.update.bind(ledger);
  (ledger as unknown as { update: unknown }).update = (
    change: Parameters<typeof update>[0],
    declared?: readonly OutboxEffect[] | (() => readonly OutboxEffect[]),
  ) => {
    const revision = update(change);
    effects.push(
      ...(typeof declared === "function" ? declared() : (declared ?? [])),
    );
    return revision;
  };
  const published: { asks: boolean; statuses: boolean }[] = [];
  const cli = createWorldCli({
    board: new BoardStore(join(root, "board.json")),
    ledger,
    hosts: () => [host],
    defaultConnectionId: () => "studio",
    snapshot: async () => {
      throw new Error("not used");
    },
    publishBoard: () => {},
    publishLedger: (_revision, asks, statuses) =>
      published.push({ asks: asks === true, statuses: statuses === true }),
    now: () => clock,
  });
  /** As an agent in pane w1:p1 (or w1:p2), or, with `pane` null, a program outside Herdr. */
  const run = (
    command: string,
    params: Record<string, unknown> = {},
    pane: "w1:p1" | "w1:p2" | null = "w1:p1",
  ) =>
    cli.handle(
      { command, params, caller: pane ? { pane_id: pane } : {} },
      pane
        ? (roots) => {
            const chain = inPane(pane === "w1:p1" ? 100 : 200);
            return chain.some((entry) => roots.includes(entry.pid))
              ? chain
              : null;
          }
        : null,
    );
  const rows = () => ledger.get().statuses;
  const asks = () => ledger.get().asks;
  return { ledger, run, rows, asks, effects, published };
}

const base = { key: "crew-42", line: "Building the login fix" };

describe("status rows", () => {
  test("upserts one row per caller and key, changed in place, and interrupts nobody", async () => {
    const { run, rows, asks, effects, published } = setup();
    const first = await run("status", {
      ...base,
      state: "working",
      phase: "build",
      group: "Crew",
      url: "https://example.invalid/42",
    });
    expect(first).toMatchObject({ ok: true, actor: { verified: true } });
    clock = 61_000;
    await run("status", {
      ...base,
      state: "working",
      phase: "review",
      group: "Crew",
      progress: 40,
    });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      at: 1_000,
      updated_at: 61_000,
      key: "crew-42",
      phase: "review",
      progress: 40,
      group: "Crew",
      state: "working",
      ttl_ms: STATUS_LIMITS.ttlDefaultMs,
    });
    // Each call states the whole row: the URL left out is gone.
    expect(rows()[0]!.url).toBeUndefined();
    expect(asks()).toEqual([]);
    expect(effects).toEqual([]);
    expect(published).toEqual([
      { asks: false, statuses: true },
      { asks: false, statuses: true },
    ]);
  });

  test("a program outside Herdr may report; unverified callers share one key space apart from agents'", async () => {
    const { run, rows } = setup();
    const program = await run(
      "status",
      { ...base, line: "CI running", state: "working" },
      null,
    );
    expect(program).toMatchObject({ ok: true, actor: { verified: false } });
    await run("status", base, "w1:p1");
    await run("status", base, "w1:p2");
    await run("status", { ...base, line: "CI passed", state: "done" }, null);
    expect(
      rows().map((row) => [row.actor.verified, row.line, row.state]),
    ).toEqual([
      [false, "CI passed", "done"],
      [true, "Building the login fix", "working"],
      [true, "Building the login fix", "working"],
    ]);
    // The default group is Herdr's name for the agent; a program has none.
    expect(rows().map((row) => row.group)).toEqual([
      "Other",
      "builder",
      "builder",
    ]);
    // Another caller cannot clear an agent's row.
    expect(await run("status clear", { key: base.key }, "w1:p2")).toMatchObject(
      { ok: true },
    );
    expect(await run("status clear", { key: base.key }, "w1:p2")).toMatchObject(
      {
        ok: false,
        code: "not_found",
      },
    );
    expect(rows()).toHaveLength(2);
  });

  test("refuses bad states, progress, links and lifetimes", async () => {
    const { run, rows } = setup();
    for (const params of [
      { state: "busy" },
      { progress: 101 },
      { progress: 2.5 },
      { url: "javascript:alert(1)" },
      { url: "not a url" },
      { ttl_s: 24 * 3600 + 1 },
      { ttl_s: 0 },
      { line: "x".repeat(STATUS_LIMITS.line + 1) },
    ])
      expect(await run("status", { ...base, ...params })).toMatchObject({
        ok: false,
        code: "usage",
      });
    expect(rows()).toEqual([]);
  });

  test("--needs-you raises exactly one owner-only question per cause, withdrawn with the flag or the row", async () => {
    const { run, rows, asks, effects, published, ledger } = setup();
    await run("status", { ...base, state: "blocked", needs_you: true });
    await run("status", { ...base, state: "blocked", needs_you: true });
    expect(asks()).toHaveLength(1);
    const first = asks()[0]!;
    expect(first).toMatchObject({
      owner_only: true,
      question: base.line,
      options: [],
    });
    expect(rows()[0]!.ask_id).toBe(first.id);
    expect(effects.map((effect) => [effect.kind, effect.record_id])).toEqual([
      ["ask.created", first.id],
    ]);
    expect(published.map((entry) => entry.asks)).toEqual([true, false]);

    // Dropping the flag withdraws it; raising it again is a new cause.
    await run("status", { ...base, state: "working" });
    expect(ledger.ask(first.id)?.withdrawn).toBeDefined();
    expect(rows()[0]!.ask_id).toBeUndefined();
    await run("status", {
      ...base,
      state: "blocked",
      needs_you: true,
      phase: "waiting for you",
    });
    const second = asks()[1]!;
    expect(second.question).toBe(`${base.line} (waiting for you)`);
    expect(effects).toHaveLength(2);

    // The owner's dismissal closes it; the same report does not raise it again.
    await dismissAsk(ledger, second.id, "owner", clock);
    await run("status", { ...base, state: "blocked", needs_you: true });
    expect(asks()).toHaveLength(2);
    expect(effects).toHaveLength(2);

    // Clearing the row withdraws an open question.
    await run("status", { ...base, key: "other", needs_you: true });
    const third = asks()[2]!;
    expect(await run("status clear", { key: "other" })).toMatchObject({
      ok: true,
      result: { cleared: true, withdrew: true },
    });
    expect(ledger.ask(third.id)?.withdrawn).toBeDefined();
    expect(ledger.ask(second.id)?.withdrawn).toBeUndefined();
  });

  test("a row turns stale after its ttl and drops off a day later, withdrawing its question", async () => {
    const { run, ledger } = setup();
    await run("status", { ...base, ttl_s: 120, needs_you: true });
    const askId = ledger.get().statuses[0]!.ask_id!;
    const list = async () =>
      (await run("status ls")) as {
        ok: true;
        result: (LedgerStatus & { stale: boolean })[];
      };
    expect((await list()).result.map((row) => row.stale)).toEqual([false]);
    clock += 120_000;
    expect((await list()).result).toMatchObject([
      { stale: true, stale_at: 121_000 },
    ]);
    clock += STATUS_LIMITS.dropAfterStaleMs - 1;
    expect((await list()).result).toHaveLength(1);
    clock += 1;
    expect((await list()).result).toEqual([]);
    // The next write prunes it and withdraws its open question.
    await run("status", { ...base, key: "fresh" });
    expect(ledger.get().statuses.map((row) => row.key)).toEqual(["fresh"]);
    expect(ledger.ask(askId)?.withdrawn).toBeDefined();
  });
});

test("status rows survive a SQLite reopen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "world-status-sqlite-"));
  const target = {
    database: join(dir, "world.sqlite"),
    ledger: join(dir, "ledger.json"),
  };
  const ports = {
    clock: { now: () => 1000, monotonic: () => performance.now() },
    scheduler: {
      schedule(callback: () => void, delayMs: number) {
        const timer = setTimeout(callback, delayMs);
        return { cancel: () => clearTimeout(timer) };
      },
    },
  };
  const row: LedgerStatus = {
    id: "s-test",
    at: 1000,
    updated_at: 1000,
    actor: { label: "Synthetic program", verified: false },
    owner: "unverified",
    key: "deploy",
    line: "Deploying",
    state: "working",
    group: "Deploys",
    ttl_ms: 60_000,
  };
  try {
    const first = await openWorldLedger(target, ports);
    await first.ledger.update((doc) => doc.statuses.push(row));
    await first.ledger.update((doc) => {
      doc.statuses[0]!.line = "Deployed";
    });
    await first.close();
    const second = await openWorldLedger(target, ports);
    expect(second.ledger.get().statuses).toEqual([
      { ...row, line: "Deployed" },
    ]);
    await second.ledger.update((doc) => {
      doc.statuses = [];
    });
    await second.close();
    const third = await openWorldLedger(target, ports);
    expect(third.ledger.get().statuses).toEqual([]);
    await third.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
