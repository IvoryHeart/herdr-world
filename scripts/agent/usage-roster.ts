import type { Row } from "./usage-attribution";
import { publicModel } from "./usage-public";

export type Expectation = { model: string; effort?: string };
export type Roster = Record<string, Expectation>;
export type RosterCheck = Omit<
  Row,
  "session" | "input" | "cacheRead" | "cacheWrite" | "output" | "estimate"
> & {
  expected?: Expectation;
  status: "match" | "drift" | "unknown" | "unconfigured";
};
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export function parseRoster(config: unknown): Roster {
  if (!object(config)) throw new Error("Invalid roster configuration");
  if (!Object.hasOwn(config, "roster")) return {};
  if (!object(config.roster)) throw new Error("Invalid roster map");
  const roster: Roster = {};
  for (const [seat, value] of Object.entries(config.roster)) {
    if (
      !/^[a-z][a-z0-9_-]*$/.test(seat) ||
      !object(value) ||
      typeof value.model !== "string" ||
      !value.model.trim() ||
      (value.effort !== undefined &&
        (typeof value.effort !== "string" || !value.effort.trim()))
    )
      throw new Error("Invalid roster seat expectation");
    roster[seat] = {
      model: value.model,
      ...(typeof value.effort === "string" ? { effort: value.effort } : {}),
    };
  }
  return roster;
}
export async function readRoster(
  path: string,
  optional = false,
): Promise<Roster> {
  try {
    return parseRoster(await Bun.file(path).json());
  } catch (error) {
    if (optional && (error as { code?: string }).code === "ENOENT") return {};
    throw new Error("Could not read a valid roster configuration", {
      cause: error,
    });
  }
}
export function assessRoster(rows: Row[], roster: Roster, pr?: number) {
  const selected = rows.filter((r) => pr === undefined || r.pr === pr);
  const checks: RosterCheck[] = selected.map((row) => {
    const expected = Object.hasOwn(roster, row.seat)
      ? roster[row.seat]
      : undefined;
    const status: RosterCheck["status"] = !expected
      ? "unconfigured"
      : !row.model || row.model === "unknown"
        ? "unknown"
        : row.model !== expected.model
          ? "drift"
          : expected.effort !== undefined &&
              (!row.effort || row.effort === "unknown")
            ? "unknown"
            : expected.effort !== undefined && row.effort !== expected.effort
              ? "drift"
              : "match";
    return {
      pr: row.pr,
      role: row.role,
      seat: row.seat,
      family: row.family,
      model: row.model,
      effort: row.effort,
      from: row.from,
      until: row.until,
      responses: row.responses,
      expected,
      status,
    };
  });
  const count = (status: RosterCheck["status"]) =>
    checks
      .filter((c) => c.status === status)
      .reduce((n, c) => n + c.responses, 0);
  return {
    clean: checks.length > 0 && checks.every((c) => c.status === "match"),
    checkedResponses: checks.reduce((n, c) => n + c.responses, 0),
    driftResponses: count("drift"),
    unknownResponses: count("unknown"),
    unconfiguredResponses: count("unconfigured"),
    checks,
  };
}
export function rosterNotes(rows: Row[], roster: Roster, pr: number): string[] {
  const report = assessRoster(rows, roster, pr);
  const names = (checks: RosterCheck[]) =>
    [
      ...new Set(
        checks.map((c) => {
          const actual = publicModel(c.model, c.family);
          const expected = c.expected
            ? publicModel(
                c.expected.model,
                c.expected.model.startsWith("claude-") ? "claude" : "codex",
              )
            : undefined;
          return expected && expected !== actual
            ? `${expected} → ${actual}`
            : actual;
        }),
      ),
    ]
      .sort()
      .join(", ");
  const notes: string[] = [];
  const drift = report.checks.filter((c) => c.status === "drift");
  const unknown = report.checks.filter((c) => c.status === "unknown");
  const unconfigured = report.checks.filter((c) => c.status === "unconfigured");
  if (drift.length)
    notes.push(
      `Model/effort drift detected in attributed responses: ${names(drift)}.`,
    );
  if (unknown.length)
    notes.push(
      `Model/effort measurement incomplete for attributed responses: ${names(unknown)}.`,
    );
  if (unconfigured.length)
    notes.push(
      `Roster expectations missing for attributed responses using: ${names(unconfigured)}.`,
    );
  return notes;
}
export function renderRosterTable(
  report: ReturnType<typeof assessRoster>,
  pr?: number,
  incompleteSessions = 0,
) {
  return [
    `Recorded roster check (${pr ? `PR #${pr}` : "retained session history"}); this reports recorded responses, not live harness settings.`,
    `Measurement: ${incompleteSessions ? "partial" : "complete"}; incomplete sessions: ${incompleteSessions}.`,
    "status\tseat\texpected model/effort\trecorded model/effort\tresponses\twindow [from, until)",
    ...report.checks.map((c) =>
      [
        c.status,
        c.seat,
        c.expected
          ? `${c.expected.model}/${c.expected.effort ?? "not specified"}`
          : "not configured",
        `${c.model}/${c.effort}`,
        c.responses,
        `${c.from} / ${c.until}`,
      ].join("\t"),
    ),
    `Responses: ${report.checkedResponses}; drift: ${report.driftResponses}; unknown: ${report.unknownResponses}; unconfigured: ${report.unconfiguredResponses}.`,
    ...(report.checkedResponses === 0
      ? ["No recorded responses in the selected scope."]
      : []),
  ].join("\n");
}
