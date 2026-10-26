import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crewPass, type Deps, promptable, type Seat, seats } from "./crew";
import {
  authorOf,
  type CrewSettings,
  plan,
  SETTINGS_DEFAULTS,
} from "./crew/plan";
import {
  actionsIn,
  activeRuns,
  finishRun,
  getAction,
  openCrewStore,
} from "./crew/store";
import { harnessArgv, parseUsage, reviewerPrompt } from "./crew/worker";
import { config, confirm, input, NOW, SHA, type Post } from "./gate/cases";
import type { Run } from "./gate/observe";
import { evaluate, type GateInput } from "./gate/predicate";

const ROSTER = {
  rev2: { model: "gpt-6.1-sol", effort: "xhigh" },
  "rev-astra": { model: "gpt-6-astra", effort: "high" },
  "rev-opus": { model: "claude-opus-5-5", effort: "high" },
};
const SETTINGS: CrewSettings = {
  ...SETTINGS_DEFAULTS,
  pods: ["town"],
  leads: { town: "towncx" },
  neverPrompt: ["firstmate"],
  roster: ROSTER,
};
const SEATS = ["towncx", "rev2", "rev-astra", "rev-opus", "firstmate"];
const BRANCH = { branch: "agent/towncx-12-plates" };
const open = (commit: string, count = 2): Post => ({
  reviewer: "rev2",
  commit,
  result: `0/0 resolved, ${count} new`,
});

function town(options: Parameters<typeof input>[0]): GateInput {
  return input({
    labels: ["pod:town"],
    ...options,
    item: { ...BRANCH, ...options.item },
  });
}

function planned(gateInput: GateInput, settings = SETTINGS) {
  return plan(evaluate(gateInput, config, NOW), gateInput, settings, SEATS);
}

describe("authorOf", () => {
  test("reads the seat from the branch, longest name first", () => {
    const names = ["rev", "rev-astra", "towncx"];
    expect(authorOf(1, "agent/towncx-436-fix", SETTINGS, names)).toBe("towncx");
    expect(authorOf(1, "agent/rev-astra-spike", SETTINGS, names)).toBe(
      "rev-astra",
    );
    expect(authorOf(1, "agent/unknown-thing", SETTINGS, names)).toBeNull();
  });

  test("a batch branch belongs to its pod lead; an override wins", () => {
    expect(authorOf(1, "batch/town-3", SETTINGS, [])).toBe("towncx");
    expect(authorOf(1, "batch/chat-1", SETTINGS, [])).toBeNull();
    expect(
      authorOf(
        9,
        "batch/town-3",
        { ...SETTINGS, authors: { "9": "fixer" } },
        [],
      ),
    ).toBe("fixer");
  });
});

