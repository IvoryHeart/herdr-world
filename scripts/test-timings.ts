import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, loadavg } from "node:os";
import { join, resolve } from "node:path";
import { splitTests, trackedTests } from "./delivery-tests";
import {
  webBrowserPages,
  webBrowserWorkers,
  worldBrowserSuites,
} from "./world-browser-suites";

/**
 * `bun run test:timings`: runs each local lane alone, one after another, and
 * writes `.agents/delivery/timings.md` with each lane's wall time, CPU, peak
 * memory, load, slowest files and cases, and phases (runner milestones with
 * their offsets, including time spent waiting for the machine-wide slot).
 *
 * CPU and peak memory come from the lane's own cgroup when `systemd-run --user`
 * is available: it counts every Chrome process. `/usr/bin/time` alone counts
 * only processes their parents waited for, so it misses most Chrome CPU, and
 * its peak is the largest single process, not the lane.
 *
 * `bun run test:timings -- world web` runs only the named lanes.
 */

type LaneName = "static" | "units" | "world" | "web" | "verification";

/** @internal */
export type Timed = {
  lane: LaneName;
  code: number;
  wallSeconds: number;
  cpuSeconds?: number;
  cpuSource: "cgroup" | "time" | "none";
  peakMiB?: number;
  peakSource: "cgroup" | "largest process" | "none";
  loadBefore: number;
  loadAfter: number;
  phases: { at: number; line: string }[];
  files: { name: string; seconds: number }[];
  cases: { name: string; seconds: number }[];
};

const decode = (value: string) =>
  value
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
const attribute = (tag: string, key: string) =>
  decode(new RegExp(`\\b${key}="([^"]*)"`).exec(tag)?.[1] ?? "");

/**
 * File and case times from Bun JUnit reports. A file's time is its outermost
 * suite's (concurrent cases overlap, so their sum overstates it), summed over
 * reports when a file ran in parts. @internal
 */
