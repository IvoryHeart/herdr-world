import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnTestBatch } from "./file-deadline";

test.each(
  [1, 2].flatMap((parallel) =>
    ["import", "module", "sync", "beforeAll", "test", "afterAll"].map(
      (phase) => [phase, parallel] as const,
    ),
  ),
)(
  "a hung %s fails with its file name and stopped clock (parallel=%i)",
  async (phase, parallel) => {
    const directory = await mkdtemp(join(tmpdir(), "file-deadline-"));
    const file = join(directory, "hung.test.ts");
    try {
      await writeFile(
        join(directory, "hung-import.ts"),
        'import { jest } from "bun:test"; jest.useFakeTimers(); await new Promise(() => {});',
      );
      await writeFile(
        file,
        `${phase === "import" ? 'import "./hung-import.ts";' : ""}
import { jest, beforeAll, afterAll, test } from "bun:test";
jest.useFakeTimers();
const hang = () => new Promise<void>(() => {});
${phase === "module" ? "await hang();" : phase === "sync" ? "for (;;) {}" : ""}
${phase === "beforeAll" ? "beforeAll(hang);" : ""}
test("fixture", ${phase === "test" ? "hang" : "() => {}"});
${phase === "afterAll" ? "afterAll(hang);" : ""}
`,
      );
      const child = Bun.spawn(
        [
          process.execPath,
          join(import.meta.dir, "../run-tests.ts"),
          file,
          `--parallel=${parallel}`,
        ],
        {
          env: {
            ...process.env,
            HERDR_TEST_EXCLUDE_WORLD_BROWSER: "1",
            HERDR_TEST_FILE_TIMEOUT_MS: "100",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      // A broken watchdog must fail this regression without leaving its child alive.
      const supervisor = setTimeout(() => child.kill("SIGKILL"), 1500);
      try {
        const [code, , stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(code).toBe(124);
        expect(stderr).toContain(`[test-file-timeout] ${file} exceeded 100 ms`);
      } finally {
        clearTimeout(supervisor);
        child.kill("SIGKILL");
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("a batch that cannot start releases its deadline registry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deadline-start-failure-"));
  try {
    expect(() =>
      spawnTestBatch([join(directory, "missing-synthetic-command")], {
        env: { ...process.env, TMPDIR: directory },
        stdout: "ignore",
        stderr: "ignore",
      }),
    ).toThrow();
    expect(await readdir(directory)).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
