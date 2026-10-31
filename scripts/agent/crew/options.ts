import type { Options } from "./review";

export const USAGE = `Usage: bun run agent:crew -- <command> [options]

  pass [--pr N]... [--dry-run]   One pass: read, plan, act; --dry-run only prints the plan
  watch [--interval SECONDS] [--busy-interval SECONDS]
                                 A pass over every PR every interval (default 300) and,
                                 between them, over busy PRs every busy interval (default 60)
  status [--hours N]             Held PRs, open actions, recent reviewer runs, reviewer tokens
                                 per PR, pod and track over the last N hours (default 24),
                                 seats missing from the roster and a watcher on old code
  seat start SEAT                Start a roster seat in a new Herdr tab on exactly its roster
                                 harness, model, effort and persona
  feed [--lines N]               The last lines of the crew feed (default 40)
  runs [--pr N] [--lines N]      Reviewer runs: round, RESULT, tokens and how to reopen each
  open --run ID | --pr N --reviewer NAME [--round K]
                                 Reopen a reviewer's session as a chat in a new Herdr tab
  review --pr N --reviewer NAME --head SHA [--since SHA] [--author SEAT] [--run ID]
                                 Run one fresh reviewer now (the watcher starts these itself)
  evaluate|process --pr N --reviewer NAME --head SHA --evaluation K --run ID
                                 Run the checkpoint's fresh evaluator or no-go process
  fix --pr N --author SEAT --head SHA --run ID
                                 Run a fresh fixer for a busy author (the watcher starts these)
  fixed --run ID                 A fixer is done, pushed or not: free its slot and the PR's steps

Settings live under "crew" in the gate config (.agents/crew-gate/config.json).`;

export function parseOptions(argv: string[]): Options {
  const options: Options = {
    command: "",
    prs: [],
    dryRun: false,
    interval: 300,
    busyInterval: 60,
    lines: 40,
    args: [],
    hours: 24,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    const value = () => {
      const next = argv[++index];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    const count = (label: string) => {
      const parsed = Number(value().replace(/^#/u, ""));
      if (!Number.isSafeInteger(parsed) || parsed < 0)
        throw new Error(`${label} needs a number`);
      return parsed;
    };
    if (arg === "--pr") options.prs.push(count("--pr"));
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--interval") options.interval = count("--interval");
    else if (arg === "--busy-interval") {
      // Zero would read the busy PRs back to back, and GitHub's rate limit
      // with them, for as long as one stays busy.
      options.busyInterval = count("--busy-interval");
      if (options.busyInterval < 1)
        throw new Error("--busy-interval needs at least 1 second");
    } else if (arg === "--lines") options.lines = count("--lines");
    else if (arg === "--reviewer") options.reviewer = value();
    else if (arg === "--head") options.head = value();
    else if (arg === "--since") options.since = value();
    else if (arg === "--author") options.author = value();
    else if (arg === "--evaluation") options.evaluation = count("--evaluation");
    else if (arg === "--run") options.run = count("--run");
    else if (arg === "--round")
      options.round = Number(value().replace(/^r/u, "")) || 0;
    else if (arg === "--hours") options.hours = count("--hours");
    else if (
      arg.startsWith("--") ||
      (options.command && options.command !== "seat")
    )
      throw new Error(`Unknown argument ${arg}\n\n${USAGE}`);
    else if (options.command) options.args.push(arg);
    else options.command = arg;
  }
  if (!options.command) throw new Error(USAGE);
  return options;
}
