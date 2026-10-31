import { afterAll, beforeAll, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openWorldLedger } from "./world-storage";
import { systemClock, systemScheduler } from "../service/ports";

const root = mkdtempSync(join(tmpdir(), "terminal-mark-crashes-"));
const source = resolve(
  import.meta.dir,
  "testing/terminal-marks-crash-fixture.ts",
);
let binary: string;
beforeAll(async () => {
  const built = join(
    root,
    process.platform === "win32" ? "fixture.exe" : "fixture",
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
      resolve(import.meta.dir, "../testing/terminal-marks-crash-entry.ts"),
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
    process.platform === "win32" ? "fixture.exe" : "fixture",
  );
  copyFileSync(built, binary);
}, 60_000);
afterAll(() => rmSync(root, { recursive: true, force: true }));
for (const compiled of [false, true])
  for (const phase of [
    "before-commit",
    "after-commit",
    "worker-ack",
    "worker-drain",
  ]) {
    test(`${compiled ? "standalone" : "source"}: terminal marks ${phase} retain only complete commits`, async () => {
      const directory = mkdtempSync(join(root, "case-"));
      const child = Bun.spawn(
        [
          ...(compiled ? [binary] : [process.execPath, source]),
          directory,
          phase,
        ],
        { cwd: join(root, "standalone"), stdout: "pipe", stderr: "pipe" },
      );
      const timeout = setTimeout(() => child.kill(), 15_000);
      const reader = child.stdout.getReader();
      let output = "";
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
        if (phase !== "worker-drain") child.kill("SIGKILL");
        const code = await child.exited;
        clearTimeout(timeout);
        reader.releaseLock();
        if (phase === "worker-drain") expect(code).toBe(0);
      }
      const store = await openWorldLedger(
        {
          database: join(directory, "world.sqlite"),
          ledger: join(directory, "ledger.json"),
        },
        { clock: systemClock, scheduler: systemScheduler },
      );
      try {
        const rows = store.terminalMarks.list();
        expect(rows).toHaveLength(phase === "before-commit" ? 0 : 3);
        for (const row of rows) {
          expect(row.binding.record_id).toBe(row.id);
          expect(row.binding.state).toBe("unresolved");
          expect(row.binding.evidence.terminals).toEqual(["terminal-a"]);
        }
        expect((await store.inspect()).integrity).toBe("ok");
      } finally {
        await store.close();
      }
    }, 30_000);
  }
