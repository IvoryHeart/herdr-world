import { acquireCheckSlot, heldEnv } from "./check-lock";
import assert from "node:assert/strict";
import { worldPerformanceSuites } from "./world-browser-suites";
import { waitForQuiet } from "./wait-for-quiet";

/** Quiet admission and all three measurements are mandatory, without retry. @internal */
export async function runPerformanceTests(ports: {
  quiet(): Promise<{ quiet: boolean }>;
  run(files: string[], iteration: number): Promise<number>;
}) {
  for (let iteration = 1; iteration <= 3; iteration++) {
    assert(
      (await ports.quiet()).quiet,
      "Performance setup remained busy; no budget measurement admitted",
    );
    const code = await ports.run([...worldPerformanceSuites], iteration);
    if (code !== 0) return code;
  }
  return 0;
}

if (import.meta.main) {
  const release = await acquireCheckSlot("browser", {
    lane: "native performance",
  });
  try {
    process.exitCode = await runPerformanceTests({
      quiet: waitForQuiet,
      async run(files, iteration) {
        console.info(
          `[performance] pinned Chrome, sample ${iteration}/3; every frame budget retained`,
        );
        const child = Bun.spawn(
          [
            process.execPath,
            "scripts/run-world-tests.ts",
            ...files,
            "--parallel=1",
            "--max-concurrency=1",
          ],
          {
            env: {
              ...process.env,
              ...heldEnv("browser"),
              HERDR_WORLD_TEST_LABEL: `performance-${iteration}`,
              HERDR_WORLD_TEST_GPU: "0",
              HERDR_TEST_BROWSER_RENDERING: "swiftshader",
              HERDR_TEST_BROWSER: undefined,
              HERDR_TEST_BROWSER_TOKEN: undefined,
            },
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
          },
        );
        return child.exited;
      },
    });
  } finally {
    release();
  }
}
