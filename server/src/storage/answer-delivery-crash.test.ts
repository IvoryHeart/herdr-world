import { afterAll, beforeAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openWorldLedger } from "./world-storage";
const root = mkdtempSync(join(tmpdir(), "answer-crash-"));
const source = resolve(
  import.meta.dir,
  "../world/testing/answer-delivery-process.ts",
);
let binary: string;
beforeAll(async () => {
  const build = join(
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
      resolve(import.meta.dir, "../testing/answer-delivery-entry.ts"),
      resolve(import.meta.dir, "world-worker.ts"),
      "--outfile",
      build,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const [code, errors] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  if (code !== 0)
    throw new Error(`Compiling actual Chat/answer fixture failed: ${errors}`);
  mkdirSync(join(root, "standalone"));
  binary = join(
    root,
    "standalone",
    process.platform === "win32" ? "answer.exe" : "answer",
  );
  copyFileSync(build, binary);
}, 120_000);
afterAll(() => rmSync(root, { recursive: true, force: true }));
const ports = {
  clock: { now: () => 2_000_000, monotonic: () => performance.now() },
  scheduler: {
    schedule(callback: () => void, delay: number) {
      const timer = setTimeout(callback, delay);
      return { cancel: () => clearTimeout(timer) };
    },
  },
};
function received(directory: string) {
  const path = join(directory, "receiver.sqlite");
  if (!existsSync(path)) return [];
  const db = new Database(path, { readonly: true });
  try {
    return (
      db.query("SELECT body FROM received ORDER BY seq").all() as {
        body: string;
      }[]
    ).map((row) => row.body);
  } finally {
    db.close();
  }
}
async function until(executable: string[], directory: string, phase: string) {
  const child = Bun.spawn([...executable, directory, phase], {
    cwd: join(root, "standalone"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const errors = new Response(child.stderr).text();
  const reader = child.stdout.getReader();
  const guard = setTimeout(() => child.kill(), 30_000);
  let output = "";
  try {
    while (!output.includes("\n")) {
      const next = await reader.read();
      if (next.done)
        throw new Error(`Fixture ended before ${phase}: ${await errors}`);
      output += new TextDecoder().decode(next.value);
    }
    expect(output.trim()).toBe(phase);
    child.kill("SIGKILL");
    await child.exited;
  } finally {
    clearTimeout(guard);
    child.kill();
    await child.exited;
    reader.releaseLock();
  }
}
for (const compiled of [false, true]) {
  const label = compiled ? "standalone compiled" : "source";
  const executable = () => (compiled ? [binary] : [process.execPath, source]);
  for (const phase of [
    "before-claim",
    "after-claim",
    "before-effect",
    "after-effect",
    "after-receipt",
  ])
    test(`${label}: actual Chat recovery after ${phase} keeps opaque submission honest`, async () => {
      const directory = mkdtempSync(join(root, "case-"));
      await until(executable(), directory, phase);
      const possible = phase === "before-effect" || phase === "after-effect";
      const delivered = phase === "after-receipt";
      const storage = await openWorldLedger(
        {
          database: join(directory, "world.sqlite"),
          ledger: join(directory, "legacy.json"),
        },
        ports,
      );
      try {
        const ask = storage.ledger.ask("q-native")!;
        expect(ask.answer?.text).toBe("Stored fixture answer");
        const [entry] = await storage.outbox.forRecord(ask.id);
        expect(entry?.state).toBe(
          possible ? "uncertain" : delivered ? "delivered" : "pending",
        );
        expect(entry?.claimed).toBe(false);
        expect(JSON.stringify(entry?.intent)).not.toContain(
          "Stored fixture answer",
        );
        if (possible)
          expect(entry?.attempts).toMatchObject([{ state: "uncertain" }]);
      } finally {
        await storage.close();
      }
      const recovery = Bun.spawn([...executable(), directory, "recover"], {
        cwd: join(root, "standalone"),
        stdout: "pipe",
        stderr: "pipe",
        timeout: 30_000,
      });
      const [code, output, error] = await Promise.all([
        recovery.exited,
        new Response(recovery.stdout).text(),
        new Response(recovery.stderr).text(),
      ]);
      expect(code, error).toBe(0);
      expect(JSON.parse(output).answer).toBe("Stored fixture answer");
      const messages = received(directory);
      expect(messages).toHaveLength(phase === "before-effect" ? 0 : 1);
      if (messages.length)
        expect(messages[0]).toBe(
          "Answer to q-native:\nQuestion: Proceed with the fixture?\nAnswer from owner: Stored fixture answer",
        );
      expect(JSON.parse(output).state).toBe(
        possible ? "uncertain" : "delivered",
      );
    }, 60_000);
}
