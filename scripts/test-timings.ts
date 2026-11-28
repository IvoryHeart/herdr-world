import {
  closeSync,
  openSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { acquireCheckSlot, heldEnv, type CheckClass } from "./check-lock";
import { junitFileTimings } from "./ci-unit-timings";

type CaseTime = { file: string; name: string; seconds: number };
/** @internal Individual JUnit case timings, including failed cases. */
export function junitTimes(xml: string): CaseTime[] {
  return [...xml.matchAll(/<testcase\b([^>]*)(?:\/>|>)/g)].map((match) => {
    const attrs = Object.fromEntries(
      [...match[1]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((attr) => [
        attr[1],
        attr[2],
      ]),
    );
    return {
      file: attrs.file || attrs.classname || "unknown",
      name: attrs.name || "unknown",
      seconds: Number(attrs.time || 0),
    };
  });
}

if (import.meta.main) {
  const directory = ".agents/delivery";
  mkdirSync(directory, { recursive: true });
  const selected = process.argv
    .find((arg) => arg.startsWith("--lanes="))
    ?.slice(8)
    .split(",") ?? ["static", "unit", "browser", "quiet", "verification"];
  if (
    selected.some(
      (lane) =>
        !["static", "unit", "browser", "quiet", "verification"].includes(lane),
    )
  )
    throw new Error("Unknown timing lane");
  const report: string[] = [
    "# Local lane timings",
    "",
    `Measured ${new Date().toISOString()}. Each lane runs alone. Loads above 8 require a repeat.`,
    "",
    "| Lane | Wall seconds | Peak KiB | Exit | Load before / after |",
    "| --- | ---: | ---: | ---: | --- |",
  ];
  const details: string[] = [];
  let failed = false;
  let interrupted = 0;
  for (const lane of selected) {
    const load = () => Bun.spawnSync(["uptime"]).stdout.toString().trim();
    const queue = (
      {
        unit: "light",
        browser: "browser",
        quiet: "browser",
        verification: "verification",
      } as Record<string, CheckClass>
    )[lane];
    // Queue time is not lane execution. Admit before starting /usr/bin/time,
    // then pass ownership through the normal nested-runner marker.
    const release = queue
      ? await acquireCheckSlot(queue, { lane: `timings ${lane}` })
      : () => {};
    const before = load();
    const startedAt = Date.now();
    const phasesPath = join(directory, "browser-phases.jsonl");
    const phaseStart = existsSync(phasesPath)
      ? readFileSync(phasesPath, "utf8").length
      : 0;
    const memory = join(directory, `timing-${lane}.txt`);
    const log = join(directory, `timing-${lane}.log`);
    console.info(`[timings] ${lane}: ${before}`);
    const output = openSync(log, "w");
    const child = Bun.spawn(
      [
        "/usr/bin/time",
        "-f",
        "%e %M",
        "-o",
        memory,
        process.execPath,
        "scripts/check-delivery.ts",
        "--full",
        `--lane=${lane}`,
      ],
      {
        stdout: output,
        stderr: output,
        env: {
          ...process.env,
          ...(queue ? heldEnv(queue) : {}),
          ...(lane === "verification" && process.argv.includes("--fresh-models")
            ? { HERDR_VERIFICATION_FRESH: "1" }
            : {}),
        },
      },
    );
    const stop = () => {
      interrupted = 143;
      child.kill("SIGTERM");
    };
    const interrupt = () => {
      interrupted = 130;
      child.kill("SIGTERM");
    };
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", stop);
    let code: number;
    try {
      code = await child.exited;
    } finally {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", stop);
      closeSync(output);
      release();
    }
    const after = load();
    failed ||= code !== 0;
    const [wall, peak] = readFileSync(memory, "utf8")
      .trim()
      .split("\n")
      .at(-1)!
      .split(" ");
    report.push(
      `| ${lane} | ${wall} | ${peak} | ${code} | ${before} / ${after} |`,
    );
    const reports = readdirSync(directory)
      .filter(
        (file) =>
          file.endsWith(".xml") &&
          statSync(join(directory, file)).mtimeMs >= startedAt &&
          (lane === "browser"
            ? file.startsWith("world-browser")
            : file.startsWith(`timing-${lane}`)),
      )
      .map((file) => ({
        file,
        xml: readFileSync(join(directory, file), "utf8"),
      }));
    const cases = reports.flatMap(({ xml }) => junitTimes(xml));
    const files = new Map<string, number>();
    for (const { file, xml } of reports) {
      try {
        for (const [path, seconds] of Object.entries(junitFileTimings(xml)))
          files.set(path, (files.get(path) ?? 0) + seconds);
      } catch {
        details.push(
          `File timings unavailable in ${file}; retain the failed/incomplete report for diagnosis.`,
          "",
        );
      }
    }
    if (lane === "verification") {
      const reused = readFileSync(log, "utf8").includes("Reused all");
      const runs = join(".agents", "verification", "runs");
      const names = existsSync(runs)
        ? readdirSync(runs)
            .filter((name) => name.includes("-parallel-"))
            .sort()
            .reverse()
        : [];
      if (reused)
        details.push(
          "Verification reused complete, byte-identical evidence; model execution: 0 seconds. Tooling and the diagnostic control still run.",
          "",
        );
      else if (names[0]) {
        const manifest = JSON.parse(
          readFileSync(join(runs, names[0], "manifest.json"), "utf8"),
        );
        cases.push(
          ...(manifest.execution?.cases ?? []).map(
            (item: { model: string; elapsedMs: number }) => ({
              file: `quint/${item.model}.qnt`,
              name: item.model,
              seconds: item.elapsedMs / 1000,
            }),
          ),
        );
      }
    }
    if (lane === "verification")
      for (const item of cases)
        files.set(item.file, (files.get(item.file) ?? 0) + item.seconds);
    if (lane === "static") {
      const commands = JSON.parse(
        readFileSync(join(directory, "lanes/results.json"), "utf8"),
      ) as { name: string; seconds: number; code: number }[];
      details.push(
        "## static: slowest commands",
        "",
        "| Command | Seconds | Exit |",
        "| --- | ---: | ---: |",
        ...commands
          .sort((a, b) => b.seconds - a.seconds)
          .slice(0, 10)
          .map(
            (item) =>
              `| ${item.name} | ${item.seconds.toFixed(3)} | ${item.code} |`,
          ),
        "",
      );
    } else
      details.push(
        `## ${lane}: slowest files`,
        "",
        "File execution time includes setup. World case fragments may overlap; their execution times are summed per file.",
        "",
        "| File | Execution seconds |",
        "| --- | ---: |",
        ...[...files]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([file, seconds]) => `| ${file} | ${seconds.toFixed(3)} |`),
        "",
        "Slowest cases:",
        "",
        "| File | Case | Seconds |",
        "| --- | --- | ---: |",
        ...cases
          .sort((a, b) => b.seconds - a.seconds)
          .slice(0, 10)
          .map(
            (item) =>
              `| ${item.file} | ${item.name.replaceAll("|", "\\|")} | ${item.seconds.toFixed(3)} |`,
          ),
        "",
      );
    if (existsSync(phasesPath)) {
      const phases = readFileSync(phasesPath, "utf8").slice(phaseStart).trim();
      if (phases)
        details.push(
          `## ${lane}: browser phases`,
          "",
          "```jsonl",
          phases,
          "```",
          "",
        );
    }
    writeFileSync(
      join(directory, "timings.md"),
      [...report, "", ...details].join("\n") + "\n",
    );
    console.info(`[timings] ${lane}: ${wall}s, ${peak} KiB, exit ${code}`);
    if (interrupted) break;
  }
  writeFileSync(
    join(directory, "timings.md"),
    [...report, "", ...details].join("\n") + "\n",
  );
  process.exitCode = interrupted || (failed ? 1 : 0);
}