describe("plan", () => {
  test("READY goes to the owner and nobody else", () => {
    const actions = planned(
      town({
        head: SHA.reviewed,
        posts: ["rev2", "rev-astra", "rev-opus"].map((name) =>
          confirm(name, SHA.reviewed),
        ),
      }),
    );
    expect(actions.map((a) => [a.kind, a.target])).toEqual([
      ["ready", "owner"],
    ]);
  });

  test("a green PR with no reviews starts the trio, fresh", () => {
    const actions = planned(town({ head: SHA.reviewed, posts: [] }));
    expect(actions.map((a) => [a.kind, a.target])).toEqual([
      ["review", "rev2"],
      ["review", "rev-astra"],
      ["review", "rev-opus"],
    ]);
  });

  test("findings on the head go to the author, once, with their URLs", () => {
    const actions = planned(
      town({ head: SHA.reviewed, posts: [open(SHA.reviewed)] }),
    );
    const fix = actions.find((a) => a.kind === "fix")!;
    expect(fix.target).toBe("towncx");
    expect(fix.text).toStartWith("[crew -> towncx] ACT #7 fix @aaaaaaa:");
    expect(fix.text).toContain("rev2 https://github.com/");
    expect(
      actions.filter((a) => a.kind === "review").map((a) => a.target),
    ).toEqual(["rev-astra", "rev-opus"]);
  });

  test("a new head after findings asks that reviewer to confirm the delta", () => {
    const actions = planned(
      town({
        head: SHA.fixed,
        posts: [
          open(SHA.reviewed),
          confirm("rev-astra", SHA.fixed),
          confirm("rev-opus", SHA.fixed),
        ],
      }),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      kind: "confirm",
      target: "rev2",
      since: SHA.reviewed,
      head: SHA.fixed,
    });
  });

  test("red CI goes to the author and holds reviewer runs", () => {
    const actions = planned(
      town({
        head: SHA.reviewed,
        posts: [],
        checks: [{ name: "Delivery checks", state: "fail", required: true }],
      }),
    );
    expect(actions.map((a) => [a.kind, a.target])).toEqual([["ci", "towncx"]]);
  });

  test("drafts plan nothing; unknown authors and models go to the owner", () => {
    expect(
      planned(town({ head: SHA.reviewed, posts: [], item: { draft: true } })),
    ).toEqual([]);
    const lost = planned(
      town({
        head: SHA.reviewed,
        posts: [open(SHA.reviewed)],
        item: { branch: "feature/x" },
      }),
      { ...SETTINGS, roster: { rev2: ROSTER.rev2 } },
    );
    const judgment = lost.find((a) => a.kind === "judgment")!;
    expect(judgment.target).toBe("owner");
    expect(judgment.text).toContain("no author seat for feature/x");
    expect(judgment.text).toContain("rev-astra has no roster model");
  });

  test("the same verdict plans the same keys", () => {
    const value = town({ head: SHA.reviewed, posts: [open(SHA.reviewed)] });
    expect(planned(value).map((a) => a.key)).toEqual(
      planned(value).map((a) => a.key),
    );
  });
});

