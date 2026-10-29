import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "./board-store";
import type { CallerProcess } from "./caller-identity";
import type { WorldSnapshotResult } from "./snapshot";
import {
  createWorldCli,
  NO_PANE,
  type CliHost,
  type WorldCliResponse,
} from "./world-cli";
import { WorldLedger } from "./world-ledger";

const resultOf = (reply: WorldCliResponse) =>
  (reply as { result?: unknown }).result;

/*
 * Synthetic host "studio": workspace w1 with tabs w1:t1 (agent pane w1:p1,
 * whose shell is pid 100) and w1:t2 (agent pane w1:p2, shell pid 200).
 */
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
const TABS = [
  { tab_id: "w1:t1", workspace_id: "w1", label: "one" },
  { tab_id: "w1:t2", workspace_id: "w1", label: "two" },
];

let root: string;
let calls: { method: string; params: Record<string, unknown> }[];
let tabOrder: string[];

function host(overrides: Partial<CliHost> = {}): CliHost {
  return {
    connection_id: "studio",
    generation: 2,
    local: true,
    async call(method, params) {
      calls.push({ method, params });
      const pane = PANES.find((entry) => entry.pane_id === params.pane_id);
      if (method === "pane.process_info")
        return pane
          ? { process_info: { pane_id: pane.pane_id, shell_pid: pane.shell } }
          : Promise.reject(new Error("pane not found"));
      if (method === "pane.get")
        return pane ? { pane } : Promise.reject(new Error("pane not found"));
      if (method === "tab.list")
        return {
          tabs: tabOrder.map((tab_id) => ({ tab_id, workspace_id: "w1" })),
        };
      if (method === "tab.move" || method === "pane.report_metadata")
        return { type: "ok" };
      throw new Error(`unexpected ${method}`);
    },
    ...overrides,
  };
}

const snapshot = (stale = false, ids = ["studio"]): WorldSnapshotResult => ({
  revision: 1,
  observed_at: 1,
  connections: ids.map((connection_id) => ({
    connection_id,
    label: "Studio",
    source: "test",
    is_default: true,
    state: "ready" as never,
    generation: 2,
    snapshot_generation: 2,
    stale,
    actionable: !stale,
    snapshot: {
      workspaces: [{ workspace_id: "w1", label: "room" }],
      tabs: TABS,
      panes: PANES,
      agents: [],
      coverage: {} as never,
      watch_admission: {} as never,
    },
  })),
});

/** A CLI process whose ancestor is the shell of `pid`'s pane. */
const inPane = (shell: number): CallerProcess[] => [
  { pid: 900, ppid: 800, pgrp: 800 },
  { pid: 800, ppid: shell, pgrp: 800 },
  { pid: shell, ppid: 1, pgrp: shell },
];

function setup(
  options: { stale?: boolean; hosts?: CliHost[]; ids?: string[] } = {},
) {
  const board = new BoardStore(join(root, "board.json"));
  const ledger = new WorldLedger(join(root, "ledger.json"), {
    persist: false,
    now: () => 1_000,
  });
  const published = { board: 0, ledger: 0, asks: 0 };
  const cli = createWorldCli({
    board,
    ledger,
    hosts: () => options.hosts ?? [host()],
    defaultConnectionId: () => "studio",
    snapshot: async () => snapshot(options.stale, options.ids),
    publishBoard: () => (published.board += 1),
    publishLedger: (_revision, asks) => {
      published.ledger += 1;
      if (asks) published.asks += 1;
    },
    now: () => 1_000,
  });
  /** Pane roots the service searched under, per call. */
  const searched: number[][] = [];
  const run = (
    command: string,
    params: Record<string, unknown> = {},
    pane: string | null = "w1:p1",
    chain: CallerProcess[] | null = inPane(100),
  ) =>
    cli.handle(
      { command, params, caller: pane ? { pane_id: pane } : {} },
      // As /proc would: the caller is found only under the pane's processes.
      chain &&
        ((roots) => {
          searched.push([...roots]);
          return chain.some((entry) => roots.includes(entry.pid))
            ? chain
            : null;
        }),
    );
  return { board, ledger, published, run, searched };
}

