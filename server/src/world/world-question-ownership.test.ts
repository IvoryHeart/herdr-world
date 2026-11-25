import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "./board-store";
import { createWorldCli, type WorldCliDeps } from "./world-cli";
import { answerAsk, dismissAsk, handleWorldAsk } from "./world-cli-asks";
import { WorldLedger, type CliActor, type LedgerAsk } from "./world-ledger";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const original: CliActor = {
  label: "Synthetic asker",
  verified: true,
  connection_id: "example-core",
  connection_generation: 1,
  pane_id: "t1",
  terminal_id: "t1",
  agent_session_fingerprint: "original",
  agent_session_id: "session-one",
};
const question = (id: string, actor = original): LedgerAsk => ({
  id,
  at: 1,
  actor,
  question: "Continue?",
  key: "work:ready",
  options: [],
  owner_only: true,
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "question-ownership-"));
  roots.push(root);
  const ledger = new WorldLedger(join(root, "ledger.json"), { persist: false });
  const deps: WorldCliDeps = {
    ledger,
    board: new BoardStore(join(root, "board.json")),
    hosts: () => [],
    defaultConnectionId: () => null,
    snapshot: async () => ({ revision: 1, observed_at: 1, connections: [] }),
    publishBoard() {},
    publishLedger() {},
  };
  return { ledger, deps };
}

test("question listing and withdrawal exhaust terminal ownership independently of generation and session", async () => {
  const { ledger, deps } = fixture();
  // All 128 identity equivalence classes, both ID and lost-ID/key recovery.
  // A reused pane with a different stable terminal is always a different asker.
  for (let mask = 0; mask < 128; mask++) {
    const actor: CliActor = {
      ...original,
      verified: !(mask & 1),
      connection_id: mask & 2 ? "other-core" : original.connection_id,
      terminal_id: mask & 4 ? "t2" : original.terminal_id,
      connection_generation: mask & 8 ? 3 : 1,
      agent_session_fingerprint: mask & 16 ? "restarted" : "original",
      agent_session_id: mask & 32 ? "session-two" : "session-one",
      pane_id: mask & 64 ? "t9" : "t1",
    };
    for (const byKey of [false, true]) {
      await ledger.update((doc) => {
        doc.asks = [question("q-original")];
      });
      const permitted = !(mask & 7);
      const listing = await handleWorldAsk(
        deps,
        "ask ls",
        {},
        actor,
        () => 2,
      ).catch(() => null);
      expect({ mask, listing }).toEqual({
        mask,
        listing: !actor.verified
          ? null
          : permitted
            ? [
                {
                  id: "q-original",
                  state: "open",
                  age_ms: 1,
                  question: "Continue?",
                },
              ]
            : [],
      });
      const result = await handleWorldAsk(
        deps,
        "ask withdraw",
        byKey ? { key: "work:ready" } : { id: "q-original" },
        actor,
        () => 2,
      ).then(
        () => true,
        () => false,
      );
      expect({ mask, byKey, result }).toEqual({
        mask,
        byKey,
        result: permitted,
      });
      expect(Boolean(ledger.ask("q-original")?.withdrawn)).toBe(permitted);
    }
  }
});

test("legacy question listing retains strict original identity checks", async () => {
  const { ledger, deps } = fixture();
  const legacy = {
    ...original,
    terminal_id: undefined,
    agent_session_fingerprint: undefined,
  };
  await ledger.update((doc) => {
    doc.asks = [question("q-legacy", legacy)];
  });
  for (let mask = 0; mask < 64; mask++) {
    const actor = {
      ...legacy,
      verified: !(mask & 1),
      connection_id: mask & 2 ? "other-core" : legacy.connection_id,
      terminal_id: mask & 4 ? "t1" : undefined,
      connection_generation: mask & 8 ? 3 : legacy.connection_generation,
      pane_id: mask & 16 ? "t9" : legacy.pane_id,
      agent_session_id: mask & 32 ? "replacement" : legacy.agent_session_id,
    };
    const listing = await handleWorldAsk(
      deps,
      "ask ls",
      {},
      actor,
      () => 2,
    ).catch(() => null);
    expect({ mask, listing }).toEqual({
      mask,
      listing: !actor.verified
        ? null
        : mask === 0
          ? [
              {
                id: "q-legacy",
                state: "open",
                age_ms: 1,
                question: "Continue?",
              },
            ]
          : [],
    });
  }
});

