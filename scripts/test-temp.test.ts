import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanupRunTemp,
  createRunTemp,
  processesUsing,
  sweepStaleRunTemps,
} from "./test-temp";

const bases: string[] = [];
afterEach(() => {
  for (const base of bases.splice(0))
    rmSync(base, { recursive: true, force: true });
});
function base() {
  const directory = mkdtempSync(join(tmpdir(), "test-temp-base-"));
  bases.push(directory);
  return directory;
}

test("a run directory names its owner", () => {
  const run = createRunTemp(base());
  expect(
    JSON.parse(readFileSync(join(run, ".herdr-world-owner"), "utf8")).pid,
  ).toBe(process.pid);
});

test("cleanup kills a process still using the directory, then removes it", async () => {
  const run = createRunTemp(base());
  mkdirSync(join(run, "profile"));
  // Stands in for an orphaned Chrome started with --user-data-dir inside it.
  const orphan = Bun.spawn(
    ["sh", "-c", "sleep 30", `--user-data-dir=${join(run, "profile")}`],
    { stdout: "ignore", stderr: "ignore" },
  );
  await Bun.sleep(100);
  expect(processesUsing(run)).toContain(orphan.pid);
  cleanupRunTemp(run);
  expect(await orphan.exited).not.toBe(0);
  expect(existsSync(run)).toBe(false);
});

test("sweeping removes only run directories whose owner is gone", async () => {
  const root = base();
  const mine = createRunTemp(root);
  const dead = Bun.spawn(["true"]);
  await dead.exited;
  const orphaned = join(root, "hwt-orphaned");
  mkdirSync(join(orphaned, ".com.google.Chrome.example"), { recursive: true });
  writeFileSync(
    join(orphaned, ".herdr-world-owner"),
    JSON.stringify({ pid: dead.pid }),
  );
  // Without an owner note: an older run, swept only after a day.
  const oldUnowned = join(root, "hwt-old");
  const youngUnowned = join(root, "hwt-young");
  for (const directory of [oldUnowned, youngUnowned]) mkdirSync(directory);
  const twoDaysAgo = (Date.now() - 2 * 24 * 60 * 60 * 1000) / 1000;
  utimesSync(oldUnowned, twoDaysAgo, twoDaysAgo);
  // Not ours at all, such as a desktop Chrome's scratch directory.
  const foreign = join(root, "com.google.Chrome.desktop");
  mkdirSync(foreign);

  expect(sweepStaleRunTemps(root).sort()).toEqual(
    [oldUnowned, orphaned].sort(),
  );
  for (const kept of [mine, youngUnowned, foreign])
    expect(existsSync(kept)).toBe(true);
});
