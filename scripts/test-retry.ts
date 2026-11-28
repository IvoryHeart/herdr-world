import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";

/** @internal */
export type TestCase = { file: string; name: string };
/** @internal */
export type FlakeReport = {
  files: string[];
  flaky: TestCase[];
  retried?: TestCase[];
};
type CaseResult = TestCase & { status: "pass" | "fail" | "skip" };
const decode = (value: string) =>
  value.replace(
    /&(#x[\da-f]+|#\d+|quot|apos|lt|gt|amp);/gi,
    (_, key: string) => {
      if (key.startsWith("#x"))
        return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
      if (key.startsWith("#"))
        return String.fromCodePoint(Number(key.slice(1)));
      return (
        { quot: '"', apos: "'", lt: "<", gt: ">", amp: "&" } as Record<
          string,
          string
        >
      )[key]!;
    },
  );
const attribute = (xml: string, key: string) =>
  decode(new RegExp(`\\b${key}="([^"]*)"`).exec(xml)?.[1] || "");

/** Parse Bun's JUnit format, requiring a complete report and named file/case evidence. @internal */
export function parseJUnit(xml: string): CaseResult[] {
  assert(
    xml.trimEnd().endsWith("</testsuites>"),
    "Missing complete JUnit report",
  );
  const cases: CaseResult[] = [];
  for (const match of xml.matchAll(
    /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g,
  )) {
    const file = attribute(match[1]!, "file")
      .replaceAll("\\", "/")
      .replace(/^\.\//, "");
    // Bun 1.4.4 emits nested describe labels innermost first, separated by >.
    // Its test-name filter matches the outermost-first labels joined by spaces.
    const parents = attribute(match[1]!, "classname")
      .split(" > ")
      .reverse()
      .join(" ");
    const name = [parents, attribute(match[1]!, "name")]
      .filter(Boolean)
      .join(" ");
    assert(file && name, "JUnit case missing file/name");
    const content = match[2] || "";
    cases.push({
      file,
      name,
      status: /<(?:failure|error)\b/.test(content)
        ? "fail"
        : /<skipped\b/.test(content)
          ? "skip"
          : "pass",
    });
  }
  return cases;
}

const escaped = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One initial batch, then only failed files (unit) or exact cases (browser). */
export async function retryTests(options: {
  kind: "unit" | "browser";
  report: string;
  junit: string;
  command: string[];
  run: (command: string[]) => Promise<number>;
  healthy: () => boolean;
}): Promise<number> {
  const namedFiles = options.command
    .filter((arg) =>
      /^(?:\.\/)?(?:scripts|web|server|shared|quint|tools|verification)\/.+\.test\.[cm]?[jt]sx?$/.test(
        arg,
      ),
    )
    .map((file) => file.replace(/^\.\//, ""));
  const evidence: FlakeReport = { files: namedFiles, flaky: [], retried: [] };
  const save = () => writeFileSync(options.report, JSON.stringify(evidence));
  // A reused workspace must not recover from a previous process's report.
  rmSync(options.junit, { force: true });
  save();
  const code = await options.run(options.command);
  if (!options.healthy()) return 1;
  let cases: CaseResult[];
  try {
    cases = parseJUnit(readFileSync(options.junit, "utf8"));
  } catch {
    // Bun emits no JUnit when a selected platform-only file defines no cases.
    // Its successful initial exit needs no recovery proof. A failed process
    // still requires positive case evidence before any retry can recover it.
    return code;
  }
  evidence.files = [
    ...new Set([...namedFiles, ...cases.map((item) => item.file)]),
  ];
  save();
  if (!options.healthy()) return 1;
  if (code === 0) return 0;
  if (code !== 1) return code;
  const failed = cases.filter((item) => item.status === "fail");
  if (!failed.length) return code;
  if (
    options.kind === "browser" &&
    failed.some(
      (item) =>
        cases.filter(
          (other) => other.file === item.file && other.name === item.name,
        ).length !== 1,
    )
  )
    return code;
  // A loader/hook error or an interrupted process is not a recovered assertion.
  const totals =
    /<testsuites\b([^>]*)>/.exec(readFileSync(options.junit, "utf8"))?.[1] ||
    "";
  if (
    Number(attribute(totals, "failures")) !== failed.length ||
    Number(attribute(totals, "errors")) > 0
  )
    return code;
  const groups =
    options.kind === "unit"
      ? [...new Set(failed.map((item) => item.file))].map((file) =>
          failed.filter((item) => item.file === file),
        )
      : failed.map((item) => [item]);
  // CI supplies only =value options and named paths. Retain Bun/preload flags;
  // replace file filters, sharding, case filtering and output/timing destinations.
  const testIndex = options.command.indexOf("test");
  const preloadIndex = options.command.indexOf("--preload");
  const prefixEnd = preloadIndex >= 0 ? preloadIndex + 2 : testIndex + 1;
  const flags = options.command
    .slice(prefixEnd)
    .filter(
      (arg) =>
        arg.startsWith("--") &&
        !/^--(?:reporter|reporter-outfile|timings|update-timings|shard|test-name-pattern|bail|retry|rerun-each)(?:=|$)/.test(
          arg,
        ),
    );
  let result = 0;
  for (const [index, group] of groups.entries()) {
    const file = group[0]!.file;
    assert(
      !file.startsWith("/") &&
        !file.split("/").some((part) => part === ".." || !part),
      "Invalid retry file",
    );
    const junit = `${options.junit}.retry-${index}.xml`;
    rmSync(junit, { force: true });
    console.info(
      `[test-runner] retry once: ${file}${options.kind === "browser" ? ` — ${group[0]!.name}` : ""}`,
    );
    evidence.retried!.push(...group.map(({ file, name }) => ({ file, name })));
    save();
    const retryCode = await options.run([
      ...options.command.slice(0, prefixEnd),
      `./${file}`,
      ...flags,
      ...(options.kind === "browser"
        ? [`--test-name-pattern=^${escaped(group[0]!.name)}$`]
        : []),
      "--reporter=junit",
      `--reporter-outfile=${junit}`,
    ]);
    if (!options.healthy()) return 1;
    let retried: CaseResult[] = [];
    try {
      retried = parseJUnit(readFileSync(junit, "utf8"));
    } catch {
      result = 1;
    }
    for (const item of group) {
      const same = retried.filter(
        (test) => test.file === item.file && test.name === item.name,
      );
      // Duplicate full names cannot prove which case recovered.
      if (same.length === 1 && same[0]!.status === "pass")
        evidence.flaky.push({ file: item.file, name: item.name });
      else result = 1;
    }
    if (retryCode !== 0) result = retryCode || 1;
    save();
  }
  return result;
}
