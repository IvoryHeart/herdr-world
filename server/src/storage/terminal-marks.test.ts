import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorldLedger } from "./world-storage";
import { systemClock, systemScheduler } from "../service/ports";
import { openWorldWriter } from "./world-writer";
import { terminalMarkInput } from "./testing/terminal-mark-input";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
test("a committed watch retains its World ID and verified binding across a real SQLite restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "terminal-marks-"));
  roots.push(root);
  const paths = {
    database: join(root, "world.sqlite"),
    ledger: join(root, "ledger.json"),
  };
  const open = () =>
    openWorldLedger(paths, { clock: systemClock, scheduler: systemScheduler });
  const fence = {
    adapter: "herdr",
    instance: "alpha",
    service_incarnation: "synthetic",
    generation: 1,
  };
  const event = {
    type: "listing" as const,
    fence,
    complete: true,
    entities: [
      {
        native_id: "pane-a",
        terminals: ["terminal-a"],
        session: "a".repeat(64),
      },
    ],
  };
  const store = await open();
  const saved = await store.terminalMarks.put({
    kind: "watchlist",
    body: { label: "Watch" },
    target: {
      adapter: "herdr",
      instance: "alpha",
      kind: "pane",
      native_id: "pane-a",
      evidence: { terminals: ["terminal-a"] },
    },
    event,
    current: fence,
  });
  await store.close();
  const again = await open();
  try {
    expect(again.terminalMarks.list()).toEqual([
      { ...saved, binding: { ...saved.binding, state: "unresolved" } },
    ]);
    expect(saved.id).toMatch(/^w-[0-9a-hjkmnp-tv-z]{8}$/);
    expect(JSON.stringify(again.terminalMarks.list())).not.toContain(
      "generation",
    );
    expect((await again.inspect()).integrity).toBe("ok");
  } finally {
    await again.close();
  }
});

function orders<T>(values: readonly T[]): T[][] {
  return values.length
    ? values.flatMap((value, index) =>
        orders(values.filter((_, i) => i !== index)).map((rest) => [
          value,
          ...rest,
        ]),
      )
    : [[]];
}
test("all 24 independent-family/refusal orders preserve only complete accepted record/binding pairs", () => {
  for (const order of orders([
    "desk",
    "watchlist",
    "completion-seen",
    "refused",
  ] as const)) {
    const root = mkdtempSync(join(tmpdir(), "mark-orders-"));
    roots.push(root);
    const path = join(root, "world.sqlite"),
      ledger = join(root, "ledger.json");
    const writer = openWorldWriter(path, ledger, 1000, "synthetic-incarnation");
    const results = writer.batch(
      order.map((kind, ticket) => ({
        ticket,
        request: {
          type: "terminal-mark" as const,
          operation: {
            type: "put" as const,
            input:
              kind === "refused"
                ? {
                    ...terminalMarkInput("watchlist", "refused-terminal"),
                    body: {
                      label: "Refused",
                      transcript: "Forbidden synthetic text",
                    } as any,
                  }
                : terminalMarkInput(kind),
          },
        },
      })),
      1000,
    );
    for (const [i, kind] of order.entries())
      expect(Boolean(results[i]!.error)).toBe(kind === "refused");
    const rows = writer.read().terminalMarks!;
    expect(rows.map((row) => row.kind).sort()).toEqual([
      "completion-seen",
      "desk",
      "watchlist",
    ]);
    expect(rows.every((row) => row.binding.record_id === row.id)).toBe(true);
    writer.close();
    const again = openWorldWriter(path, ledger, 2000, "new-incarnation");
    try {
      expect(again.read().terminalMarks).toEqual(rows);
    } finally {
      again.close();
    }
  }
});
test("stale record revisions and ambiguous source evidence cannot change a committed mark", async () => {
  const root = mkdtempSync(join(tmpdir(), "mark-revisions-"));
  roots.push(root);
  const store = await openWorldLedger(
    { database: join(root, "world.sqlite"), ledger: join(root, "ledger.json") },
    { clock: systemClock, scheduler: systemScheduler },
  );
  try {
    const input = terminalMarkInput("watchlist"),
      initial = await store.terminalMarks.put(input);
    const next = await store.terminalMarks.put({
      ...input,
      id: initial.id,
      revision: initial.revision,
      body: { label: "Newer" },
    });
    await refusal(
      store.terminalMarks.put({
        ...input,
        id: initial.id,
        revision: initial.revision,
        body: { label: "Stale" },
      }),
      "revision conflict",
    );
    await refusal(
      store.terminalMarks.remove(initial.id, initial.revision),
      "revision conflict",
    );
    const event = input.event;
    if (event.type !== "listing") throw new Error("expected listing");
    await refusal(
      store.terminalMarks.put({
        ...input,
        id: next.id,
        revision: next.revision,
        event: {
          ...event,
          entities: [
            ...event.entities,
            {
              native_id: "other-pane",
              terminals: ["other-terminal"],
              session: "a".repeat(64),
            },
          ],
        },
      }),
      "not attached",
    );
    expect(store.terminalMarks.list()).toEqual([next]);
  } finally {
    await store.close();
  }
});

// Settle the worker message before asserting: Bun's rejection matcher can block
// delivery of a worker MessagePort event while waiting for its rejection.
async function refusal(promise: Promise<unknown>, message: string) {
  const error = await promise.then(
    () => null,
    (error) => error,
  );
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toContain(message);
}

test("SQLite revision fences reject stale edits and deletes", () => {
  const root = mkdtempSync(join(tmpdir(), "mark-revision-writer-"));
  roots.push(root);
  const writer = openWorldWriter(
    join(root, "world.sqlite"),
    join(root, "ledger.json"),
    1000,
    "synthetic-incarnation",
  );
  const execute = (
    operation: import("./terminal-marks").TerminalMarkOperation,
  ) =>
    writer.batch(
      [{ ticket: 1, request: { type: "terminal-mark", operation } }],
      1000,
    )[0]!;
  try {
    const input = terminalMarkInput("watchlist");
    const first = (
      execute({ type: "put", input }).result as {
        row: import("./terminal-marks").SavedTerminalMark;
      }
    ).row;
    const next = {
      ...input,
      id: first.id,
      revision: first.revision,
      body: { label: "Newer" },
    };
    expect(execute({ type: "put", input: next }).error).toBeUndefined();
    expect(execute({ type: "put", input: next }).error).toBe(
      "terminal mark revision conflict",
    );
    expect(
      execute({ type: "remove", id: first.id, revision: first.revision }).error,
    ).toBe("terminal mark revision conflict");
    expect(writer.read().terminalMarks![0]!.body.label).toBe("Newer");
  } finally {
    writer.close();
  }
});
