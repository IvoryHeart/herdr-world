import { afterAll, beforeAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  copyFileSync,
  existsSync,
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
const root = mkdtempSync(join(tmpdir(), "runtime-status-crash-"));
let binary: string;
const source = resolve(
  import.meta.dir,
  "testing/runtime-status-crash-fixture.ts",
);
const paths = (directory: string) => ({
  database: join(directory, "world.sqlite"),
  ledger: join(directory, "ledger.json"),
  settings: join(directory, "settings.json"),
});
const open = (directory: string) =>
  openWorldLedger(paths(directory), {
    clock: systemClock,
    scheduler: systemScheduler,
  });
const a = "connection:alpha:local:/synthetic/repo",
  b = "connection:beta:local:/synthetic/repo";
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
      resolve(import.meta.dir, "../testing/runtime-status-crash-entry.ts"),
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
    process.platform === "win32" ? "runtime-status.exe" : "runtime-status",
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
  const timeout = setTimeout(() => child.kill(), 15_000);
  try {
    while (!output.includes("\n")) {
      const part = await reader.read();
      if (part.done)
        throw new Error(
          `fixture ended early: ${await new Response(child.stderr).text()}`,
        );
      output += new TextDecoder().decode(part.value);
    }
    expect(output.trim()).toBe(phase);
  } finally {
    if (kill) child.kill("SIGKILL");
    const code = await child.exited;
    clearTimeout(timeout);
    reader.releaseLock();
    if (!kill) expect(code).toBe(0);
  }
}
for (const compiled of [false, true]) {
  const label = compiled ? "standalone" : "source",
    command = () => (compiled ? [binary] : [process.execPath, source]);
  for (const phase of ["before-commit", "after-commit", "worker-ack"])
    test(`${label}: runtime status ${phase} survives as complete committed rows`, async () => {
      const directory = mkdtempSync(join(root, "writes-")),
        initial = await open(directory);
      await initial.close();
      await crash(command(), directory, phase);
      const reopened = await open(directory);
      try {
        const rows = reopened.runtimeStatus.list();
        expect(Object.keys(rows).length).toBe(
          phase === "before-commit" ? 0 : 2,
        );
        if (phase !== "before-commit") {
          expect(rows[a]).toMatchObject({
            last_status: "updated",
            last_message: "Synthetic committed run",
          });
          expect(rows[b]).toMatchObject({ last_status: "failed" });
        }
        const info = await reopened.inspect();
        expect(info.integrity).toBe("ok");
        if (phase === "worker-ack")
          console.info(
            `runtime status native ${label}: SQLite ${info.sqlite}; journal ${info.journal_mode}; synchronous ${info.synchronous}`,
          );
      } finally {
        await reopened.close();
      }
    });
  for (const phase of ["import-before-commit", "import-after-commit"])
    test(`${label}: runtime status ${phase} restarts import once`, async () => {
      const directory = mkdtempSync(join(root, "import-"));
      writeFileSync(
        paths(directory).settings,
        JSON.stringify({
          version: 1,
          custom: { synthetic_secret: "file-only" },
          workspace_auto_sync: {
            [a]: { enabled: true, last_status: "updated" },
            [b]: { enabled: false, last_status: "failed" },
          },
        }),
        { mode: 0o600 },
      );
      await crash(command(), directory, phase);
      const db = new Database(paths(directory).database);
      try {
        const count = phase === "import-after-commit" ? 1 : 0;
        expect(
          db.query("SELECT count(*) AS count FROM auto_sync_runs").get(),
        ).toEqual({ count: count * 2 });
        expect(
          db
            .query(
              "SELECT count(*) AS count FROM imports WHERE name='runtime-status-json'",
            )
            .get(),
        ).toEqual({ count });
      } finally {
        db.close();
      }
      for (const file of [
        paths(directory).database,
        `${paths(directory).database}-wal`,
      ])
        if (existsSync(file))
          expect(readFileSync(file).includes(Buffer.from("file-only"))).toBe(
            false,
          );
      if (phase === "import-after-commit")
        writeFileSync(
          paths(directory).settings,
          "{ changed after committed import",
        );
      for (let i = 0; i < 2; i++) {
        const reopened = await open(directory);
        try {
          expect(reopened.runtimeStatus.list()).toEqual({
            [a]: { last_status: "updated" },
            [b]: { last_status: "failed" },
          });
          expect((await reopened.inspect()).integrity).toBe("ok");
        } finally {
          await reopened.close();
        }
      }
    });
  test(`${label}: runtime status drains 33 accepted writes and closed cached reads never reopen SQLite`, async () => {
    const directory = mkdtempSync(join(root, "drain-"));
    await crash(command(), directory, "worker-drain", false);
    const reopened = await open(directory);
    await reopened.close();
    expect(reopened.runtimeStatus.get(a)?.last_message).toBe("Synthetic 32");
    const before = readFileSync(paths(directory).database);
    await expect(
      reopened.runtimeStatus.put(a, { last_status: "failed" }),
    ).rejects.toThrow(/clos/);
    expect(readFileSync(paths(directory).database)).toEqual(before);
  });
}
