import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "await.ts");

test("waits for completion, preserves failure and bounds output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-await-"));
  try {
    const log = join(dir, "run.log");
    const child = Bun.spawn(
      [
        process.execPath,
        script,
        "--log",
        log,
        "--",
        process.execPath,
        "-e",
        'await Bun.sleep(100); console.log("x".repeat(100000)); console.error("finished"); process.exit(7)',
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(child.stdout).text();
    expect(await child.exited).toBe(7);
    expect(output.length).toBeLessThan(10000);
    expect(output).toContain("finished");
    expect(output).toContain("exit=7");
    expect(readFileSync(log, "utf8").length).toBeGreaterThan(100000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("does not overwrite existing logs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-await-"));
  try {
    const log = join(dir, "run.log");
    await Bun.write(log, "preserved");
    const child = Bun.spawn(
      [
        process.execPath,
        script,
        "--log",
        log,
        "--",
        process.execPath,
        "-e",
        'console.log("replacement")',
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    await new Response(child.stderr).text();
    expect(await child.exited).not.toBe(0);
    expect(readFileSync(log, "utf8")).toBe("preserved");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
