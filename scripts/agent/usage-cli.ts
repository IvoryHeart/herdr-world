import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  inferredWindows,
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
import { postComment, prMetadata, run } from "./usage-github";
import { UsageStore } from "./usage-store";

type Options = {
  command: string;
  pr: number;
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
};
export function parsePrOptions(args: string[]): Options {
  const [command, rawPr] = args;
  if (
    !["pr", "comment", "assign"].includes(command ?? "") ||
    !/^[1-9]\d*$/.test(rawPr ?? "")
  )
    throw new Error(
      "Usage: agent:usage pr|comment|assign N [--session ID|PATH] [--seat NAME] [--family codex|claude] [--from ISO --until ISO] [--json|--post]",
    );
  const options: Options = {
    command: command!,
    pr: Number(rawPr),
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
  for (let index = 2; index < args.length; index++) {
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
      ].includes(flag)
    )
      throw new Error(`Unknown argument: ${flag}`);
    const value = args[++index];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${flag}`);
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
  if (!Number.isSafeInteger(options.pr)) throw new Error("Invalid PR number");
  if (options.post && options.command !== "comment")
    throw new Error("--post is only valid for comment");
  if (
    options.command === "assign" &&
    (!options.seat || !options.role || !options.from)
  )
    throw new Error(
      "assign requires --seat, --role and --from (assignment timestamp)",
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

async function defaultStore() {
  const common = (
    await run([
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
export async function prUsageMain(args: string[]) {
  const options = parsePrOptions(args);
  const store = new UsageStore(options.store ?? (await defaultStore()));
  try {
    let discovered: Seat[] = [];
    try {
      discovered = discoverSeats(
        JSON.parse(await run(["herdr", "agent", "list"])),
      );
    } catch {
      console.error(
        "Herdr discovery unavailable; using registered sessions only.",
      );
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
      validateWindow({
        pr: options.pr,
        seat: seat.seat,
        session: seat.session,
        role: options.role!,
        from: options.from!,
        until: options.until ?? "9999-12-31T23:59:59.999Z",
        source: "assignment",
      });
      store.assign(
        {
          pr: options.pr,
          seat: seat.seat,
          session: seat.session,
          role: options.role!,
          from: options.from!,
          until: options.until,
        },
        seat,
      );
      console.log(
        `Registered ${options.role} assignment for PR #${options.pr}; detailed boundaries remain local.`,
      );
      return;
    }
    if (!seats.length)
      throw new Error(
        "No sessions discovered; pass --session, --seat and --family",
      );
    const repo = (
      await run([
        "gh",
        "repo",
        "view",
        "--json",
        "nameWithOwner",
        "--jq",
        ".nameWithOwner",
      ])
    ).trim();
    const metadata = await prMetadata(repo, options.pr);
    const now = new Date().toISOString();
    const windows: Window[] = [];
    let missing = 0;
    const loaded = await resolveLogs(seats, options.roots, (seat) => {
      missing++;
      if (
        options.sessions.includes(seat.session) ||
        options.sessions.includes(seat.path ?? "")
      )
        throw new Error(
          "An explicitly requested session could not be read; local accounting was not refreshed",
        );
    });
    for (const result of loaded) {
      windows.push(
        ...inferredWindows(
          result.seat,
          result.parsed.turns,
          options.pr,
          metadata.reviews,
          metadata.mergedAt ?? now,
        ),
      );
    }
    for (const assignment of store
      .assignments()
      .filter((a) => a.pr === options.pr)) {
      const until = assignment.until ?? metadata.pushedAt;
      if (until && until > assignment.from)
        windows.push({ ...assignment, until, source: "assignment" });
      else
        console.error(
          "An assignment has no usable last-push boundary; register --until to attribute its usage.",
        );
    }
    store.refresh(
      options.pr,
      loaded.map((r) => ({ seat: r.seat, events: r.parsed.events })),
      windows,
      missing,
    );
    const rows = store.rows();
    if (options.command === "comment") {
      const comment = renderComment(options.pr, rows, missing);
      if (options.post)
        console.log(
          `Usage comment ${await store.publish(() => postComment(repo, options.pr, renderComment(options.pr, store.rows(), store.missing(options.pr))))} for PR #${options.pr}.`,
        );
      else console.log(comment);
    } else if (options.json) {
      console.log(
        JSON.stringify(
          {
            pr: options.pr,
            missingSessions: missing,
            rows: rows.filter((r) => r.pr === options.pr || r.pr === null),
          },
          null,
          2,
        ),
      );
    } else console.log(renderTable(options.pr, rows));
  } finally {
    store.close();
  }
}
