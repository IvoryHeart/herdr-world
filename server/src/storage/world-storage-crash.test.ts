import { afterAll, beforeAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openWorldLedger } from "./world-storage";

const root = mkdtempSync(join(tmpdir(), "world-crash-"));
const fixture = resolve(import.meta.dir, "testing/crash-fixture.ts");
let binary: string;
beforeAll(async () => {
  const build = join(
    root,
    process.platform === "win32" ? "build.exe" : "build",
  );
  const processBuild = Bun.spawn(
    [
      process.execPath,
      "build",
      "--compile",
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
      fixture,
      resolve(import.meta.dir, "world-worker.ts"),
      "--outfile",
      build,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [code, errors] = await Promise.all([
    processBuild.exited,
    new Response(processBuild.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`compiled storage fixture failed: ${errors}`);
  mkdirSync(join(root, "standalone"));
  binary = join(
    root,
    "standalone",
    process.platform === "win32" ? "storage.exe" : "storage",
  );
  copyFileSync(build, binary);
}, 60_000);
afterAll(() => rmSync(root, { recursive: true, force: true }));
const ports = {
  clock: { now: () => 1000, monotonic: () => performance.now() },
  scheduler: {
    schedule(callback: () => void, delay: number) {
      const timer = setTimeout(callback, delay);
      return { cancel: () => clearTimeout(timer) };
    },
  },
};
const reopen = (directory: string) =>
  openWorldLedger(
    {
      database: join(directory, "world.sqlite"),
      ledger: join(directory, "ledger.json"),
    },
    ports,
  );

async function runUntil(
  executable: string[],
  directory: string,
  phase: string,
  kill = true,
) {
  const child = Bun.spawn([...executable, directory, phase], {
    cwd: join(root, "standalone"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = child.stdout.getReader();
  const guard = setTimeout(() => child.kill(), 15_000);
  let text = "";
  try {
    while (!text.includes("\n")) {
      const next = await reader.read();
      if (next.done)
        throw new Error(
          `fixture ended before ${phase}: ${await new Response(child.stderr).text()}`,
        );
      text += new TextDecoder().decode(next.value);
    }
    expect(text.trim()).toBe(
      phase === "worker-ack"
        ? "ack"
        : phase === "worker-drain"
          ? "drained"
          : phase,
    );
  } finally {
    if (kill) child.kill("SIGKILL");
    await child.exited;
    clearTimeout(guard);
    reader.releaseLock();
  }
}

for (const compiled of [false, true]) {
  const label = compiled ? "standalone compiled" : "source";
  const executable = () => (compiled ? [binary] : [process.execPath, fixture]);
  test(`${label}: worker acknowledgements survive whole-process kill; partial queue drains`, async () => {
    const directory = mkdtempSync(join(root, "ack-"));
    await runUntil(executable(), directory, "worker-ack");
    const storage = await reopen(directory);
    try {
      expect(storage.ledger.ask("q-ack")?.answer?.text).toBe("Acknowledged");
      expect(await storage.outbox.list()).toHaveLength(2);
      expect((await storage.inspect()).integrity).toBe("ok");
    } finally {
      await storage.close();
    }
    const drain = mkdtempSync(join(root, "drain-"));
    await runUntil(executable(), drain, "worker-drain", false);
    const drained = await reopen(drain);
    try {
      expect(drained.ledger.get().asks).toHaveLength(33);
    } finally {
      await drained.close();
    }
  }, 30_000);

  for (const phase of ["before-commit", "after-commit"])
    test(`${label}: crash ${phase} preserves atomic domain and outbox`, async () => {
      const directory = mkdtempSync(join(root, "commit-"));
      await runUntil(executable(), directory, phase);
      const storage = await reopen(directory);
      try {
        const committed = phase === "after-commit";
        expect(Boolean(storage.ledger.ask("q-interrupted")?.answer)).toBe(
          committed,
        );
        expect(await storage.outbox.list()).toHaveLength(committed ? 1 : 0);
        expect((await storage.inspect()).integrity).toBe("ok");
      } finally {
        await storage.close();
      }
    });

  for (const phase of [
    "answer-before-effect",
    "answer-after-effect",
    "answer-after-receipt",
    "notification-after-effect",
  ]) {
    test(`${label}: crash ${phase} follows the effect recovery class`, async () => {
      const directory = mkdtempSync(join(root, "effect-"));
      await runUntil(executable(), directory, "worker-ack");
      await runUntil(executable(), directory, phase);
      const storage = await reopen(directory);
      let due: Awaited<ReturnType<typeof reopen>> | undefined;
      try {
        const notification = phase.startsWith("notification");
        const entry = (
          await storage.outbox.forRecord(notification ? "q-owner" : "q-ack")
        ).find(
          (entry) =>
            entry.kind === (notification ? "ask.created" : "synthetic.answer"),
        )!;
        const delivered = phase.endsWith("after-receipt");
        expect(entry.state).toBe(delivered ? "delivered" : "uncertain");
        expect(storage.ledger.ask("q-ack")?.answer?.text).toBe("Acknowledged");
        expect(await storage.outbox.claim(entry.id)).toBeNull();
        await storage.close();
        due = await openWorldLedger(
          {
            database: join(directory, "world.sqlite"),
            ledger: join(directory, "ledger.json"),
          },
          { ...ports, clock: { ...ports.clock, now: () => entry.due_at } },
        );
        const retried = await due.outbox.claim(entry.id);
        expect(Boolean(retried)).toBe(notification);
        if (retried) {
          // Deduplication belongs to this synthetic receiver, never to Herdr.
          const receiver = new Database(join(directory, "receiver.sqlite"));
          try {
            receiver
              .query("INSERT OR IGNORE INTO receipts VALUES(?)")
              .run(entry.id);
            expect(
              (
                receiver
                  .query("SELECT count(*) AS count FROM receipts")
                  .get() as { count: number }
              ).count,
            ).toBe(1);
          } finally {
            receiver.close();
          }
          await due.outbox.finish(
            entry.id,
            retried.attempt,
            "delivered",
            "Synthetic receiver deduplicated the operation ID",
          );
        }
      } finally {
        await due?.close();
        await storage.close();
      }
    }, 30_000);
  }
}