test("the current verified core terminal withdraws after restart; a forged address cannot", async () => {
  const { ledger, deps } = fixture();
  let generation = 1;
  let fingerprint = "before";
  const cli = createWorldCli({
    ...deps,
    core: () => ({
      has: (id) => id === "example-core",
      hosts: () => [
        {
          connection_id: "example-core",
          generation,
          local: true,
          isCurrent: () => true,
          coreId: () => "synthetic-core",
          occupant: (address) => ({
            coreId: "synthetic-core",
            pid: address === "t1" ? 100 : 200,
            foregroundPid: null,
            fingerprint,
          }),
          describe: async () => null,
        },
      ],
    }),
  });
  const run = (
    command: string,
    params: Record<string, unknown>,
    terminal = "t1",
    pid = 100,
  ) =>
    cli.handle({ command, params, caller: { core_terminal: terminal } }, () => [
      { pid: 900, ppid: pid, pgrp: 900 },
      { pid, ppid: 1, pgrp: pid },
    ]);
  const ask = await run("ask", { question: "Continue?" });
  if (!ask.ok) throw new Error(ask.error);
  const { id } = ask.result as { id: string };
  generation = 3;
  fingerprint = "after";
  expect(await run("ask ls", {})).toMatchObject({
    ok: true,
    result: [{ id, state: "open" }],
  });
  expect(await run("ask ls", {}, "t2", 200)).toMatchObject({
    ok: true,
    result: [],
  });
  expect(await run("ask ls", {}, "t1", 200)).toMatchObject({
    ok: false,
    code: "refused",
  });
  expect(await run("ask withdraw", { id }, "t2", 200)).toMatchObject({
    ok: false,
  });
  expect(await run("ask withdraw", { id }, "t1", 200)).toMatchObject({
    ok: false,
  });
  expect(await run("ask withdraw", { id })).toMatchObject({
    ok: true,
    result: { withdrawn: { at: expect.any(Number) } },
  });
  expect(ledger.openAsks().asks).toEqual([]);
  expect(await run("ask ls", {})).toMatchObject({
    ok: true,
    result: [{ id, state: "withdrawn" }],
  });
});

test("owner bulk dismissal closes only open questions from the stable asker", async () => {
  const { ledger } = fixture();
  await ledger.update((doc) => {
    doc.asks = [
      question("q-old"),
      question("q-new", {
        ...original,
        connection_generation: 3,
        agent_session_fingerprint: "after",
      }),
      question("q-other-terminal", { ...original, terminal_id: "t2" }),
      question("q-other-connection", {
        ...original,
        connection_id: "other-core",
      }),
      question("q-unverified", { ...original, verified: false }),
      {
        ...question("q-answered"),
        answer: { at: 1, by: "owner", text: "Yes" },
      },
      { ...question("q-withdrawn"), withdrawn: { at: 1 } },
    ];
  });
  await dismissAsk(ledger, "q-old", "owner", 2, true);
  expect(
    ledger
      .get()
      .asks.filter((ask) => ask.dismissed)
      .map((ask) => ask.id),
  ).toEqual(["q-old", "q-new"]);
  expect(ledger.ask("q-answered")?.answer?.text).toBe("Yes");
  expect(ledger.ask("q-withdrawn")?.dismissed).toBeUndefined();
  await expect(
    Promise.resolve().then(() =>
      dismissAsk(ledger, "q-unverified", "owner", 2, true),
    ),
  ).rejects.toThrow("verified terminal");
});

function permutations<T>(values: T[]): T[][] {
  return values.length === 0
    ? [[]]
    : values.flatMap((value, i) =>
        permutations(values.filter((_, j) => i !== j)).map((rest) => [
          value,
          ...rest,
        ]),
      );
}

test("all 120 orders of restart, withdrawal, answer, bulk close and cap admission", async () => {
  const { ledger, deps } = fixture();
  const schedules = permutations([
    "restart",
    "withdraw",
    "answer",
    "bulk",
    "ask",
  ]);
  expect(schedules).toHaveLength(120);
  for (const schedule of schedules) {
    await ledger.update((doc) => {
      doc.asks = Array.from({ length: 20 }, (_, i) => question(`q-${i}`));
    });
    const model = new Map<string, Set<string>>(
      Array.from({ length: 20 }, (_, i) => [`q-${i}`, new Set<string>()]),
    );
    let actor = original;
    for (const action of schedule) {
      if (action === "restart")
        actor = {
          ...original,
          connection_generation: 3,
          agent_session_fingerprint: "after",
        };
      if (action === "withdraw") {
        await handleWorldAsk(
          deps,
          "ask withdraw",
          { id: "q-0" },
          actor,
          () => 2,
        );
        model.get("q-0")!.add("withdrawn");
      }
      if (action === "answer") {
        const permitted = model.get("q-1")!.size === 0;
        const accepted = await Promise.resolve()
          .then(() => answerAsk(ledger, "q-1", "Yes", "owner", 2))
          .then(
            () => true,
            () => false,
          );
        expect(accepted).toBe(permitted);
        if (permitted) model.get("q-1")!.add("answer");
      }
      if (action === "bulk") {
        await dismissAsk(ledger, "q-0", "owner", 2, true);
        for (const state of model.values())
          if (state.size === 0) state.add("dismissed");
      }
      if (action === "ask") {
        const permitted =
          [...model.values()].filter((state) => state.size === 0).length < 20;
        const response = await handleWorldAsk(
          deps,
          "ask",
          { question: "New work?" },
          actor,
          () => 2,
        ).then(
          (value) => ({ accepted: true, value }),
          (error) => ({ accepted: false, value: error.code }),
        );
        expect(response.accepted).toBe(permitted);
        if (response.accepted)
          model.set((response.value as { id: string }).id, new Set());
        else expect(response.value).toBe("question_cap");
      }
      for (const [id, state] of model) {
        const actual = ledger.ask(id)!;
        expect([
          Boolean(actual.withdrawn),
          Boolean(actual.answer),
          Boolean(actual.dismissed),
        ]).toEqual([
          state.has("withdrawn"),
          state.has("answer"),
          state.has("dismissed"),
        ]);
      }
    }
  }
});
