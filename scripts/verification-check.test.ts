import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

test("canonical verification rejects filters before starting checkers", () => {
  const result = spawnSync(
    process.execPath,
    [
      resolve(import.meta.dir, "verification-check.ts"),
      "--case",
      "runtime-leases",
    ],
    { encoding: "utf8" },
  );
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("The canonical gate accepts no filters");
});

test("resource sharding admits only the complete maintained three-group partition", () => {
  for (const args of [
    ["--case", "runtime-leases"],
    ["--shard=4/3"],
    ["--shard=1/2"],
    ["--shard=1/3", "--shard=2/3"],
    ["--system", "--system"],
  ]) {
    const result = spawnSync(
      process.execPath,
      [resolve(import.meta.dir, "verification-resources.ts"), ...args],
      { encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Resource gate accepts only");
  }
});
