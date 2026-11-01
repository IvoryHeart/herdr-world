import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openWorldLedger } from "./world-storage";
import { systemClock, systemScheduler } from "../service/ports";
import { BoardStore, type BoardDocument } from "../world/board-store";

const root = mkdtempSync(join(tmpdir(), "board-crash-"));
// The child already has a 15s watchdog. Give it time to reap before its hook
// expires; fixture setup must not consume the recovery test's default 5s.
const crashSetupTimeout = 20_000;
let binary: string;
const source = resolve(import.meta.dir, "testing/board-crash-fixture.ts");
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
beforeAll(async () => {
  const built = join(
    root,
    process.platform === "win32" ? "build.exe" : "build",
  );
  const child = Bun.spawn(
    [
      process.execPath,
      "build",
      "--compile",
      "--minify",
      "--sourcemap",
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
      resolve(import.meta.dir, "../testing/board-crash-entry.ts"),
      resolve(import.meta.dir, "world-worker.ts"),
      "--outfile",
      built,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [code, errors] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(errors);
  mkdirSync(join(root, "standalone"));
  binary = join(
    root,
    "standalone",
    process.platform === "win32" ? "board.exe" : "board",
  );
  copyFileSync(built, binary);
}, 60_000);
afterAll(() => rmSync(root, { recursive: true, force: true }));
async function crash(
  command: string[],
  directory: string,
  phase: string,
  kill = true,
) {
  const child = Bun.spawn([...command, directory, phase], {
    cwd: join(root, "standalone"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = child.stdout.getReader();
  let output = "";
  const errors = new Response(child.stderr).text();
  let timedOut = false;
  let code: number | undefined;
  const timeoutMessage = `Board fixture ${phase} timed out after 15000ms`;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, 15_000);
  try {
    while (!output.includes("\n")) {
      const part = await reader.read();
      if (part.done)
        throw new Error(
          `${timedOut ? timeoutMessage : `fixture ended before ${phase}`}: ${await errors}`,
        );
      output += new TextDecoder().decode(part.value);
    }
    expect(output.trim()).toBe(phase);
  } finally {
    if (kill) child.kill("SIGKILL");
    code = await child.exited;
    await errors;
    clearTimeout(timeout);
    reader.releaseLock();
  }
  if (timedOut) throw new Error(`${timeoutMessage}: ${await errors}`);
  if (!kill) expect(code).toBe(0);
}
for (const compiled of [false, true]) {
  const label = compiled ? "standalone" : "source",
    command = () => (compiled ? [binary] : [process.execPath, source]);
  for (const phase of ["before-commit", "after-commit", "worker-ack"])
    describe(`${label}: Board ${phase}`, () => {
      let directory: string;
      beforeAll(async () => {
        directory = mkdtempSync(join(root, "writes-"));
        const initial = await open(directory);
        await initial.close();
      });
      beforeAll(() => crash(command(), directory, phase), crashSetupTimeout);
      test("recovers records and bindings together", async () => {
        const reopened = await open(directory);
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
        const db = new Database(paths(directory).database, { readonly: true });
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
      });
    });
  for (const phase of ["import-before-commit", "import-after-commit"])
    describe(`${label}: Board ${phase}`, () => {
      let directory: string;
      let doc: BoardDocument;
      beforeAll(() => {
        directory = mkdtempSync(join(root, "import-"));
        const legacy = new BoardStore(paths(directory).board);
        doc = legacy.patch([
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
      });
      beforeAll(() => crash(command(), directory, phase), crashSetupTimeout);
      test("imports once without partial rows or bindings", async () => {
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
          const reopened = await open(directory);
          try {
            expect(reopened.board.get()).toEqual(doc);
            expect(await reopened.bindings.list()).toHaveLength(1);
            expect((await reopened.inspect()).integrity).toBe("ok");
          } finally {
            await reopened.close();
          }
        }
      });
    });
  describe(`${label}: Board close`, () => {
    let directory: string;
    beforeAll(async () => {
      directory = mkdtempSync(join(root, "drain-"));
      await crash(command(), directory, "worker-drain", false);
    }, crashSetupTimeout);
    test("drains 33 accepted writes and closed reads never reopen SQLite", async () => {
      const reopened = await open(directory);
      await reopened.close();
      expect(reopened.board.get().notes[0]!.text).toBe("Synthetic 32");
      expect(reopened.board.get().revision).toBe(33);
      const before = readFileSync(paths(directory).database);
      await expect(reopened.board.patch([])).rejects.toThrow(/clos/);
      expect(readFileSync(paths(directory).database)).toEqual(before);
    });
  });
}
