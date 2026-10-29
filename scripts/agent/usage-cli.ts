import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  inferredWindows,
  canonicalReviewer,
  renderComment,
  renderTable,
  validateWindow,
  type Role,
  type Window,
} from "./usage-attribution";
import {
  discoverSeats,
  resolveLogs,
  type Family,
  type Seat,
} from "./usage-records";
import { postComment, prMetadata, run, type Runner } from "./usage-github";
import { UsageStore, type Assignment } from "./usage-store";
import { assessRoster, readRoster, renderRosterTable } from "./usage-roster";

type Options = {
  command: string;
  pr: number | null;
  sessions: string[];
  seat?: string;
  family?: Family;
  role?: Role;
  from?: string;
  until?: string;
  json: boolean;
  post: boolean;
  roots: Record<Family, string>;
  store?: string;
  config?: string;
};
export function parsePrOptions(args: string[]): Options {
  const [command, rawPr] = args;
  const rosterMode = command === "roster-check";
  if (
    (!rosterMode && !["pr", "comment", "assign"].includes(command ?? "")) ||
    (!rosterMode && !/^[1-9]\d*$/.test(rawPr ?? ""))
  ) {
    throw new Error(
      "Usage: agent:usage pr|comment|assign N [options], or roster-check [--pr N] [--config PATH] [--json]",
    );
  }
  const options: Options = {
    command: command!,
    pr: rosterMode ? null : Number(rawPr),
    sessions: [],
    json: false,
    post: false,
    roots: {
      codex: join(
        process.env.CODEX_HOME ?? join(homedir(), ".codex"),
        "sessions",
      ),
      claude: join(homedir(), ".claude", "projects"),
    },
  };
  for (let index = rosterMode ? 1 : 2; index < args.length; index++) {
    const flag = args[index]!;
    if (flag === "--") continue;
    if (flag === "--json") {
      options.json = true;
      continue;
    }
    if (flag === "--post") {
      options.post = true;
      continue;
    }
    if (
      ![
        "--session",
        "--seat",
        "--family",
        "--role",
        "--from",
        "--until",
        "--sessions-dir",
        "--claude-dir",
        "--store",
        "--config",
        "--pr",
      ].includes(flag)
    )
      throw new Error(`Unknown argument: ${flag}`);
    const value = args[++index];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${flag}`);
    if (flag === "--pr") {
      if (!rosterMode || !/^[1-9]\d*$/.test(value))
        throw new Error("--pr requires a PR number on roster-check");
      options.pr = Number(value);
    }
    if (flag === "--config") options.config = resolve(value);
    if (flag === "--session") options.sessions.push(value);
    if (flag === "--seat") options.seat = value;
    if (flag === "--family") {
      if (value !== "codex" && value !== "claude")
        throw new Error("--family must be codex or claude");
      options.family = value;
    }
    if (flag === "--role") options.role = value as Role;
    if (flag === "--from" || flag === "--until") {
      if (
        !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
        !Number.isFinite(Date.parse(value))
      )
        throw new Error("Use ISO timestamps for attribution boundaries");
      options[flag === "--from" ? "from" : "until"] = new Date(
        value,
      ).toISOString();
    }
    if (flag === "--sessions-dir") options.roots.codex = resolve(value);
    if (flag === "--claude-dir") options.roots.claude = resolve(value);
    if (flag === "--store") options.store = resolve(value);
  }
  if (options.pr !== null && !Number.isSafeInteger(options.pr))
    throw new Error("Invalid PR number");
  if (options.post && options.command !== "comment")
    throw new Error("--post is only valid for comment");
  if (
    options.command === "assign" &&
    (!options.seat || !options.role || !options.from || !options.until)
  )
    throw new Error(
      "assign requires --seat, --role, --from (assignment) and --until (last push)",
    );
  if (options.from && options.until && options.from >= options.until)
    throw new Error("--from must precede --until");
  if (
    options.command !== "assign" &&
    (options.role || options.from || options.until)
  )
    throw new Error("Register boundaries with assign before reporting");
  return options;
}

async function defaultStore(runner: Runner = run) {
  const common = (
    await runner([
      "git",
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ])
  ).trim();
  return join(dirname(common), ".agents", "crew-gate", "usage.sqlite");
}
export function uniqueSeats(seats: Seat[]) {
  const result = new Map<string, Seat>();
  for (const seat of seats) {
    const key = `${seat.family}:${seat.session}`;
    const prior = result.get(key);
    if (
      prior &&
      prior.seat !== seat.seat &&
      prior.seat !== "unknown" &&
      seat.seat !== "unknown"
    )
      throw new Error(
        "One session maps to multiple seats; resolve local seat ownership first",
      );
    result.set(
      key,
      prior && prior.seat !== "unknown" && seat.seat === "unknown"
        ? prior
        : seat,
    );
  }
  return [...result.values()];
}
export function prMissingCount(
  pr: number,
  unavailable: Seat[],
  windows: Window[],
  assignments: Assignment[],
  claims: { seat: Seat; prs: number[] }[] = [],
) {
  const relevant = [...windows, ...assignments].filter((w) => w.pr === pr);
  return new Set(
    unavailable
      .filter(
        (s) =>
          relevant.some((w) => w.session === s.session && w.seat === s.seat) ||
          claims.some(
            (claim) =>
              claim.seat.session === s.session &&
              claim.seat.seat === s.seat &&
              claim.prs.includes(pr),
          ),
      )
      .map((s) => `${s.family}:${s.session}`),
  ).size;
}
type UsageIO = {
  run?: Runner;
  log?: (message: string) => void;
  warn?: (message: string) => void;
};
export async function prUsageMain(
  args: string[],
  io: UsageIO = {},
): Promise<number> {
  const runner = io.run ?? run,
    output = io.log ?? console.log,
    warn = io.warn ?? console.error;
  const options = parsePrOptions(args);
  const defaultPath = await defaultStore(runner);
  const store = new UsageStore(options.store ?? defaultPath);
  try {
    let discovered: Seat[] = [];
    try {
      discovered = discoverSeats(
        JSON.parse(await runner(["herdr", "agent", "list"])),
      );
    } catch {
      warn("Herdr discovery unavailable; using registered sessions only.");
    }
    let seats = uniqueSeats([...store.sessions(), ...discovered]);
    for (const session of options.sessions) {
      const existing = seats.find(
        (s) => s.session === session || s.path === session,
      );
      if (!existing && (!options.family || !options.seat))
        throw new Error(
          "An undiscovered --session requires --family and --seat",
        );
      if (!existing)
        seats.push({ session, seat: options.seat!, family: options.family! });
    }
    seats = uniqueSeats(seats);
    if (options.command === "assign") {
      const matching = seats.filter(
        (s) =>
          s.seat === options.seat &&
          (!options.sessions.length ||
            options.sessions.includes(s.session) ||
            options.sessions.includes(s.path ?? "")),
      );
      if (matching.length !== 1)
        throw new Error(
          "Assignment must select one session; pass --session explicitly",
        );
      const seat = matching[0]!;
      const assignment = {
        pr: options.pr!,
        seat: seat.seat,
        session: seat.session,
        role: options.role!,
        from: options.from!,
        until: options.until!,
      };
      validateWindow({ ...assignment, source: "assignment" });
      store.assign(assignment, seat);
      output(
        `Registered ${options.role} assignment for PR #${options.pr}; detailed boundaries remain local.`,
      );
      return 0;
    }
    if (!seats.length)
      throw new Error(
        "No sessions discovered; pass --session, --seat and --family",
      );
    const roster = await readRoster(
      options.config ?? join(dirname(defaultPath), "config.json"),
      options.config === undefined,
    );
    const unavailable: Seat[] = [];
    const loaded = await resolveLogs(seats, options.roots, (seat) => {
      unavailable.push(seat);
      if (
        options.sessions.includes(seat.session) ||
        options.sessions.includes(seat.path ?? "")
      )
        throw new Error(
          "An explicitly requested session could not be read; local accounting was not refreshed",
        );
    });
    unavailable.push(
      ...loaded
        .filter((r) => r.parsed.incompleteRecords > 0)
        .map((r) => r.seat),
    );
    const sessions = loaded.map((r) => ({
      seat: r.seat,
      events: r.parsed.events,
      gaps: r.parsed.gaps,
      claimedPrs: r.parsed.claimedPrs,
    }));
    if (options.command === "roster-check" && options.pr === null) {
      store.refresh(null, sessions, [], 0);
      const report = assessRoster(store.rows(), roster);
      output(
        options.json
          ? JSON.stringify(
              {
                scope: "retained session history",
                incompleteSessions: unavailable.length,
                ...report,
                clean: report.clean && unavailable.length === 0,
              },
              null,
              2,
            )
          : renderRosterTable(report, undefined, unavailable.length),
      );
      return report.clean && unavailable.length === 0 ? 0 : 2;
    }
    const pr = options.pr!;
    const repo = (
      await runner([
        "gh",
        "repo",
        "view",
        "--json",
        "nameWithOwner",
        "--jq",
        ".nameWithOwner",
      ])
    ).trim();
    const metadata = await prMetadata(repo, pr, runner);
    const now = new Date().toISOString();
    const windows: Window[] = [];
    for (const result of loaded)
      windows.push(
        ...inferredWindows(
          result.seat,
          result.parsed.turns,
          pr,
          metadata.reviews,
          metadata.mergedAt ?? now,
        ),
      );
    for (const assignment of store.assignments().filter((a) => a.pr === pr)) {
      if (assignment.until && assignment.until > assignment.from)
        windows.push({ ...assignment, source: "assignment" });
      else
        warn(
          "An assignment has no usable last-push boundary; register --until to attribute its usage.",
        );
    }
    const validReviews = new Set(
      metadata.reviews.flatMap((r) => {
        const seat = canonicalReviewer(r.body, pr);
        return seat
          ? [JSON.stringify([seat, new Date(r.submittedAt).toISOString()])]
          : [];
      }),
    );
    const retainedWindows = store
      .windows(pr)
      .filter(
        (w) =>
          w.source !== "review" ||
          validReviews.has(JSON.stringify([w.seat, w.until])),
      );
    const missing = prMissingCount(
      pr,
      unavailable,
      [...retainedWindows, ...windows],
      store.assignments(),
      [
        ...store
          .sessions()
          .map((seat) => ({ seat, prs: seat.claimedPrs ?? [] })),
        ...loaded.map((r) => ({ seat: r.seat, prs: r.parsed.claimedPrs })),
      ],
    );
    store.refresh(pr, sessions, windows, missing, validReviews);
    const rows = store.rows();
    if (options.command === "roster-check") {
      const report = assessRoster(rows, roster, pr);
      output(
        options.json
          ? JSON.stringify(
              {
                pr,
                incompleteSessions: missing,
                ...report,
                clean: report.clean && missing === 0,
              },
              null,
              2,
            )
          : renderRosterTable(report, pr, missing),
      );
      return report.clean && missing === 0 ? 0 : 2;
    } else if (options.command === "comment") {
      const comment = renderComment(pr, rows, missing, roster);
      if (options.post)
        output(
          `Usage comment ${await store.publish(() => postComment(repo, pr, renderComment(pr, store.rows(), store.missing(pr), roster), runner))} for PR #${pr}.`,
        );
      else output(comment);
    } else if (options.json)
      output(
        JSON.stringify(
          {
            pr,
            missingSessions: missing,
            rows: rows.filter((r) => r.pr === pr || r.pr === null),
          },
          null,
          2,
        ),
      );
    else output(renderTable(pr, rows));
    return 0;
  } finally {
    store.close();
  }
}
