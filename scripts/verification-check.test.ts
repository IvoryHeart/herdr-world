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