describe("delivery", () => {
  const root = mkdtempSync(join(tmpdir(), "crew-"));
  const configPath = join(root, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      ...config,
      roster: ROSTER,
      crew: { ...SETTINGS, roster: {} },
    }),
  );
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  let calls: string[][];
  let spawned: string[][];
  let live: Seat[];
  let dead: Set<number>;
  let killed: number[];
  let crew: ReturnType<typeof openCrewStore>;

  beforeEach(() => {
    calls = [];
    spawned = [];
    killed = [];
    dead = new Set();
    live = SEATS.map((name) => ({ name, status: "idle", focused: false }));
    crew = openCrewStore(":memory:");
  });

  const run: Run = (argv) => {
    calls.push(argv);
    if (argv.join(" ") === "herdr agent list")
      return {
        code: 0,
        stdout: JSON.stringify({
          result: {
            agents: live.map((seat) => ({
              name: seat.name,
              agent_status: seat.status,
              focused: seat.focused,
            })),
          },
        }),
        stderr: "",
      };
    return { code: 0, stdout: "", stderr: "" };
  };
  const deps: Deps = {
    run,
    spawn: (argv) => {
      spawned.push(argv);
      return 1000 + spawned.length;
    },
    alive: (pid) => !dead.has(pid),
    kill: (pid) => killed.push(pid),
    out: () => {},
  };
  const pass = (value: GateInput, now = NOW) =>
    crewPass({
      judge: () => ({
        verdicts: [evaluate(value, config, NOW)],
        inputs: [value],
      }),
      crew,
      configPath,
      dir: root,
      prs: [],
      dryRun: false,
      now,
      deps,
      worker: ["bun", "crew.ts"],
    });
  const prompts = () => calls.filter((argv) => argv[2] === "prompt");
  const notices = () => calls.filter((argv) => argv[1] === "notification");

  test("prompts an idle author once, however many passes run", () => {
    const value = town({
      head: SHA.reviewed,
      posts: [
        open(SHA.reviewed),
        confirm("rev-astra", SHA.reviewed),
        confirm("rev-opus", SHA.reviewed),
      ],
    });
    pass(value);
    pass(value, NOW + 60_000);
    expect(prompts()).toHaveLength(1);
    expect(prompts()[0]!.slice(0, 4)).toEqual([
      "herdr",
      "agent",
      "prompt",
      "towncx",
    ]);
    expect(readFileSync(join(root, "feed.log"), "utf8")).toContain(
      "prompted towncx: fix",
    );
  });

  test("waits while the author is working or focused, then prompts", () => {
    const value = town({ head: SHA.reviewed, posts: [open(SHA.reviewed)] });
    live = live.map((seat) =>
      seat.name === "towncx" ? { ...seat, status: "working" } : seat,
    );
    pass(value);
    live = live.map((seat) =>
      seat.name === "towncx"
        ? { ...seat, status: "idle", focused: true }
        : seat,
    );
    pass(value, NOW + 60_000);
    expect(prompts()).toHaveLength(0);
    live = live.map((seat) =>
      seat.name === "towncx" ? { ...seat, focused: false } : seat,
    );
    pass(value, NOW + 120_000);
    expect(prompts()).toHaveLength(1);
  });

  test("never types into a never-prompt seat; the owner hears instead", () => {
    expect(
      promptable(
        { name: "firstmate", status: "idle", focused: false },
        SETTINGS,
      ),
    ).toBe("never prompted");
    expect(promptable(undefined, SETTINGS)).toBe("no live seat");
  });

  test("READY notifies the owner once", () => {
    const value = town({
      head: SHA.reviewed,
      posts: ["rev2", "rev-astra", "rev-opus"].map((name) =>
        confirm(name, SHA.reviewed),
      ),
    });
    pass(value);
    pass(value, NOW + 60_000);
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toContain("Crew: READY #7");
    expect(prompts()).toHaveLength(0);
  });

  test("starts fresh reviewers up to the limit, with the author for the brief", () => {
    const limited = join(root, "limited.json");
    writeFileSync(
      limited,
      JSON.stringify({
        ...config,
        roster: ROSTER,
        crew: { ...SETTINGS, maxRuns: 2 },
      }),
    );
    const value = town({ head: SHA.reviewed, posts: [] });
    crewPass({
      judge: () => ({
        verdicts: [evaluate(value, config, NOW)],
        inputs: [value],
      }),
      crew,
      configPath: limited,
      dir: root,
      prs: [],
      dryRun: false,
      now: NOW,
      deps,
      worker: ["bun", "crew.ts"],
    });
    expect(spawned).toHaveLength(2);
    expect(spawned[0]).toEqual(
      expect.arrayContaining([
        "review",
        "--pr",
        "7",
        "--reviewer",
        "rev2",
        "--head",
        SHA.reviewed,
        "--author",
        "towncx",
      ]),
    );
    expect(actionsIn(crew, ["pending"]).map((a) => a.target)).toEqual([
      "rev-opus",
    ]);
  });

  test("a finished run that posted nothing becomes the owner's call", () => {
    const value = town({
      head: SHA.reviewed,
      posts: [
        confirm("rev-astra", SHA.reviewed),
        confirm("rev-opus", SHA.reviewed),
      ],
    });
    pass(value);
    const [active] = activeRuns(crew);
    finishRun(crew, active!.id, 0, null, NOW + 1000);
    pass(value, NOW + 2000);
    expect(getAction(crew, active!.actionKey)!.state).toBe("done");
    pass(value, NOW + 20 * 60_000);
    expect(getAction(crew, `${active!.actionKey}:stuck`)?.kind).toBe(
      "judgment",
    );
  });

  test("a crashed run retries once, then fails to the owner", () => {
    const value = town({
      head: SHA.reviewed,
      posts: [
        confirm("rev-astra", SHA.reviewed),
        confirm("rev-opus", SHA.reviewed),
      ],
    });
    pass(value);
    dead.add(1001);
    pass(value, NOW + 60_000);
    expect(spawned).toHaveLength(2);
    dead.add(1002);
    pass(value, NOW + 120_000);
    pass(value, NOW + 180_000);
    expect(spawned).toHaveLength(2);
    const key = `7:${SHA.reviewed}:review:rev2`;
    expect(getAction(crew, key)!.state).toBe("failed");
    expect(getAction(crew, `${key}:stuck`)?.target).toBe("owner");
  });

  test("a new head supersedes waiting actions and stops stale runs", () => {
    live = live.map((seat) =>
      seat.name === "towncx" ? { ...seat, status: "working" } : seat,
    );
    pass(town({ head: SHA.reviewed, posts: [open(SHA.reviewed)] }));
    expect(activeRuns(crew)).toHaveLength(2);
    pass(
      town({
        head: SHA.fixed,
        posts: [open(SHA.reviewed)],
        checks: [{ name: "Delivery checks", state: "pending", required: true }],
      }),
      NOW + 60_000,
    );
    expect(actionsIn(crew, ["pending", "running"])).toEqual([]);
    expect(killed).toEqual([1001, 1002]);
  });
});

