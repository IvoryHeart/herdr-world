import { expect } from "bun:test";
import { Database } from "bun:sqlite";
import { systemClock, systemScheduler } from "../service/ports";
import { BoardStore } from "../world/board-store";
import { jest, mock, test } from "bun:test";
import {
  runCrashProcess,
  CrashTrace,
  type CrashChild,
} from "./testing/crash-harness";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openWorldLedger } from "./world-storage";
import { createCrashFixture } from "./testing/crash-harness";
const harness = createCrashFixture({
  name: "board",
  source: resolve(import.meta.dir, "testing/board-crash-fixture.ts"),
  entry: resolve(import.meta.dir, "../testing/board-crash-entry.ts"),
  worker: resolve(import.meta.dir, "world-worker.ts"),
});
const { root } = harness;
const paths = (directory: string) => ({
  database: join(directory, "world.sqlite"),
  ledger: join(directory, "ledger.json"),
  board: join(directory, "board.json"),
});
const open = (directory: string) =>
  openWorldLedger(paths(directory), {
    clock: systemClock,
    scheduler: systemScheduler,
  });
async function crash(
  command: string[],
  directory: string,
  phase: string,
  kill = true,
  spawn?: () => CrashChild,
) {
  await runCrashProcess({
    command: [...command, directory, phase],
    cwd: harness.cwd,
    phase,
    marker: phase,
    kill,
    timeout: 15000,
    spawn,
    trace: new CrashTrace("stderr control", undefined, () => {}),
  });
}
test("rejected stderr drain still reaps the crash child and releases cleanup resources", async () => {
  jest.useFakeTimers();
  const failure = new Error("synthetic stderr read failure");
  const stdout = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("after-commit\n"));
      controller.close();
    },
  });
  const stderr = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.error(failure);
    },
  });
  const exit = Promise.withResolvers<number>();
  const kill = mock(() => exit.resolve(137));
  try {
    await expect(
      crash(
        ["synthetic-command"],
        "synthetic-db",
        "after-commit",
        true,
        () => ({
          stdout,
          stderr,
          kill,
          exited: exit.promise,
        }),
      ),
    ).rejects.toBe(failure);
    expect(kill).toHaveBeenCalledWith("SIGKILL");
    expect({ timers: jest.getTimerCount(), locked: stdout.locked }).toEqual({
      timers: 0,
      locked: false,
    });
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});
for (const compiled of [false, true]) {
  const label = compiled ? "standalone" : "source",
    command = () => harness.command(compiled);
  for (const phase of ["before-commit", "after-commit", "worker-ack"])
    harness.test(
      `${label}: Board ${phase} recovers records and bindings together`,
      {
        prepare: async (run) => {
          const directory = mkdtempSync(join(root, "writes-"));
          const initial = await run.reopen(() => open(directory));
          await initial.close();

          return directory;
        },
        crash: async (directory, run) => {
          await run.until(command(), directory, phase);
        },
        recover: async (directory, run) => {
          const reopened = await run.reopen(() => open(directory));
          try {
            const committed = phase !== "before-commit",
              doc = reopened.board.get();
            expect(doc.revision).toBe(committed ? 1 : 0);
            expect(doc.notes).toHaveLength(committed ? 1 : 0);
            expect(doc.strings).toHaveLength(committed ? 1 : 0);
            expect(Object.keys(doc.appearance ?? {})).toHaveLength(
              committed ? 1 : 0,
            );
            expect(
              (await reopened.bindings.list()).map((b) => b.policy).sort(),
            ).toEqual(
              committed ? ["appearance", "board-string", "interest"] : [],
            );
            const info = await reopened.inspect();
            expect(info.integrity).toBe("ok");
            if (phase === "worker-ack")
              console.info(
                `Board native ${label}: SQLite ${info.sqlite}; journal ${info.journal_mode}; synchronous ${info.synchronous}`,
              );
          } finally {
            await reopened.close();
          }
          const db = new Database(paths(directory).database, {
            readonly: true,
          });
          try {
            expect(
              db
                .query(
                  "SELECT count(*) AS count FROM world_ids WHERE id IN ('note-a','string-a')",
                )
                .get(),
            ).toEqual({ count: phase === "before-commit" ? 0 : 2 });
            expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
          } finally {
            db.close();
          }
        },
      },
    );
  for (const phase of ["import-before-commit", "import-after-commit"])
    harness.test(
      `${label}: Board ${phase} imports once without partial rows or bindings`,
      {
        prepare: () => {
          const directory = mkdtempSync(join(root, "import-"));
          const legacy = new BoardStore(paths(directory).board);
          const doc = legacy.patch([
            {
              op: "note.put",
              note: {
                id: "note-a",
                text: "Synthetic legacy note",
                color: "yellow",
                x: 0,
                y: 0,
              },
            },
            {
              op: "string.put",
              string: {
                id: "string-a",
                from: { note: "note-a" },
                to: {
                  anchor: {
                    connection_id: "studio",
                    kind: "pane",
                    native_id: "pane-a",
                    witness: ["terminal-a"],
                  },
                },
              },
            },
          ]);

          return { directory, doc };
        },
        crash: async ({ directory }, run) => {
          await run.until(command(), directory, phase);
        },
        recover: async ({ directory, doc }, run) => {
          const db = new Database(paths(directory).database);
          try {
            const count = phase === "import-after-commit" ? 1 : 0;
            for (const table of [
              "board_notes",
              "board_strings",
              "world_bindings",
            ])
              expect(
                db.query(`SELECT count(*) AS count FROM ${table}`).get(),
              ).toEqual({ count });
            expect(
              db
                .query(
                  "SELECT count(*) AS count FROM imports WHERE name='board-json'",
                )
                .get(),
            ).toEqual({ count });
          } finally {
            db.close();
          }
          if (phase === "import-after-commit")
            writeFileSync(
              paths(directory).board,
              "{ changed after committed import",
            );
          for (let i = 0; i < 2; i++) {
            const reopened = await run.reopen(() => open(directory));
            try {
              expect(reopened.board.get()).toEqual(doc);
              expect(await reopened.bindings.list()).toHaveLength(1);
              expect((await reopened.inspect()).integrity).toBe("ok");
            } finally {
              await reopened.close();
            }
          }
        },
      },
    );
  harness.test(
    `${label}: Board close drains 33 accepted writes and closed reads never reopen SQLite`,
    {
      prepare: () => {
        const directory = mkdtempSync(join(root, "drain-"));

        return directory;
      },
      crash: async (directory, run) => {
        await run.until(command(), directory, "worker-drain", {
          kill: false,
          checkExit: true,
        });
      },
      recover: async (directory, run) => {
        const reopened = await run.reopen(() => open(directory));
        await reopened.close();
        expect(reopened.board.get().notes[0]!.text).toBe("Synthetic 32");
        expect(reopened.board.get().revision).toBe(33);
        const before = readFileSync(paths(directory).database);
        await expect(reopened.board.patch([])).rejects.toThrow(/clos/);
        expect(readFileSync(paths(directory).database)).toEqual(before);
      },
    },
  );
}
