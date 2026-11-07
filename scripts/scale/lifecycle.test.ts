import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

async function probe(mode: string) {
  const root = mkdtempSync(join(tmpdir(), "hws-lifecycle-unit-"));
  try {
    const child = Bun.spawn(
      [
        process.execPath,
        fileURLToPath(new URL("./lifecycle.fixture.ts", import.meta.url)),
        mode,
        root,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [code, output, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, error).toBe(0);
    return JSON.parse(output);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("queued output reuse preserves completed evidence and releases the queue", async () => {
  const result = await probe("output-reuse");
  expect(result.error).toContain("already contains evidence");
  expect(result.files).toEqual([
    "complete.json",
    "identity.json",
    "results.json",
  ]);
  expect(result.contents).toEqual({
    "complete.json": '{"complete":true,"rows":120}',
    "identity.json": '{"run":"original"}',
    "results.json": '[{"run":"original"}]',
  });
  expect(result.releases).toBe(1);
  expect(result.measurements).toBe(0);
  expect(result.spawns).toBe(0);
});

test("a failure after owning fresh output retains failure evidence and releases the queue", async () => {
  const result = await probe("owned-failure");
  expect(result.error).toContain("synthetic unit stop before measurements");
  expect(result.files).toEqual(["failure.json", "identity.json"]);
  expect(JSON.parse(result.contents["failure.json"]).completedRows).toBe(0);
  expect(result.releases).toBe(1);
  expect(result.measurements).toBe(1);
});

test("synchronous Chrome spawn failure removes its owned scratch", async () => {
  const result = await probe("chrome-spawn");
  expect(result.error).toContain("missing-synthetic-browser");
  expect(result.files).toEqual([]);
});