describe("seats", () => {
  test("skips unnamed agents and survives a Herdr failure", () => {
    const listing: Run = () => ({
      code: 0,
      stdout: JSON.stringify({
        result: {
          agents: [
            { agent_status: "idle" },
            { name: "towncx", agent_status: "done", focused: true },
          ],
        },
      }),
      stderr: "",
    });
    expect(seats(listing)).toEqual([
      { name: "towncx", status: "done", focused: true },
    ]);
    expect(seats(() => ({ code: 1, stdout: "", stderr: "down" }))).toEqual([]);
  });
});

describe("worker", () => {
  const task = {
    repo: "example-org/widgets",
    pr: 7,
    head: SHA.fixed,
    reviewer: "rev2",
    title: "Synthetic batch",
    url: "https://github.com/example-org/widgets/pull/7",
    branch: "agent/towncx-12-plates",
    author: "towncx",
  };

  test("the brief carries the canonical header and the delta for a confirm", () => {
    const prompt = reviewerPrompt({ ...task, since: SHA.reviewed });
    expect(prompt).toContain(
      `Reviewer: rev2\n  Reviewed commit: ${SHA.fixed}\n  RESULT #7: x/y resolved, z new`,
    );
    expect(prompt).toContain(`delta ${SHA.reviewed}..${SHA.fixed}`);
    expect(prompt).toContain("Never push, merge, approve");
  });

  test("runs Claude models with claude -p and the rest with codex exec", () => {
    expect(
      harnessArgv(ROSTER["rev-opus"], "brief", "last.txt").slice(0, 5),
    ).toEqual(["claude", "-p", "brief", "--model", "claude-opus-5-5"]);
    const codex = harnessArgv(ROSTER.rev2, "brief", "last.txt");
    expect(codex.slice(0, 4)).toEqual(["codex", "exec", "-m", "gpt-6.1-sol"]);
    expect(codex).toContain('model_reasoning_effort="xhigh"');
    expect(codex.at(-1)).toBe("brief");
  });

  test("reads usage from Claude's result or Codex's last turn", () => {
    expect(
      parseUsage(
        JSON.stringify({ usage: { output_tokens: 5 }, total_cost_usd: 0.5 }),
      ),
    ).toEqual({ output_tokens: 5, total_cost_usd: 0.5 });
    expect(
      parseUsage(
        [
          '{"type":"thread.started"}',
          '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":2}}',
          "not json",
        ].join("\n"),
      ),
    ).toEqual({ input_tokens: 10, output_tokens: 2 });
    expect(parseUsage("")).toBeNull();
  });
});
