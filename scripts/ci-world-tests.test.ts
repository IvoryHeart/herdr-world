import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { worldBrowserShards } from "./world-browser-suites";

test.each([0, 1, 2, 3])(
  "case-shard runner retains every pass, retry report and failure (fail pass %i)",
  async (failPass) => {
    const root = await mkdtemp(join(tmpdir(), "world-case-ci-"));
    try {
      await mkdir(join(root, "scripts"));
      await writeFile(
        join(root, "scripts/run-world-tests.ts"),
        `
import {appendFileSync} from "node:fs";
const args = process.argv.slice(2);
appendFileSync("runs.jsonl", JSON.stringify(args)+"\\n");
if (process.env.HERDR_WORLD_TEST_LABEL?.endsWith("-pass-${failPass}")) process.exit(7);
`,
      );
      const child = Bun.spawn(
        [process.execPath, join(import.meta.dir, "ci-world-tests.ts"), "1"],
        {
          cwd: root,
          env: {
            ...process.env,
            HERDR_CI_SELECTION: JSON.stringify({
              world: [...new Set(worldBrowserShards.flat())],
            }),
            HERDR_CI_WORLD_RUNS: "3",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [code, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
      ]);
      expect(stderr).toBe("");
      expect(code).toBe(failPass ? 7 : 0);
      const runs = (await readFile(join(root, "runs.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]);
      expect(runs).toHaveLength(failPass || 3);
      for (const args of runs) {
        expect(
          args.filter((arg) => /\.test\.[cm]?[jt]sx?$/.test(arg)).sort(),
        ).toEqual([...worldBrowserShards[0]!].sort());
        expect(args).toContain("--shard=1/6");
        expect(args).toContain("--parallel=2");
        expect(args).toContain("--retry-flaky=browser");
      }
      expect(
        new Set(
          runs.map((args) =>
            args.find((arg) => arg.startsWith("--flake-report=")),
          ),
        ).size,
      ).toBe(runs.length);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
