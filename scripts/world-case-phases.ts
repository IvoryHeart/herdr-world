import { existsSync, readFileSync } from "node:fs";

/** One finished browser case, as web/src/world/testing/casePhases.ts writes it. */
type CasePhases = {
  case: string;
  seconds: number;
  phases: [string, number][];
};

/** @internal */
export function parseCasePhases(text: string): CasePhases[] {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as CasePhases);
}

const cell = (text: string) => text.replaceAll("|", "\\|");

/**
 * The job summary table: every case, slowest first, with the seconds of
 * each phase. Columns are the phases in the order the cases name them.
 */
export function casePhasesTable(label: string, cases: CasePhases[]) {
  if (!cases.length) return "";
  const columns: string[] = [];
  for (const item of cases)
    for (const [phase] of item.phases)
      if (!columns.includes(phase)) columns.push(phase);
  const rows = [...cases]
    .sort((a, b) => b.seconds - a.seconds)
    .map((item) => {
      const seconds = new Map<string, number>();
      for (const [phase, value] of item.phases)
        seconds.set(phase, (seconds.get(phase) ?? 0) + value);
      return `| ${cell(item.case)} | ${item.seconds.toFixed(1)} | ${columns
        .map((phase) =>
          seconds.has(phase) ? seconds.get(phase)!.toFixed(1) : "",
        )
        .join(" | ")} |`;
    });
  return [
    `### World case phases (${cell(label)})`,
    "",
    `| Case | Seconds | ${columns.map(cell).join(" | ")} |`,
    `| --- | ---: |${columns.map(() => " ---: |").join("")}`,
    ...rows,
    "",
  ].join("\n");
}

export function readCasePhases(file: string) {
  return existsSync(file) ? parseCasePhases(readFileSync(file, "utf8")) : [];
}
