import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import type { ValidationSelection } from "./validation-scope";
import { worldBrowserShards } from "./world-browser-suites";

export function selectedCITests(
  selection: ValidationSelection,
  lane: string,
  shard?: string,
): string[] {
  assert(
    ["unit", "world", "web", "latency"].includes(lane),
    "Unknown CI test lane",
  );
  let files = selection[lane as "unit" | "world" | "web" | "latency"];
  assert(
    Array.isArray(files) &&
      files.every(
        (path) =>
          typeof path === "string" &&
          /^(?:scripts|web|server|shared|quint|tools|verification)\/.+\.test\.[cm]?[jt]sx?$/.test(
            path,
          ) &&
          !path.split("/").includes(".."),
      ),
    "Invalid CI test selection",
  );
  if ((lane === "unit" || lane === "web") && shard) {
    assert(/^[12]\/2$/.test(shard), "Invalid test shard");
    files = files.filter((_, index) => index % 2 === Number(shard[0]) - 1);
  }
  if (lane === "latency" && shard) {
    assert(
      /^[1-6]$/.test(shard) && Number(shard) <= files.length,
      "Invalid latency shard",
    );
    files = [files[Number(shard) - 1]!];
  }
  if (lane === "world" && shard) {
    const index = Number(shard) - 1;
    assert(
      Number.isInteger(index) && worldBrowserShards[index],
      "Invalid World shard",
    );
    files = files.filter((path) => worldBrowserShards[index]!.includes(path));
  }
  return files;
}

if (import.meta.main) {
  const [lane, shard] = process.argv.slice(2);
  const selection = JSON.parse(
    process.env.HERDR_CI_SELECTION || "null",
  ) as ValidationSelection;
  assert(selection && lane, "Missing CI selection");
  const files = selectedCITests(selection, lane, shard);
  if (files.length) {
    mkdirSync(".agents/delivery", { recursive: true });
    const child = Bun.spawn(
      [
        process.execPath,
        lane === "world" || lane === "latency"
          ? "scripts/run-world-tests.ts"
          : "scripts/run-tests.ts",
        ...files,
        "--parallel=1",
        `--max-concurrency=${lane === "latency" ? 1 : 2}`,
        ...(lane === "latency" ? ["--retry=1"] : []),
        ...(lane === "web"
          ? [
              "--reporter=junit",
              `--reporter-outfile=.agents/delivery/web-browser-${shard?.replace("/", "-of-") || "all"}.xml`,
            ]
          : []),
      ],
      { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
    );
    const stop = () => child.kill("SIGTERM");
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    try {
      process.exitCode = await child.exited;
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
  } else console.info(`${lane}: no affected suites`);
}
