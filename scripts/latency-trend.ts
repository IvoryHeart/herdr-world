import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The World latency trend report. Each measurement line comes from
 * recordLatency (web/src/world/testing/latencyTrend.ts). The report sets this
 * run beside the median of recent main runs on the same CPU model, because
 * hosted runners differ by model and a timing is only comparable within one.
 * It reports and never fails: no timing gates a change.
 */

export type Measurement = {
  suite: string;
  case: string;
  cpu: string | null;
  metrics: Record<string, number>;
};

/** A change this large against at least three main runs is flagged. */
export const FLAG_RATIO = 1.25;
const MIN_BASELINE = 3;

export function parseMeasurements(text: string): Measurement[] {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Measurement)
    .filter(
      (item) =>
        typeof item.suite === "string" &&
        typeof item.case === "string" &&
        item.metrics &&
        typeof item.metrics === "object",
    );
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** A Markdown table: this run, main's median on the same CPU, and the change. */
export function trendReport(
  current: Measurement[],
  baseline: Measurement[],
): string {
  const rows = [
    "| Case | Metric | This run (ms) | Main median, same CPU (ms) | Change |",
    "| --- | --- | ---: | ---: | ---: |",
  ];
  let flagged = 0;
  for (const item of current) {
    const peers = baseline.filter(
      (other) =>
        other.suite === item.suite &&
        other.case === item.case &&
        other.cpu === item.cpu,
    );
    for (const [metric, value] of Object.entries(item.metrics)) {
      const history = peers
        .map((peer) => peer.metrics[metric])
        .filter((entry): entry is number => Number.isFinite(entry));
      const reference = history.length ? median(history) : null;
      const ratio = reference ? value / reference : null;
      const flag =
        ratio !== null && history.length >= MIN_BASELINE && ratio > FLAG_RATIO;
      if (flag) flagged++;
      rows.push(
        `| ${item.suite} ${item.case} | ${metric} | ${Math.round(value)} | ${
          reference === null
            ? "none yet"
            : `${Math.round(reference)} (${history.length} runs)`
        } | ${
          ratio === null
            ? ""
            : `${ratio >= 1 ? "+" : ""}${Math.round((ratio - 1) * 100)}%${flag ? " ▲" : ""}`
        } |`,
      );
    }
  }
  const cpus = [...new Set(current.map((item) => item.cpu ?? "unknown"))];
  return [
    "## World latency trend",
    "",
    `Runner CPU: ${cpus.join("; ")}. Timing is reported, never asserted; ▲ marks a value more than ${Math.round((FLAG_RATIO - 1) * 100)}% above the median of at least ${MIN_BASELINE} main runs on the same CPU.`,
    "",
    flagged
      ? `${flagged} value${flagged === 1 ? "" : "s"} flagged.`
      : "Nothing flagged.",
    "",
    ...rows,
    "",
  ].join("\n");
}

function readDirectory(directory: string): Measurement[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".jsonl"))
    .flatMap((path) =>
      parseMeasurements(readFileSync(join(directory, path), "utf8")),
    );
}

/** Measurements from the newest successful main runs of this workflow. */
function mainBaseline(runs = 10): Measurement[] {
  const listed = Bun.spawnSync([
    "gh",
    "run",
    "list",
    "--workflow",
    "world-latency-trend.yml",
    "--branch",
    "main",
    "--event",
    "push",
    "--status",
    "success",
    "--limit",
    String(runs),
    "--json",
    "databaseId",
    "--jq",
    ".[].databaseId",
  ]);
  if (listed.exitCode !== 0) return [];
  const measurements: Measurement[] = [];
  for (const id of listed.stdout.toString().split("\n").filter(Boolean)) {
    const directory = mkdtempSync(join(tmpdir(), "latency-baseline-"));
    try {
      // An expired or missing artifact only shortens the baseline.
      const download = Bun.spawnSync([
        "gh",
        "run",
        "download",
        id,
        "--name",
        "world-latency-trend",
        "--dir",
        directory,
      ]);
      if (download.exitCode === 0)
        measurements.push(...readDirectory(directory));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
  return measurements;
}

if (import.meta.main) {
  const directory = process.argv[2];
  if (!directory)
    throw new Error("Usage: bun scripts/latency-trend.ts <measurements-dir>");
  console.info(trendReport(readDirectory(directory), mainBaseline()));
}
