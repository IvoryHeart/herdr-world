import type { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { shortSha } from "../../shared/pullRequests";
import { observe, runProcess, type Run } from "./gate/observe";
import {
  evaluate,
  type GateConfig,
  type GateInput,
  type Verdict,
  type VerdictState,
} from "./gate/predicate";
import {
  activeHold,
  addDecision,
  configHash,
  latestInput,
  latestPass,
  latestVerdict,
  openStore,
  passConfig,
  passInputs,
  recordPass,
  transitions,
  verdictDigest,
  verdictsAt,
  waivedSources,
} from "./gate/store";

/**
 * agent:gate, a report-only READY reconciler for the crew's pull requests.
 * It reads GitHub and git, records what it saw and what it concluded, and
 * prints. It never writes to GitHub, prompts an agent or merges.
 */

const USAGE = `Usage: bun run agent:gate -- <command> [options]

  pass [--pr N]...          Read GitHub and git, record verdicts, print one line per PR
  explain N                 The latest receipt for #N, with evidence and who decides
  merge-line N              Re-read #N; print the owner's merge command only if READY (exit 2 otherwise)
  check-claim N SHA         Re-read #N; check a crew "READY #N" claim against its head (exit 2 unless READY)
  hold N --reason TEXT      Hold #N across heads until released
  release N                 Release a hold
  waive N SOURCE --reason   Resolve an unattributed RESULT post by its source ID (see explain)
  diff [--since PASS]       Verdict changes since a pass (default: the latest pass's changes)
  replay DIR | --pass ID    Re-run fixture files, or a recorded pass with its own config

Options: --db PATH, --config PATH, --json, --actor NAME`;

type Options = {
  command: string;
  args: string[];
  prs: number[];
  db?: string;
  config?: string;
  json: boolean;
  reason?: string;
  actor: string;
  since?: number;
  pass?: number;
};

export function parseOptions(argv: string[]): Options {
  const options: Options = {
    command: "",
    args: [],
    prs: [],
    json: false,
    actor: "unknown",
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    const value = () => {
      const next = argv[++index];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === "--pr") options.prs.push(number(value(), "--pr"));
    else if (arg === "--db") options.db = value();
    else if (arg === "--config") options.config = value();
    else if (arg === "--json") options.json = true;
    else if (arg === "--reason") options.reason = value();
    else if (arg === "--actor") options.actor = value();
    else if (arg === "--since") options.since = number(value(), "--since");
    else if (arg === "--pass") options.pass = number(value(), "--pass");
    else if (arg.startsWith("--"))
      throw new Error(`Unknown option ${arg}\n\n${USAGE}`);
    else if (!options.command) options.command = arg;
    else options.args.push(arg);
  }
  if (!options.command) throw new Error(USAGE);
  return options;
}

function number(value: string | undefined, label: string) {
  const parsed = Number(value?.replace(/^#/u, ""));
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error(`${label} needs a number`);
  return parsed;
}

/** Every worktree of the clone shares one gate directory in the primary checkout. */
export function gateDir() {
  const result = runProcess([
    "git",
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  if (result.code !== 0)
    throw new Error("Run agent:gate inside the repository");
  return join(dirname(result.stdout.trim()), ".agents", "crew-gate");
}

export function loadConfig(path: string): GateConfig {
  if (!existsSync(path))
    throw new Error(
      `No gate config at ${path}. Copy scripts/agent/gate/config.example.json there and fill in the crew's reviewers.`,
    );
  const value = JSON.parse(readFileSync(path, "utf8")) as Partial<GateConfig>;
  if (typeof value.repo !== "string" || !/^[\w.-]+\/[\w.-]+$/u.test(value.repo))
    throw new Error("Gate config needs repo as owner/name");
  // A check listed as both would be excused by the looser flake rule.
  const both = (value.aggregateChecks ?? []).filter((name) =>
    (value.flakes ?? []).includes(name),
  );
  if (both.length)
    throw new Error(
      `Gate config lists ${both.join(", ")} as both a flake and an aggregate; an aggregate must never be a flake`,
    );
  return {
    repo: value.repo,
    reviewers: value.reviewers ?? {},
    flakes: value.flakes ?? [],
    rerunBudget: value.rerunBudget ?? 1,
    ...(value.requiredChecks ? { requiredChecks: value.requiredChecks } : {}),
    ...(value.aggregateChecks
      ? { aggregateChecks: value.aggregateChecks }
      : {}),
    ...(value.remote ? { remote: value.remote } : {}),
  };
}

function line(verdict: Verdict) {
  const head = verdict.head ? shortSha(verdict.head) : "-------";
  return `#${verdict.number}\t${verdict.state}\t${head}\t${verdict.conditions
    .filter((entry) => entry.state !== "met")
    .map((entry) => `${entry.state}: ${entry.detail}`)
    .join(" | ")}`;
}

/** Who can move each kind of blocker. */
function decider(id: string, state: string) {
  if (id === "hold") return "owner or FirstMate (release)";
  if (id === "unattributed")
    return "the post's author (attribute) or FirstMate (waive)";
  if (state === "judgment" || id === "reviewers") return "FirstMate / clerk";
  if (id.startsWith("review:"))
    return `${id.slice(7)} (confirm) or the author (fix)`;
  return "the author";
}

const out = (text: string) => console.log(text);

export type Context = {
  config: GateConfig;
  run: Run;
  mirror: string;
  now: number;
};

/** Read, judge and record in one transaction; nothing is kept if a read fails. */
export function runPass(db: Database, context: Context, numbers: number[]) {
  const started = Date.now();
  const { config, run, mirror, now } = context;
  const inputs = observe({ run, config, numbers, mirror, now }).map(
    (input) => ({
      ...input,
      hold: activeHold(db, input.number),
      waived: waivedSources(db, input.number),
    }),
  );
  const verdicts = inputs.map((input) => evaluate(input, config, now));
  // Elapsed wall time on the caller's clock, so tests can fix `now`.
  const finishedAt = now + (Date.now() - started);
  const passId = recordPass(db, {
    trigger: numbers.length ? `pr ${numbers.join(",")}` : "open",
    config,
    startedAt: now,
    finishedAt,
    inputs,
    verdicts,
  });
  return { passId, verdicts, inputs };
}

export async function main(
  argv: string[],
  now = Date.now(),
  run: Run = runProcess,
): Promise<number> {
  const options = parseOptions(argv);
  const dir = !options.db || !options.config ? gateDir() : "";
  const dbPath = options.db ?? join(dir, "gate.sqlite");
  const configPath = options.config ?? join(dir, "config.json");
  const { command, args } = options;

  if (command === "replay") return replay(options, dbPath, configPath);

  const db = openStore(dbPath);
  const context = (): Context => ({
    config: loadConfig(configPath),
    run,
    mirror: join(dirname(resolve(dbPath)), "mirror.git"),
    now,
  });
  try {
    if (command === "pass") {
      const { passId, verdicts } = runPass(db, context(), options.prs);
      if (options.json)
        out(JSON.stringify({ pass: passId, verdicts }, null, 2));
      else {
        out(`pass ${passId}: ${verdicts.length} pull request(s)`);
        for (const verdict of verdicts) out(line(verdict));
      }
      return 0;
    }

    if (command === "explain") return explain(db, options, now);

    if (command === "merge-line" || command === "check-claim") {
      const pr = number(args[0], command);
      const sha = (args[1] ?? "").toLowerCase();
      if (command === "check-claim" && !/^[0-9a-f]{7,40}$/u.test(sha))
        throw new Error("check-claim needs a commit SHA");
      const settings = context();
      // Judge the current head every time: holds, new findings, merges and
      // pushes since the last pass all count.
      const verdict = runPass(db, settings, [pr]).verdicts[0]!;
      if (command === "check-claim") {
        if (verdict.head && !verdict.head.startsWith(sha)) {
          out(
            `#${pr} STALE: claim names ${sha.slice(0, 7)}, head is ${shortSha(verdict.head)}`,
          );
          return 2;
        }
        out(line(verdict));
        return verdict.state === "READY" ? 0 : 2;
      }
      if (verdict.state !== "READY" || !verdict.head) {
        console.error(`No merge line for #${pr}: ${line(verdict)}`);
        return 2;
      }
      // GitHub refuses the merge if the head moves after this verdict.
      out(
        `gh pr merge ${pr} --repo ${settings.config.repo} --merge --match-head-commit ${verdict.head}`,
      );
      return 0;
    }

    if (command === "hold" || command === "release" || command === "waive") {
      const pr = number(args[0], command);
      const sourceId = command === "waive" ? args[1] : undefined;
      if (command === "waive" && !sourceId)
        throw new Error(
          "waive needs the RESULT post's source ID (see explain)",
        );
      if (command !== "release" && !options.reason)
        throw new Error(`${command} needs --reason`);
      addDecision(db, {
        pr,
        kind: command,
        ...(sourceId ? { sourceId } : {}),
        reason: options.reason ?? "released",
        actor: options.actor,
        createdAt: now,
      });
      out(
        command === "hold"
          ? `#${pr} held: ${options.reason}`
          : command === "waive"
            ? `#${pr} waived ${sourceId}: ${options.reason}`
            : `#${pr} released`,
      );
      return 0;
    }

    if (command === "diff") {
      const last = latestPass(db);
      const since = options.since ?? (last ? last.id - 1 : 0);
      const changes = transitions(db, since);
      if (options.json) out(JSON.stringify(changes, null, 2));
      else
        for (const change of changes)
          out(`pass ${change.passId}\t${line(change)}`);
      return 0;
    }

    throw new Error(`Unknown command ${command}\n\n${USAGE}`);
  } finally {
    db.close();
  }
}

function explain(db: Database, options: Options, now: number) {
  const pr = number(options.args[0], "explain");
  const verdict = latestVerdict(db, pr);
  if (!verdict) throw new Error(`No verdict for #${pr}; run pass first`);
  const input = latestInput(db, pr);
  if (options.json) {
    out(JSON.stringify({ verdict, input }, null, 2));
    return 0;
  }
  const age = Math.round((now - verdict.lastSeenAt) / 60_000);
  out(
    `#${pr} ${verdict.state} at ${verdict.head ?? "no head"} (pass ${verdict.passId}, last seen ${age} min ago)`,
  );
  for (const entry of verdict.conditions)
    out(
      `  ${entry.state.padEnd(8)} ${entry.id}: ${entry.detail}${entry.url ? ` <${entry.url}>` : ""}`,
    );
  for (const note of verdict.notes) out(`  note     ${note}`);
  for (const claim of input?.item?.pr?.reviewers ?? [])
    out(
      `  claim    ${claim.reviewer ?? "unattributed"} ${claim.outcome} at ${claim.commit ? shortSha(claim.commit) : "unknown head"}: ${claim.line}${claim.reviewer ? "" : ` [${claim.sourceId ?? claim.url}]`}`,
    );
  for (const attempt of input?.attempts ?? [])
    out(
      `  attempt  ${attempt.name} #${attempt.attempt}: ${attempt.conclusion}`,
    );
  const blocking = verdict.conditions.filter((entry) => entry.state !== "met");
  if (blocking.length) {
    out("Escalation packet:");
    for (const entry of blocking)
      out(
        `  - ${entry.detail} → ${decider(entry.id, entry.state)}${entry.url ? ` <${entry.url}>` : ""}`,
      );
  }
  return 0;
}

type Fixture = {
  name?: string;
  now: number;
  config?: GateConfig;
  input: GateInput;
  expect?: { state: VerdictState; conditions?: Record<string, string> };
};

/** Recompute without the network: fixture files, or a recorded pass. */
function replay(options: Options, dbPath: string, configPath: string) {
  if (options.pass !== undefined) {
    const db = openStore(dbPath);
    try {
      const config = passConfig(db, options.pass);
      if (!config) throw new Error(`No pass ${options.pass}`);
      if (
        existsSync(configPath) &&
        configHash(loadConfig(configPath)) !== configHash(config)
      )
        out(
          `note: config.json changed since pass ${options.pass}; replaying with the pass's own config`,
        );
      const recorded = new Map(
        verdictsAt(db, options.pass).map((entry) => [entry.number, entry]),
      );
      let changed = 0;
      for (const input of passInputs(db, options.pass)) {
        const verdict = evaluate(input, config, input.readAt);
        const before = recorded.get(input.number);
        const same =
          before !== undefined &&
          verdictDigest(before) === verdictDigest(verdict);
        if (!same) changed++;
        out(
          `${same ? "same" : `was ${before?.state ?? "-"}`}\t${line(verdict)}`,
        );
      }
      out(`${changed} verdict(s) differ from pass ${options.pass}`);
      return changed ? 1 : 0;
    } finally {
      db.close();
    }
  }
  const dir = options.args[0];
  if (!dir) throw new Error("replay needs a directory or --pass ID");
  let failures = 0;
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()) {
    const fixture = JSON.parse(
      readFileSync(join(dir, file), "utf8"),
    ) as Fixture;
    const config = fixture.config ?? loadConfig(configPath);
    const verdict = evaluate(fixture.input, config, fixture.now);
    const mismatches: string[] = [];
    if (fixture.expect && fixture.expect.state !== verdict.state)
      mismatches.push(
        `state ${verdict.state}, expected ${fixture.expect.state}`,
      );
    for (const [id, state] of Object.entries(
      fixture.expect?.conditions ?? {},
    )) {
      const actual = verdict.conditions.find((entry) => entry.id === id)?.state;
      if (actual !== state)
        mismatches.push(`${id} ${actual ?? "absent"}, expected ${state}`);
    }
    if (mismatches.length) failures++;
    out(
      `${mismatches.length ? "FAIL" : "ok  "} ${fixture.name ?? file}: ${verdict.state}${mismatches.length ? ` (${mismatches.join("; ")})` : ""}`,
    );
  }
  return failures ? 1 : 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
