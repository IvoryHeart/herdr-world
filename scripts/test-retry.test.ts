import { expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJUnit } from "./test-retry";

// Real runner fixtures prove the second process executes only the failed scope.
test.each(["unit", "browser"] as const)(
  "%s recovery retries only failed scope and records file/case",
  async (kind) => {
    const root = mkdtempSync(join(tmpdir(), "test-retry-"));
    try {
      mkdirSync(join(root, "scripts"));
      writeFileSync(
        join(root, "scripts/transient.test.ts"),
        `
      import { test, expect, describe } from "bun:test";
      import { existsSync, writeFileSync, appendFileSync } from "node:fs";
      describe("nested [suite]", () => {
        describe("inner.*", () => {
        test("flaky (case) & quote", () => {
          appendFileSync("attempts", "f");
          const retried = existsSync("once"); writeFileSync("once", "yes");
          expect(retried).toBe(true);
        });
        test("healthy", () => { appendFileSync("attempts", "h"); });
        });
      });
    `,
      );
      writeFileSync(
        join(root, "scripts/healthy.test.ts"),
        `
      import { test } from "bun:test";
      import { appendFileSync } from "node:fs";
      test("other file", () => { appendFileSync("other", "h"); });
    `,
      );
      const result = await launch(root, kind);
      expect(result.code, result.stderr).toBe(0);
      expect(readFileSync(join(root, "other"), "utf8")).toBe("h");
      expect(readFileSync(join(root, "attempts"), "utf8")).toBe(
        kind === "unit" ? "fhfh" : "fhf",
      );
      const report = JSON.parse(
        readFileSync(join(root, "flakes.json"), "utf8"),
      );
      expect(report.flaky).toEqual([
        {
          file: "scripts/transient.test.ts",
          name: "nested [suite] inner.* flaky (case) & quote",
        },
      ]);
      expect(report.files.sort()).toEqual([
        "scripts/healthy.test.ts",
        "scripts/transient.test.ts",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  15000,
);

test.each(["permanent", "crash", "tripwire"])(
  "%s failure cannot become green",
  async (failure) => {
    const root = mkdtempSync(join(tmpdir(), "test-retry-failure-"));
    try {
      mkdirSync(join(root, "scripts"));
      writeFileSync(
        join(root, "scripts/transient.test.ts"),
        `
      import { test, expect } from "bun:test";
      import { existsSync, writeFileSync, appendFileSync } from "node:fs";
      import { spawnSync } from "node:child_process";
      test("failure", () => {
        appendFileSync("attempts", "f");
        const retried = existsSync("once"); writeFileSync("once", "yes");
        ${failure === "crash" ? "process.exit(1);" : failure === "tripwire" ? 'try { spawnSync("herdr", ["ls"]); } catch {} expect(retried).toBe(true);' : "expect(false).toBe(true);"}
      });
    `,
      );
      const result = await launch(root, "browser");
      expect(result.code).not.toBe(0);
      expect(
        JSON.parse(readFileSync(join(root, "flakes.json"), "utf8")).flaky,
      ).toEqual([]);
      expect(
        readFileSync(join(root, "attempts"), "utf8").length,
      ).toBeLessThanOrEqual(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  15000,
);

test("malformed/missing JUnit cannot prove recovery", () => {
  expect(() => parseJUnit("truncated")).toThrow();
});

async function launch(root: string, kind: string, files = ["./scripts/"]) {
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, "run-tests.ts"),
      ...files,
      "--parallel=1",
      "--max-concurrency=1",
      `--retry-flaky=${kind}`,
      "--flake-report=flakes.json",
      "--reporter=junit",
      "--reporter-outfile=first.xml",
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        CI: "false",
        HERDR_TEST_EXCLUDE_WORLD_BROWSER: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [code, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  return { code, stderr };
}

test("a successful platform-only file with no cases stays green and records its selected file", async () => {
  const root = mkdtempSync(join(tmpdir(), "test-retry-empty-"));
  try {
    mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, "scripts/empty.test.ts"), "export {};");
    const result = await launch(root, "unit", ["./scripts/empty.test.ts"]);
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(root, "flakes.json"), "utf8"))).toEqual(
      { files: ["scripts/empty.test.ts"], flaky: [] },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 10000);