beforeEach(() => {
  root = join(tmpdir(), `world-cli-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  calls = [];
  tabOrder = ["w1:t1", "w1:t2"];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("caller identity", () => {
  test("a pane whose process runs there is verified, with its agent", async () => {
    const { run } = setup();
    expect(await run("whoami")).toMatchObject({
      ok: true,
      result: {
        label: "claude in w1:p1",
        verified: true,
        connection_id: "studio",
        terminal_id: "term_a",
      },
    });
  });

  test("a spoofed HERDR_PANE_ID from another pane is unverified", async () => {
    const { run } = setup();
    // The process runs in w1:p2 (shell 200) but claims w1:p1.
    const reply = await run("whoami", {}, "w1:p1", inPane(200));
    expect(reply).toMatchObject({
      ok: true,
      result: { label: "unverified w1:p1", verified: false },
    });
    // An unknown process, or a remote Herdr, cannot be checked either.
    expect((await run("whoami", {}, "w1:p1", null)).actor?.verified).toBe(
      false,
    );
    const remote = setup({ hosts: [host({ local: false })] });
    expect((await remote.run("whoami")).actor?.verified).toBe(false);
  });

  test("a caller naming no pane is unverified, and nothing is searched", async () => {
    const { run, searched } = setup();
    expect((await run("whoami", {}, null)).actor).toEqual({
      label: NO_PANE,
      verified: false,
    });
    expect(searched).toEqual([]);
    // A claim is searched for only under that pane's own processes.
    await run("whoami");
    expect(searched).toEqual([[100]]);
  });

  test("a pane claim must look like a Herdr pane ID", async () => {
    const { run } = setup();
    for (const claim of ["x".repeat(80), "w1:p1\nfake", "<b>w1</b>:p1", "w1"])
      expect(await run("whoami", {}, claim, null)).toMatchObject({
        ok: false,
        code: "usage",
      });
  });

  test("`me` needs a verified pane; spawn claims too", async () => {
    const { run } = setup();
    const spoofed = await run(
      "colour set",
      { target: "me", colour: "teal" },
      "w1:p1",
      inPane(200),
    );
    expect(spoofed).toMatchObject({ ok: false, code: "refused" });
    expect(
      await run("spawned-by", { parent: "w1:p2" }, "w1:p1", inPane(200)),
    ).toMatchObject({ ok: false, code: "refused" });
    expect(calls.some((call) => call.method === "pane.report_metadata")).toBe(
      false,
    );
  });
});

describe("Board and colour changes", () => {
  test("colour set and reset write the tab's key, recorded and undoable", async () => {
    const { board, ledger, published, run } = setup();
    const set = await run("colour set", { target: "me", colour: "teal" });
    expect(set.ok).toBe(true);
    expect(board.get().layout.colors["studio:w1:t1"]).toBe("teal");
    const change = ledger.get().changes[0]!;
    expect(change).toMatchObject({
      command: "colour set",
      actor: { label: "claude in w1:p1", verified: true },
      undo: [{ op: "card.color", key: "studio:w1:t1", color: null }],
    });
    expect(published.board).toBe(1);
    await run("undo", { id: change.id });
    expect(board.get().layout.colors["studio:w1:t1"]).toBeUndefined();
    expect(ledger.get().changes[0]!.undone_by).toBe(
      ledger.get().changes[1]!.id,
    );
    expect(await run("undo", { id: change.id })).toMatchObject({
      ok: false,
      code: "refused",
    });
    // A workspace has its own key; unknown colours are refused.
    await run("colour set", { target: "workspace:w1", colour: "red" });
    expect(board.get().layout.colors["studio:w1"]).toBe("red");
    expect(
      await run("colour set", { target: "tab:w1:t2", colour: "mauve" }),
    ).toMatchObject({ ok: false, code: "usage" });
  });

  test("pin, move and unpin a card", async () => {
    const { board, run } = setup();
    await run("board card pin", { target: "tab:w1:t2", x: 10, y: 20 });
    expect(board.get().layout.pinned["studio:w1:t2"]).toEqual({ x: 10, y: 20 });
    await run("board card move", { target: "tab:w1:t2", x: 5, y: -5 });
    expect(board.get().layout.pinned["studio:w1:t2"]).toEqual({ x: 15, y: 15 });
    await run("board card unpin", { target: "tab:w1:t2" });
    expect(board.get().layout.pinned["studio:w1:t2"]).toBeUndefined();
    expect(
      await run("board card unpin", { target: "tab:w1:t2" }),
    ).toMatchObject({ ok: false, code: "refused" });
    // An elastic card moves by its offset.
    await run("board card move", { target: "tab:w1:t1", x: 30, y: 0 });
    expect(board.get().layout.offsets["studio:w1:t1"]).toEqual({ x: 30, y: 0 });
  });

  test("group and ungroup by terminal, and undo a group", async () => {
    const { board, ledger, run } = setup();
    await run("board card group", { target: "me", with: "tab:w1:t2" });
    expect(
      board.get().relations.groups[0]?.members.map((member) => member.ref),
    ).toEqual([
      { connection_id: "studio", terminal_id: "term_b" },
      { connection_id: "studio", terminal_id: "term_a" },
    ]);
    expect(board.get().relations.group_changes!.at(-1)!.sender).toEqual({
      label: "claude in w1:p1",
      basis: "inferred",
      via: "cli",
    });
    await run("undo", { id: ledger.get().changes[0]!.id });
    expect(board.get().relations.groups).toEqual([]);
    expect(board.get().relations.group_changes!.at(-1)!.sender).toEqual({
      label: "claude in w1:p1",
      basis: "inferred",
      via: "cli",
    });
    await run("board card group", { target: "me", with: "pane:w1:p2" });
    await run("board card ungroup", { target: "me" });
    expect(board.get().relations.groups).toEqual([]);
    expect(await run("board card ungroup", { target: "me" })).toMatchObject({
      ok: false,
      code: "refused",
    });
  });

  test("unknown targets, stale hosts and bad input are refused", async () => {
    expect(
      await setup().run("colour set", { target: "tab:w9:t9", colour: "red" }),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      await setup({ stale: true }).run("colour set", {
        target: "tab:w1:t1",
        colour: "red",
      }),
    ).toMatchObject({ ok: false, code: "unavailable" });
    expect(await setup().run("merge")).toMatchObject({
      ok: false,
      code: "usage",
    });
  });
});

describe("Herdr changes", () => {
  test("a desk move needs --herdr, goes through tab.move and cannot be undone", async () => {
    const { ledger, run } = setup();
    expect(
      await run("town desk move", { target: "tab:w1:t2", onto: "tab:w1:t1" }),
    ).toMatchObject({ ok: false, code: "refused" });
    expect(calls.some((call) => call.method === "tab.move")).toBe(false);
    await run("town desk move", {
      target: "tab:w1:t2",
      onto: "tab:w1:t1",
      herdr: true,
    });
    expect(calls.find((call) => call.method === "tab.move")?.params).toEqual({
      tab_id: "w1:t2",
      insert_index: 0,
    });
    const change = ledger.get().changes[0]!;
    expect(change.undo).toBeNull();
    expect(await run("undo", { id: change.id })).toMatchObject({
      ok: false,
      code: "refused",
    });
  });

  test("spawned-by stamps the verified caller's pane", async () => {
    const { run } = setup();
    expect((await run("spawned-by", { parent: "w1:p2" })).ok).toBe(true);
    expect(
      calls.find((call) => call.method === "pane.report_metadata")?.params,
    ).toMatchObject({
      pane_id: "w1:p1",
      tokens: { spawned_by: "w1:p2", spawned_by_terminal: "term_b" },
    });
  });
});

describe("questions and results", () => {
  test("withdrawal releases an already held service read without an answer", async () => {
    const { run, ledger } = setup();
    const asked = await run("ask", { question: "Wait for a decision?" });
    const id = (resultOf(asked) as { id: string }).id;
    const observed = Promise.withResolvers<void>();
    const original = ledger.ask.bind(ledger);
    ledger.ask = (key) => {
      const entry = original(key);
      if (entry && !entry.withdrawn) observed.resolve();
      return entry;
    };
    const waiting = run("ask get", { id, wait_ms: 1000 });
    await observed.promise;
    await run("ask withdraw", { id });
    expect(await waiting).toMatchObject({
      ok: true,
      result: { withdrawn: { at: 1000 } },
    });
    expect(
      (resultOf(await run("ask get", { id })) as { answer?: unknown }).answer,
    ).toBeUndefined();
  });

  test("withdrawal refuses another agent session in the same verified terminal", async () => {
    const current = host();
    const originalCall = current.call.bind(current);
    let session = "original-session";
    current.call = async (method, params) => {
      const result = await originalCall(method, params);
      return method === "pane.get"
        ? {
            pane: {
              ...(result as { pane: object }).pane,
              agent_session: {
                source: "reported",
                agent: "claude",
                kind: "id",
                value: session,
              },
            },
          }
        : result;
    };
    const { run, ledger } = setup({ hosts: [current] });
    const asked = await run("ask", {
      question: "Which design?",
      key: "example:design",
    });
    const id = (resultOf(asked) as { id: string }).id;
    expect(ledger.ask(id)?.actor).toMatchObject({
      connection_generation: 2,
      workspace_id: "w1",
      agent_session_id: "original-session",
      agent_session_fingerprint: expect.any(String),
    });
    session = "replacement-session";
    expect(await run("ask withdraw", { id })).toMatchObject({
      ok: false,
      code: "refused",
    });
    expect(ledger.openAsks().asks).toHaveLength(1);
  });

  test("a cause is asked once, only its verified asker can withdraw, and recurrence is fresh", async () => {
    const { run, ledger, published } = setup();
    const request = {
      question: "READY #7: should this ship?",
      key: "crew:7:ready",
      owner_only: true,
    };
    const first = await run("ask", request);
    const id = (resultOf(first) as { id: string }).id;
    expect(await run("ask", request)).toMatchObject({
      ok: true,
      result: { id },
    });
    expect(ledger.openAsks().asks).toHaveLength(1);
    expect(published.asks).toBe(1);
    expect(
      await run("ask withdraw", { id }, "w1:p2", inPane(200)),
    ).toMatchObject({ ok: false, code: "refused" });
    expect(await run("ask withdraw", { id }, null, null)).toMatchObject({
      ok: false,
      code: "refused",
    });
    expect(await run("ask withdraw", { id })).toMatchObject({
      ok: true,
      result: { withdrawn: { at: 1000 } },
    });
    expect(ledger.openAsks().asks).toEqual([]);
    const revision = ledger.get().revision;
    await run("ask withdraw", { id });
    expect(ledger.get().revision).toBe(revision);
    expect(
      await run("ask answer", { id, answer: "yes" }, "w1:p2", inPane(200)),
    ).toMatchObject({ ok: false, code: "refused" });
    const next = await run("ask", request);
    expect((resultOf(next) as { id: string }).id).not.toBe(id);
  });

  test("withdraw by cause key recovers only the asking occupant's retained question", async () => {
    const { run, ledger } = setup();
    const request = { question: "Ship?", key: "demo:ready", owner_only: true };
    const first = await run("ask", request);
    const id = (resultOf(first) as { id: string }).id;
    const sibling = await run("ask", request, "w1:p2", inPane(200));
    const other = (resultOf(sibling) as { id: string }).id;
    expect(await run("ask withdraw", { key: request.key })).toMatchObject({
      ok: true,
      result: { id, withdrawn: { at: 1000 } },
    });
    expect(ledger.openAsks().asks.map((ask) => ask.id)).toEqual([other]);
    const revision = ledger.get().revision;
    expect(await run("ask withdraw", { key: request.key })).toMatchObject({
      ok: true,
      result: { id },
    });
    expect(await run("ask withdraw", { key: "absent" })).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(ledger.get().revision).toBe(revision);
    expect(
      await run("ask withdraw", { key: request.key }, null, null),
    ).toMatchObject({ ok: false, code: "refused" });
    const next = await run("ask", request);
    const nextId = (resultOf(next) as { id: string }).id;
    expect(nextId).not.toBe(id);
    expect(await run("ask withdraw", { key: request.key })).toMatchObject({
      ok: true,
      result: { id: nextId },
    });
    expect(ledger.ask(other)!.withdrawn).toBeUndefined();
  });

  test("a keyed repeat returns its retained answer without reopening the question", async () => {
    const { run, ledger, published } = setup();
    const request = { question: "Ship?", key: "demo:ready", owner_only: true };
    const first = await run("ask", request);
    const id = (resultOf(first) as { id: string }).id;
    ledger.update((document) => {
      document.asks[0]!.answer = { text: "Wait", at: 1000, by: "owner" };
    });
    const before = published.asks;
    expect(await run("ask", request)).toMatchObject({
      ok: true,
      result: { id, answer: { text: "Wait" } },
    });
    expect(published.asks).toBe(before);
    expect(ledger.openAsks().asks).toEqual([]);
  });

  test("an ask waits for its answer; owner-only questions refuse agents", async () => {
    const { ledger, published, run } = setup();
    const ask = await run("ask", {
      question: "Ship it?",
      options: ["yes", "no"],
      owner_only: true,
    });
    const id = (resultOf(ask) as { id: string }).id;
    expect(await run("ask get", { id })).toMatchObject({
      ok: true,
      result: { question: "Ship it?", options: ["yes", "no"] },
    });
    expect(
      await run("ask answer", { id, answer: "yes" }, "w1:p2", inPane(200)),
    ).toMatchObject({ ok: false, code: "refused" });
    const open = await run("ask", { question: "Which host?" });
    const openId = (resultOf(open) as { id: string }).id;
    expect(
      await run(
        "ask answer",
        { id: openId, answer: "studio" },
        "w1:p2",
        inPane(200),
      ),
    ).toMatchObject({
      ok: true,
      result: { answer: { text: "studio", by: "codex in w1:p2" } },
    });
    expect(ledger.get().asks[0]!.answer).toBeUndefined();
    // Pages fetch only the open questions, and only when one changed.
    expect(ledger.openAsks().asks.map((entry) => entry.id)).toEqual([id]);
    expect(published.asks).toBe(3);
  });

  test("answers survive cause withdrawal and keyed repeats do not ask the owner twice", async () => {
    const { run, ledger } = setup();
    const request = { question: "Which host?", key: "example:host" };
    const first = await run("ask", request);
    const id = (resultOf(first) as { id: string }).id;
    await run("ask answer", { id, answer: "studio" }, "w1:p2", inPane(200));
    expect(await run("ask", request)).toMatchObject({ result: { id } });
    expect(ledger.get().asks).toHaveLength(1);
    await run("ask withdraw", { id });
    expect(ledger.ask(id)).toMatchObject({
      answer: { text: "studio" },
      withdrawn: { at: 1000 },
    });
  });

  test("results are kept with their task, status and PR", async () => {
    const { run } = setup();
    await run("result", {
      task: "FM-1",
      summary: "Fixed it",
      pr: 12,
      status: "done",
    });
    await run("result", { task: "FM-2", summary: "Stuck", status: "blocked" });
    expect(
      await run("result", { task: "FM-3", summary: "x", status: "maybe" }),
    ).toMatchObject({ ok: false, code: "usage" });
    expect(await run("result ls", { task: "FM-1" })).toMatchObject({
      ok: true,
      result: [
        {
          task: "FM-1",
          summary: "Fixed it",
          pr: 12,
          status: "done",
          actor: { label: "claude in w1:p1" },
        },
      ],
    });
  });

  test("history filters by actor", async () => {
    const { run } = setup();
    await run("colour set", { target: "me", colour: "teal" });
    await run("colour set", { target: "tab:w1:t2", colour: "red" }, null, null);
    const mine = await run("history", { actor: "w1:p1" });
    expect((resultOf(mine) as unknown[]).length).toBe(1);
    const owner = await run("history", { actor: NO_PANE });
    expect(resultOf(owner)).toMatchObject([
      { summary: "coloured studio:w1:t2 red" },
    ]);
  });
});

describe("review fixes", () => {
  test("undo refuses when the card changed since, and goes last first", async () => {
    const { board, ledger, run } = setup();
    await run("board card pin", { target: "tab:w1:t2", x: 10, y: 20 });
    await run("board card pin", { target: "tab:w1:t2", x: 30, y: 40 });
    const [first, second] = ledger.get().changes;
    expect(await run("undo", { id: first!.id })).toMatchObject({
      ok: false,
      code: "refused",
    });
    expect(board.get().layout.pinned["studio:w1:t2"]).toEqual({ x: 30, y: 40 });
    await run("undo", { id: second!.id });
    expect(board.get().layout.pinned["studio:w1:t2"]).toEqual({ x: 10, y: 20 });
    await run("undo", { id: first!.id });
    expect(board.get().layout.pinned["studio:w1:t2"]).toBeUndefined();
  });

  test("undoing an ungroup rebuilds the group it left", async () => {
    const { board, ledger, run } = setup();
    await run("board card group", { target: "me", with: "tab:w1:t2" });
    await run("board card ungroup", { target: "me" });
    expect(board.get().relations.groups).toEqual([]);
    await run("undo", { id: ledger.get().changes[1]!.id });
    expect(
      board
        .get()
        .relations.groups[0]?.members.map((m) =>
          typeof m.ref === "string" ? undefined : m.ref.terminal_id,
        )
        .sort(),
    ).toEqual(["term_a", "term_b"]);
  });

  test("a question is never answered by its asker or an unverified caller", async () => {
    const { run } = setup();
    const ask = await run("ask", { question: "Merge order?" });
    const id = (resultOf(ask) as { id: string }).id;
    expect(await run("ask answer", { id, answer: "mine" })).toMatchObject({
      ok: false,
      code: "refused",
    });
    expect(
      await run("ask answer", { id, answer: "x" }, "w1:p2", null),
    ).toMatchObject({ ok: false, code: "refused" });
    expect(
      await run("ask answer", { id, answer: "x" }, null, null),
    ).toMatchObject({ ok: false, code: "refused" });
  });

  test("open questions are capped per caller", async () => {
    const { run } = setup();
    for (let index = 0; index < 20; index += 1)
      expect((await run("ask", { question: `q${index}` })).ok).toBe(true);
    expect(await run("ask", { question: "one more" })).toMatchObject({
      ok: false,
      code: "refused",
    });
  });

  test("unverified callers share one allowance, whatever pane they claim", async () => {
    const { run } = setup();
    for (let index = 0; index < 20; index += 1)
      expect(
        (await run("ask", { question: `q${index}` }, `w9:p${index}`, null)).ok,
      ).toBe(true);
    expect(
      await run("ask", { question: "one more" }, "w9:p99", null),
    ).toMatchObject({ ok: false, code: "refused" });
    expect(
      await run("ask", { question: "one more" }, null, null),
    ).toMatchObject({ ok: false, code: "refused" });
    // A verified pane still has its own.
    expect((await run("ask", { question: "mine" })).ok).toBe(true);
  });

  test("`me` never resolves on another host, and points must be numbers", async () => {
    const other = host({ connection_id: "laptop" });
    const { run } = setup({
      hosts: [host(), other],
      ids: ["studio", "laptop"],
    });
    expect(
      await run("colour set", {
        target: "me",
        colour: "red",
        connection: "laptop",
      }),
    ).toMatchObject({ ok: false, code: "refused" });
    expect(
      await run("board card pin", { target: "me", x: "10", y: null }),
    ).toMatchObject({ ok: false, code: "usage" });
  });

  test("a Herdr failure is unavailable, not the caller's fault", async () => {
    const failing = host({
      call: async (method, params) => {
        if (method === "tab.list") throw new Error("socket closed: synthetic");
        return host().call(method, params);
      },
    });
    const { run } = setup({ hosts: [failing] });
    expect(
      await run("town desk move", {
        target: "tab:w1:t2",
        onto: "tab:w1:t1",
        herdr: true,
      }),
    ).toMatchObject({ ok: false, code: "unavailable" });
  });
});
