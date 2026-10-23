import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pruneVerificationRuns } from "./verification-parallel";
import { verificationCacheDirectory } from "./verification-setup";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test("every worktree shares one verified checker cache", () => {
  expect(verificationCacheDirectory({}, "/home/example")).toBe(
    resolve("/home/example/.cache/herdr-world/verification"),
  );
  expect(
    verificationCacheDirectory(
      { XDG_CACHE_HOME: "/var/cache/example" },
      "/home/example",
    ),
  ).toBe(resolve("/var/cache/example/herdr-world/verification"));
  expect(
    verificationCacheDirectory(
      { HERDR_WORLD_VERIFICATION_CACHE: "/srv/checker", XDG_CACHE_HOME: "/x" },
      "/home/example",
    ),
  ).toBe(resolve("/srv/checker"));
});

test("only the newest verification runs are kept", async () => {
  const runs = mkdtempSync(join(tmpdir(), "verification-runs-"));
  roots.push(runs);
  const names = [
    "2026-10-20T10-00-00.000Z-parallel-a",
    "2026-10-21T10-00-00.000Z-parallel-b",
    "2026-10-22T09-00-00.000Z-parallel-c",
    "2026-10-22T10-00-00.000Z-parallel-d",
    "2026-10-22T11-00-00.000Z-parallel-e",
    "notes", // not a run
  ];
  for (const name of names) mkdirSync(join(runs, name));
  expect((await pruneVerificationRuns(runs, 3)).sort()).toEqual(
    names.slice(0, 2),
  );
  expect(readdirSync(runs).sort()).toEqual([...names.slice(2)].sort());
  expect(await pruneVerificationRuns(join(runs, "missing"))).toEqual([]);
});