export function junitTimes(reports: string[]) {
  const files = new Map<string, number>();
  const cases: { name: string; seconds: number }[] = [];
  const path = (tag: string) => attribute(tag, "file").replace(/^\.\//, "");
  for (const xml of reports) {
    const suites = new Map<string, number>();
    for (const [, tag] of xml.matchAll(/<testsuite\b([^>]*?)>/g))
      if (attribute(tag!, "file"))
        suites.set(
          path(tag!),
          Math.max(
            suites.get(path(tag!)) ?? 0,
            Number(attribute(tag!, "time")) || 0,
          ),
        );
    const summed = new Map<string, number>();
    for (const [, tag] of xml.matchAll(/<testcase\b([^>]*?)\/?>/g)) {
      const file = path(tag!);
      const seconds = Number(attribute(tag!, "time")) || 0;
      summed.set(file, (summed.get(file) ?? 0) + seconds);
      cases.push({ name: `${file} › ${attribute(tag!, "name")}`, seconds });
    }
    for (const [file, seconds] of new Map([...summed, ...suites]))
      files.set(file, (files.get(file) ?? 0) + seconds);
  }
  const slowest = <T extends { seconds: number }>(list: T[]) =>
    list.sort((a, b) => b.seconds - a.seconds).slice(0, 10);
  return {
    files: slowest([...files].map(([name, seconds]) => ({ name, seconds }))),
    cases: slowest(cases),
  };
}

/** Runner milestones worth showing as phases. @internal */
export const PHASE =
  /^\[(?:gate|queue|test-runner|world-test-runner|verification|gpu)\]|Ran \d+ tests? across/;

/** Seconds of CPU from a cgroup `cpu.stat`. @internal */
export const cgroupCpuSeconds = (stat: string) => {
  const usec = /^usage_usec (\d+)$/m.exec(stat)?.[1];
  return usec === undefined ? undefined : Number(usec) / 1e6;
};

function hasUserSystemd() {
  if (process.platform !== "linux") return false;
  const probe = Bun.spawnSync(
    ["systemd-run", "--user", "--scope", "--quiet", "--collect", "true"],
    { stdout: "ignore", stderr: "ignore" },
  );
  return probe.exitCode === 0;
}

// Runs inside the lane's scope, so its own cgroup is the lane's.
const SCOPE_TAIL = `"$@"; code=$?; group=/sys/fs/cgroup$(sed -n 's/^0:://p' /proc/self/cgroup); cat "$group/cpu.stat" > "$TIMINGS_OUT.cpu" 2>/dev/null; cat "$group/memory.peak" > "$TIMINGS_OUT.mem" 2>/dev/null; exit $code`;

async function timeLane(
  root: string,
  dir: string,
  lane: LaneName,
  command: string[],
  reports: () => string[],
  systemd: boolean,
): Promise<Timed> {
  const out = join(dir, lane);
  const gnuTime = existsSync("/usr/bin/time");
  const wrapped = [
    ...(systemd
      ? ["systemd-run", "--user", "--scope", "--quiet", "--collect", "--"]
      : []),
    ...(gnuTime
      ? ["/usr/bin/time", "-f", "%e %M %U %S", "-o", `${out}.time`]
      : []),
    "sh",
    "-c",
    SCOPE_TAIL,
    "sh",
    ...command,
  ];
  const loadBefore = loadavg()[0]!;
  const began = performance.now();
  const phases: Timed["phases"] = [];
  const log = Bun.file(`${out}.log`).writer();
  const child = Bun.spawn(wrapped, {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, TIMINGS_OUT: out },
  });
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    let rest = "";
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      log.write(chunk);
      const lines = (rest + decoder.decode(chunk, { stream: true })).split(
        "\n",
      );
      rest = lines.pop() ?? "";
      for (const line of lines)
        if (PHASE.test(line.trim()))
          phases.push({
            at: (performance.now() - began) / 1000,
            line: line.trim().slice(0, 200),
          });
    }
  };
  await Promise.all([pump(child.stdout), pump(child.stderr)]);
  const code = await child.exited;
  await log.end();
  const wallSeconds = (performance.now() - began) / 1000;
  const read = (suffix: string) => {
    try {
      return readFileSync(`${out}.${suffix}`, "utf8");
    } catch {
      return "";
    }
  };
  const cgroupCpu = cgroupCpuSeconds(read("cpu"));
  const cgroupPeak = Number(read("mem").trim()) || undefined;
  const [, maxKiB, user, system] = read("time").trim().split(/\s+/).map(Number);
  const timeCpu =
    user !== undefined && system !== undefined ? user + system : undefined;
  const { files, cases } = junitTimes(
    reports()
      .filter(existsSync)
      .map((path) => readFileSync(path, "utf8")),
  );
  return {
    lane,
    code,
    wallSeconds,
    cpuSeconds: cgroupCpu ?? timeCpu,
    cpuSource:
      cgroupCpu !== undefined
        ? "cgroup"
        : timeCpu !== undefined
          ? "time"
          : "none",
    peakMiB: cgroupPeak
      ? cgroupPeak / 2 ** 20
      : maxKiB
        ? maxKiB / 1024
        : undefined,
    peakSource: cgroupPeak ? "cgroup" : maxKiB ? "largest process" : "none",
    loadBefore,
    loadAfter: loadavg()[0]!,
    phases,
    files,
    cases,
  };
}

const fixed = (value: number | undefined, digits = 0) =>
  value === undefined ? "—" : value.toFixed(digits);

