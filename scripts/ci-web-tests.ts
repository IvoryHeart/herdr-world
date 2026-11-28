import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { selectedCITests } from "./ci-tests";
import type { ValidationSelection } from "./validation-scope";

type TestBatch = { files: string[]; pattern?: string };

/** @internal Bound web tables without changing unit selection or file deadlines. */
export function webTestBatches(files: string[]): TestBatch[] {
  const uiScale = "web/src/uiScale.test.ts";
  if (!files.includes(uiScale)) return files.length ? [{ files }] : [];
  // uiScale has 41 contexts. Each group keeps its original case concurrency;
  // a healthy sequence must not outlive the hard per-file deadline on CI.
  const groups = [
    "uiScale|paneJump|taskPush|updateNotification|connectionProfiles",
    "configuration",
    "terminalLoading|terminalHiddenAttach|terminalKeyboard",
    "terminalLinks|terminalLinksTown|terminalLinksBoard",
  ];
  const others = files.filter((file) => file !== uiScale);
  return [
    ...(others.length ? [{ files: others }] : []),
    ...groups.map((fixtures) => ({
      files: [uiScale],
      pattern: `, (?:${fixtures}), height`,
    })),
    // One complement owns the remaining known fixtures AND any future ones.
    {
      files: [uiScale],
      pattern: `^(?![\\s\\S]*, (?:${groups.join("|")}), height)`,
    },
  ];
}

if (import.meta.main) {
  const [shard] = process.argv.slice(2);
  assert(shard && process.env.HERDR_CI_SELECTION, "Missing web CI selection");
  const selection = JSON.parse(
    process.env.HERDR_CI_SELECTION,
  ) as ValidationSelection;
  const batches = webTestBatches(selectedCITests(selection, "web", shard));
  mkdirSync(".agents/delivery", { recursive: true });
  if (!batches.length) {
    console.info("web: no affected suites");
    writeFileSync(
      `.agents/delivery/flakes-web-${shard.replace("/", "-of-")}-empty-${process.env.GITHUB_RUN_ATTEMPT || "local"}.json`,
      JSON.stringify({ files: [], flaky: [] }),
    );
  }
  for (const [index, batch] of batches.entries()) {
    const suffix = `${shard.replace("/", "-of-")}-batch-${index + 1}`;
    const child = Bun.spawn(
      [
        process.execPath,
        "scripts/run-tests.ts",
        ...batch.files,
        ...(batch.pattern ? [`--test-name-pattern=${batch.pattern}`] : []),
        "--parallel=2",
        "--max-concurrency=2",
        "--retry-flaky=browser",
        `--flake-report=.agents/delivery/flakes-web-${suffix}-${process.env.GITHUB_RUN_ATTEMPT || "local"}.json`,
        "--reporter=junit",
        `--reporter-outfile=.agents/delivery/web-browser-${suffix}.xml`,
      ],
      { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
    );
    let cancelled = false;
    const stop = () => {
      cancelled = true;
      child.kill("SIGTERM");
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    try {
      const code = await child.exited;
      if (code !== 0) process.exitCode = code;
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
    if (cancelled) break;
  }
}