/** The Markdown report. @internal */
export function timingsReport(results: Timed[], cores: number, at: string) {
  const lines = [
    "# Local lane timings",
    "",
    `${at}; ${cores} cores. Each lane ran alone. CPU and peak memory from the lane's cgroup count Chrome; "time" figures miss most Chrome CPU, and "largest process" is one process's peak. Repeat any lane whose load was above 8.`,
    "",
    "| Lane | Result | Wall s | CPU s | CPU source | Peak MiB | Peak source | Load before | Load after |",
    "| --- | --- | ---: | ---: | --- | ---: | --- | ---: | ---: |",
    ...results.map(
      (r) =>
        `| ${r.lane} | ${r.code === 0 ? "passed" : `failed (${r.code})`} | ${fixed(r.wallSeconds)} | ${fixed(r.cpuSeconds)} | ${r.cpuSource} | ${fixed(r.peakMiB)} | ${r.peakSource} | ${fixed(r.loadBefore, 1)} | ${fixed(r.loadAfter, 1)}${r.loadBefore > 8 || r.loadAfter > 8 ? " (repeat)" : ""} |`,
    ),
  ];
  for (const r of results) {
    lines.push("", `## ${r.lane}`, "");
    if (r.files.length) {
      lines.push("Slowest files:", "", "| Seconds | File |", "| ---: | --- |");
      for (const file of r.files)
        lines.push(`| ${file.seconds.toFixed(1)} | ${file.name} |`);
      lines.push(
        "",
        "Slowest cases:",
        "",
        "| Seconds | Case |",
        "| ---: | --- |",
      );
      for (const item of r.cases)
        lines.push(
          `| ${item.seconds.toFixed(1)} | ${item.name.replaceAll("|", "\\|")} |`,
        );
      lines.push("");
    }
    lines.push("Phases:", "", "| At s | Milestone |", "| ---: | --- |");
    for (const phase of r.phases)
      lines.push(
        `| ${phase.at.toFixed(1)} | ${phase.line.replaceAll("|", "\\|")} |`,
      );
    lines.push(`| ${r.wallSeconds.toFixed(1)} | lane finished |`);
  }
  return `${lines.join("\n")}\n`;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const dir = join(root, ".agents/delivery/timings");
  mkdirSync(dir, { recursive: true });
  const { unit, chrome } = splitTests(root, trackedTests(root));
  const xml = (name: string) => join(dir, `${name}.xml`);
  const delivery = join(root, ".agents/delivery");
  const worldXml = () =>
    readdirSync(delivery)
      .filter((name) => /^world-timings.*\.xml$/.test(name))
      .map((name) => join(delivery, name));
  for (const path of worldXml()) rmSync(path);
  const lanes: Record<
    LaneName,
    { command: string[]; reports: () => string[] }
  > = {
    static: {
      command: ["bun", "scripts/check-delivery.ts", "--static"],
      reports: () => [],
    },
    units: {
      command: [
        "bun",
        "scripts/run-tests.ts",
        ...unit,
        "--reporter=junit",
        `--reporter-outfile=${xml("units")}`,
      ],
      reports: () => [xml("units")],
    },
    world: {
      command: [
        "env",
        "HERDR_WORLD_TEST_LABEL=timings",
        "bun",
        "scripts/run-world-tests.ts",
        ...worldBrowserSuites,
      ],
      reports: worldXml,
    },
    web: {
      command: [
        "bun",
        "scripts/run-tests.ts",
        ...chrome,
        `--parallel=${webBrowserWorkers()}`,
        `--max-concurrency=${webBrowserPages(Math.min(webBrowserWorkers(), chrome.length))}`,
        "--reporter=junit",
        `--reporter-outfile=${xml("web")}`,
      ],
      reports: () => [xml("web")],
    },
    verification: {
      command: ["bun", "scripts/verification-reuse.ts"],
      reports: () => [],
    },
  };
  const asked = process.argv.slice(2) as LaneName[];
  for (const name of asked)
    if (!(name in lanes))
      throw new Error(
        `Unknown lane ${name}; lanes: ${Object.keys(lanes).join(", ")}`,
      );
  const systemd = hasUserSystemd();
  const results: Timed[] = [];
  for (const name of asked.length
    ? asked
    : (Object.keys(lanes) as LaneName[])) {
    console.info(`[timings] ${name}…`);
    const result = await timeLane(
      root,
      dir,
      name,
      lanes[name].command,
      lanes[name].reports,
      systemd,
    );
    console.info(
      `[timings] ${name}: ${result.code === 0 ? "passed" : `failed (${result.code})`} in ${result.wallSeconds.toFixed(0)} s, CPU ${fixed(result.cpuSeconds)} s (${result.cpuSource}); log ${dir}/${name}.log`,
    );
    results.push(result);
  }
  const report = join(root, ".agents/delivery/timings.md");
  writeFileSync(
    report,
    timingsReport(results, availableParallelism(), new Date().toISOString()),
  );
  console.info(`[timings] wrote ${report}`);
  process.exitCode = results.some((result) => result.code !== 0) ? 1 : 0;
}
