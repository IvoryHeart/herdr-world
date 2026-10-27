import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crewPass, promptable, roundLabel, type Seat, seats } from "./crew";
import {
  type Deps,
  herdrIds,
  type Place,
  shellLine,
  tabClosed,
} from "./crew/deps";
import { openChat, runs } from "./crew/review";
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
  getRun,
  openCrewStore,
  openLock,
  openRounds,
  setRunPid,
  setRunResult,
  setRunSession,
} from "./crew/store";
import {
  chatArgv,
  claudeTranscript,
  claudeUsage,
  codexSessionOf,
  codexUsage,
  reviewerArgv,
  reviewerPrompt,
} from "./crew/worker";
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

  test("findings wait for the whole trio, then go to the author once", () => {
    const early = planned(
      town({ head: SHA.reviewed, posts: [open(SHA.reviewed)] }),
    );
    expect(early.map((a) => [a.kind, a.target])).toEqual([
      ["review", "rev-astra"],
      ["review", "rev-opus"],
    ]);
    const actions = planned(
      town({
        head: SHA.reviewed,
        posts: [
          open(SHA.reviewed),
          confirm("rev-astra", SHA.reviewed),
          confirm("rev-opus", SHA.reviewed),
        ],
      }),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]!.target).toBe("towncx");
    expect(actions[0]!.text).toStartWith(
      "[crew -> towncx] ACT #7 fix @aaaaaaa:",
    );
    expect(actions[0]!.text).toContain("rev2 https://github.com/");
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

  test("red CI waits while another check is still running", () => {
    const actions = planned(
      town({
        head: SHA.reviewed,
        posts: [],
        checks: [
          { name: "Delivery checks", state: "fail", required: true },
          { name: "Browser tests", state: "pending", required: false },
        ],
      }),
    );
    expect(actions).toEqual([]);
  });

  test("drafts plan nothing; unknown authors and models go to the owner", () => {
    expect(
      planned(town({ head: SHA.reviewed, posts: [], item: { draft: true } })),
    ).toEqual([]);
    const lost = planned(
      town({
        head: SHA.reviewed,
        posts: [
          open(SHA.reviewed),
          confirm("rev-astra", SHA.reviewed),
          confirm("rev-opus", SHA.reviewed),
        ],
        item: { branch: "feature/x" },
      }),
    );
    const judgment = lost.find((a) => a.kind === "judgment")!;
    expect(judgment.target).toBe("owner");
    expect(judgment.text).toContain("no author seat for feature/x");
    const unrostered = planned(town({ head: SHA.reviewed, posts: [] }), {
      ...SETTINGS,
      roster: { rev2: ROSTER.rev2 },
    });
    expect(unrostered.find((a) => a.kind === "judgment")!.text).toContain(
      "rev-astra has no roster model",
    );
  });

  test("reviewers wait until GitHub knows the head can merge", () => {
    expect(
      planned(
        town({ head: SHA.reviewed, posts: [], item: { mergeable: "unknown" } }),
      ),
    ).toEqual([]);
  });

  test("a roster model no harness runs is the owner's call", () => {
    const actions = planned(town({ head: SHA.reviewed, posts: [] }), {
      ...SETTINGS,
      roster: { ...ROSTER, rev2: { model: "gemini-3" } },
    });
    expect(actions.find((a) => a.kind === "judgment")!.text).toContain(
      "rev2's roster model gemini-3 is neither a Claude nor a Codex model",
    );
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
  // The gate directory sits two levels below the primary checkout, whose
  // .agents/worktrees holds the reviewers' checkouts.
  const dir = join(root, "repo", "gate");

  let calls: string[][];
  let events: string[];
  let closeFails: number;
  let removeFails: number;
  let addFails: boolean;
  let spawned: string[][];
  let live: Seat[];
  let dead: Set<number>;
  let killed: number[];
  let closed: string[];
  let places: Place[];
  let panes: boolean;
  let refuse: Set<string>;
  let opened: { line: string; cwd: string; label: string }[];
  let onPrompt: (() => void) | null;
  let crew: ReturnType<typeof openCrewStore>;
  let lock: ReturnType<typeof openLock>;

  beforeEach(() => {
    calls = [];
    spawned = [];
    killed = [];
    closed = [];
    events = [];
    closeFails = 0;
    removeFails = 0;
    addFails = false;
    places = [];
    panes = false;
    refuse = new Set();
    opened = [];
    onPrompt = null;
    dead = new Set();
    live = SEATS.map((name) => ({ name, status: "idle", focused: false }));
    crew = openCrewStore(":memory:");
    lock = openLock(":memory:");
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
    if (argv[0] === "git" && argv[3] === "worktree") {
      const path = argv.at(-2) === "--detach" ? argv.at(-2) : argv.at(-1)!;
      if (argv[4] === "add") {
        if (addFails) return { code: 1, stdout: "", stderr: "fatal: no head" };
        mkdirSync(argv[6]!, { recursive: true });
      }
      if (argv[4] === "remove") {
        events.push("remove");
        if (removeFails-- > 0) return { code: 1, stdout: "", stderr: "busy" };
        rmSync(path!, { recursive: true, force: true });
      }
    }
    if (argv[2] === "prompt") onPrompt?.();
    if (refuse.has(argv[1]!) || refuse.has(argv[2]!))
      return { code: 1, stdout: "", stderr: "agent_blocked" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const deps: Deps = {
    run,
    spawn: (argv, _log, place) => {
      spawned.push(argv);
      places.push(place);
      return panes
        ? {
            pid: null,
            pane: `wP:p${spawned.length}`,
            tab: place.tab ?? `wP:t${spawned.length}`,
          }
        : { pid: 1000 + spawned.length, pane: null, tab: null };
    },
    closeTab: (tab) => {
      events.push(`close ${tab}`);
      if (closeFails-- > 0) return false;
      closed.push(tab);
      return true;
    },
    openTab: (line, cwd, label) => {
      opened.push({ line, cwd, label });
      return `wP:tC${opened.length}`;
    },
    usage: (run) => `{"output_tokens":${run.id}}`,
    alive: (pid) => !dead.has(pid),
    kill: (pid) => killed.push(pid),
    out: () => {},
  };
  const passOver = (
    values: GateInput[],
    now = NOW,
    options: { prs?: number[]; db?: typeof crew; lock?: typeof lock } = {},
  ) =>
    crewPass({
      judge: () => ({
        verdicts: values.map((value) => evaluate(value, config, NOW)),
        inputs: values,
      }),
      crew: options.db ?? crew,
      lock: options.lock ?? lock,
      configPath,
      dir,
      prs: options.prs ?? [],
      dryRun: false,
      now,
      deps,
      worker: ["bun", "crew.ts"],
    });
  const pass = (value: GateInput, now = NOW) => passOver([value], now);
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
    expect(readFileSync(join(dir, "feed.log"), "utf8")).toContain(
      "prompted towncx: fix",
    );
  });

  test("waits while the author is working or focused, then prompts", () => {
    const value = town({
      head: SHA.reviewed,
      posts: [
        open(SHA.reviewed),
        confirm("rev-astra", SHA.reviewed),
        confirm("rev-opus", SHA.reviewed),
      ],
    });
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
      lock,
      configPath: limited,
      dir,
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
    expect(getAction(crew, `${active!.actionKey}|stuck`)?.kind).toBe(
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
    expect(getAction(crew, `${key}|stuck`)?.target).toBe("owner");
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

  test("shows a round's reviewers as panes of one tab, kept after they finish", () => {
    panes = true;
    const value = town({ head: SHA.reviewed, posts: [] });
    pass(value);
    const label = "#7 towncx-12-plates · r1";
    expect(places).toEqual([
      { tab: null, after: null, direction: "down", label, title: "rev2" },
      {
        tab: "wP:t1",
        after: "wP:p1",
        direction: "right",
        label,
        title: "rev-astra",
      },
      {
        tab: "wP:t1",
        after: "wP:p2",
        direction: "down",
        label,
        title: "rev-opus",
      },
    ]);
    for (const active of activeRuns(crew))
      finishRun(crew, active.id, 0, null, NOW + 90_000);
    pass(value, NOW + 120_000);
    expect(closed).toEqual([]);
    expect(actionsIn(crew, ["running"])).toEqual([]);
    expect(openRounds(crew)).toHaveLength(1);
  });

  test("a new head opens the next round's tab and keeps the stopped one", () => {
    panes = true;
    pass(town({ head: SHA.reviewed, posts: [] }));
    pass(town({ head: SHA.fixed, posts: [] }), NOW + 60_000);
    expect(closed).toEqual([]);
    expect(places.slice(3).map((place) => [place.tab, place.label])).toEqual([
      [null, "#7 towncx-12-plates · r2"],
      ["wP:t4", "#7 towncx-12-plates · r2"],
      ["wP:t4", "#7 towncx-12-plates · r2"],
    ]);
    expect(activeRuns(crew).map((entry) => entry.round)).toEqual([2, 2, 2]);
  });

  test("a PR that merges or closes takes all its round tabs with it", () => {
    panes = true;
    pass(town({ head: SHA.reviewed, posts: [] }));
    pass(town({ head: SHA.fixed, posts: [] }), NOW + 60_000);
    // A pass scoped to another PR leaves this pod alone.
    passOver([], NOW + 90_000, { prs: [8] });
    expect(closed).toEqual([]);
    pass(town({ head: SHA.fixed, posts: [], state: "MERGED" }), NOW + 120_000);
    expect(closed).toEqual(["wP:t1", "wP:t4"]);
    expect(openRounds(crew)).toEqual([]);
    expect(actionsIn(crew, ["pending", "running"])).toEqual([]);
  });

  test("a tab the owner closed is replaced by a new one for the round", () => {
    panes = true;
    const launch = deps.spawn;
    let first = true;
    deps.spawn = (argv, log, place) => {
      // The owner closes r1's tab before the second reviewer starts.
      if (!first && place.after)
        return launch(argv, log, { ...place, tab: null, after: null });
      first = false;
      return launch(argv, log, place);
    };
    pass(town({ head: SHA.reviewed, posts: [] }));
    deps.spawn = launch;
    expect(openRounds(crew)[0]!.tab).toBe("wP:t3");
    // Every tab the round used closes with the PR, not only its newest.
    pass(
      town({ head: SHA.reviewed, posts: [], state: "MERGED" }),
      NOW + 60_000,
    );
    expect(closed.toSorted()).toEqual(["wP:t1", "wP:t2", "wP:t3"]);
  });

  test("a run superseded after it reported its pid is stopped by that pid", () => {
    panes = true;
    pass(town({ head: SHA.reviewed, posts: [] }));
    const [reported, quiet] = activeRuns(crew);
    setRunPid(crew, reported!.id, 4242);
    pass(town({ head: SHA.fixed, posts: [] }), NOW + 60_000);
    expect(killed).toEqual([4242]);
    // One that hadn't reported is finished, so its worker exits on start.
    expect(getRun(crew, quiet!.id)!.finishedAt).not.toBeNull();
  });

  const finishedWithSession = () => {
    pass(town({ head: SHA.reviewed, posts: [] }));
    const [first] = activeRuns(crew);
    setRunSession(crew, first!.id, "codex", "gpt-6-old", "thread-1");
    finishRun(crew, first!.id, 0, null, NOW + 1);
    dead.add(first!.pid!);
    return first!;
  };

  test("open sends you to a session that is still open in its pane", () => {
    pass(town({ head: SHA.reviewed, posts: [] }));
    const [first] = activeRuns(crew);
    setRunSession(crew, first!.id, "codex", "gpt-6-old", "thread-1");
    finishRun(crew, first!.id, 0, null, NOW + 1);
    expect(() =>
      openChat(crew, { prs: [], run: first!.id }, dir, lock, deps),
    ).toThrow("still open in its pane");
    expect(opened).toEqual([]);
  });
  const checkout = (id: number) =>
    join(
      root,
      ".agents",
      "worktrees",
      `review-7-rev2-${SHA.reviewed.slice(0, 7)}-${id}`,
    );

  test("a PR that closes takes reopened chats first, then their checkouts", () => {
    panes = true;
    const first = finishedWithSession();
    openChat(crew, { prs: [], run: first.id }, dir, lock, deps);
    expect(existsSync(checkout(first.id))).toBe(true);
    pass(
      town({ head: SHA.reviewed, posts: [], state: "CLOSED" }),
      NOW + 60_000,
    );
    expect(closed).toContain("wP:tC1");
    expect(events.at(-1)).toBe("remove");
    expect(events.indexOf("remove")).toBe(events.length - 1);
    expect(existsSync(checkout(first.id))).toBe(false);
    // Reopened after the PR closed, the chat removes its checkout on exit.
    openChat(crew, { prs: [], run: first.id }, dir, lock, deps);
    expect(opened[1]!.line).toEndWith(
      `; git -C ${root} worktree remove --force ${checkout(first.id)}`,
    );
    // A second chat would lose its checkout when the first one exits.
    expect(() =>
      openChat(crew, { prs: [], run: first.id }, dir, lock, deps),
    ).toThrow("may still be open");
    expect(opened).toHaveLength(2);
  });

  test("open waits for a pass that holds the lock, so a merge can't slip between", () => {
    const first = finishedWithSession();
    const path = join(root, "open.lock");
    const pass = openLock(path, 0);
    const opener = openLock(path, 0);
    pass.exec("BEGIN IMMEDIATE");
    expect(() =>
      openChat(crew, { prs: [], run: first.id }, dir, opener, deps),
    ).toThrow();
    expect(opened).toEqual([]);
    pass.exec("ROLLBACK");
    openChat(crew, { prs: [], run: first.id }, dir, opener, deps);
    expect(opened).toHaveLength(1);
    pass.close();
    opener.close();
  });

  test("a round whose close fails stays open and is retried", () => {
    panes = true;
    const first = finishedWithSession();
    openChat(crew, { prs: [], run: first.id }, dir, lock, deps);
    closeFails = 1;
    pass(
      town({ head: SHA.reviewed, posts: [], state: "MERGED" }),
      NOW + 60_000,
    );
    expect(openRounds(crew)).toHaveLength(1);
    expect(events).not.toContain("remove");
    removeFails = 1;
    pass(
      town({ head: SHA.reviewed, posts: [], state: "MERGED" }),
      NOW + 120_000,
    );
    expect(openRounds(crew)).toHaveLength(1);
    pass(
      town({ head: SHA.reviewed, posts: [], state: "MERGED" }),
      NOW + 180_000,
    );
    expect(openRounds(crew)).toEqual([]);
    expect(existsSync(checkout(first.id))).toBe(false);
  });

  test("open stops when it can't recreate the checkout", () => {
    const first = finishedWithSession();
    addFails = true;
    expect(() =>
      openChat(crew, { prs: [], run: first.id }, dir, lock, deps),
    ).toThrow("couldn't recreate");
    expect(opened).toEqual([]);
  });

  test("a pane run that never reports its pid counts as a failed start", () => {
    panes = true;
    const value = town({
      head: SHA.reviewed,
      posts: [
        confirm("rev-astra", SHA.reviewed),
        confirm("rev-opus", SHA.reviewed),
      ],
    });
    pass(value);
    pass(value, NOW + 4 * 60_000);
    expect(closed).toEqual([]);
    expect(spawned).toHaveLength(2);
    expect(places[1]!.after).toBe("wP:p1");
  });

  test("lists runs and reopens one as a chat with the run's own model", () => {
    const first = finishedWithSession();
    setRunResult(crew, first.id, "RESULT #7: 0/0 resolved, 2 new");
    crew
      .query("UPDATE run SET usage = ? WHERE id = ?")
      .run('{"input_tokens":120000,"output_tokens":4000}', first.id);
    const lines: string[] = [];
    runs(crew, { prs: [7], lines: 10 }, (text) => lines.push(text));
    expect(lines.at(-1)).toBe(
      `run ${first.id}\t#7 r1 rev2 @${SHA.reviewed.slice(0, 7)} exit 0 · RESULT #7: 0/0 resolved, 2 new in 120k out 4k · bun run agent:crew -- open --run ${first.id}`,
    );
    openChat(crew, { prs: [7], reviewer: "rev2", round: 1 }, dir, lock, deps);
    // The roster now has rev2 on another model; the session keeps its own.
    expect(opened[0]!.line).toBe("codex resume thread-1 -m gpt-6-old");
    expect(opened[0]!.label).toBe("#7 rev2 r1 · chat");
    expect(opened[0]!.cwd).toBe(checkout(first.id));
    const [other] = activeRuns(crew);
    expect(() =>
      openChat(crew, { prs: [], run: other!.id }, dir, lock, deps),
    ).toThrow("recorded no session");
  });

  const trioPosted = (posts: Post[] = []) =>
    town({
      head: SHA.reviewed,
      posts: [
        open(SHA.reviewed),
        confirm("rev-astra", SHA.reviewed),
        confirm("rev-opus", SHA.reviewed),
        ...posts,
      ],
    });
  const pendingCheck = [
    { name: "Delivery checks", state: "pending" as const, required: true },
  ];

  test("a rerun on the same head pauses reviewers; it never stops or strands them", () => {
    const limited = join(root, "two.json");
    writeFileSync(
      limited,
      JSON.stringify({
        ...config,
        roster: ROSTER,
        crew: { ...SETTINGS, maxRuns: 2 },
      }),
    );
    const at = (value: GateInput, now: number) =>
      crewPass({
        judge: () => ({
          verdicts: [evaluate(value, config, NOW)],
          inputs: [value],
        }),
        crew,
        lock,
        configPath: limited,
        dir,
        prs: [],
        dryRun: false,
        now,
        deps,
        worker: ["bun", "crew.ts"],
      });
    at(town({ head: SHA.reviewed, posts: [] }), NOW);
    expect(spawned).toHaveLength(2);
    // A label edit sends checks back to pending on the same head.
    at(
      town({ head: SHA.reviewed, posts: [], checks: pendingCheck }),
      NOW + 60_000,
    );
    expect(killed).toEqual([]);
    expect(actionsIn(crew, ["running"])).toHaveLength(2);
    expect(spawned).toHaveLength(2);
    // Green again: the third reviewer starts once a slot frees.
    finishRun(crew, activeRuns(crew)[0]!.id, 0, null, NOW + 90_000);
    at(town({ head: SHA.reviewed, posts: [] }), NOW + 120_000);
    expect(spawned).toHaveLength(3);
    expect(spawned[2]).toContain("rev-opus");
  });

  test("a review is done once its RESULT is on GitHub; its session stays open", () => {
    pass(town({ head: SHA.reviewed, posts: [] }));
    const opus = activeRuns(crew).find(
      (entry) => entry.reviewer === "rev-opus",
    )!;
    pass(
      town({ head: SHA.reviewed, posts: [confirm("rev-opus", SHA.reviewed)] }),
      NOW + 60_000,
    );
    expect(killed).toEqual([]);
    const done = getRun(crew, opus.id)!;
    expect(done.exitCode).toBe(0);
    expect(done.result).toBe("RESULT #7: 2/2 resolved, 0 new");
    expect(done.usage).toBe(`{"output_tokens":${opus.id}}`);
    expect(getAction(crew, opus.actionKey)!.state).toBe("done");
    // Its slot is free and the process lives on as the owner's chat.
    expect(activeRuns(crew)).toHaveLength(2);
    expect(dead.has(opus.pid!)).toBe(false);
  });

  test("a RESULT posted before its session ended is still recorded", () => {
    for (const code of [0, 130]) {
      crew = openCrewStore(":memory:");
      pass(town({ head: SHA.reviewed, posts: [] }));
      const opus = activeRuns(crew).find(
        (entry) => entry.reviewer === "rev-opus",
      )!;
      // The owner quits the session before the next pass sees the post.
      finishRun(crew, opus.id, code, '{"output_tokens":9}', NOW + 1000);
      pass(
        town({
          head: SHA.reviewed,
          posts: [confirm("rev-opus", SHA.reviewed)],
        }),
        NOW + 60_000,
      );
      const run = getRun(crew, opus.id)!;
      expect(run.result).toBe("RESULT #7: 2/2 resolved, 0 new");
      expect([run.exitCode, run.usage]).toEqual([code, '{"output_tokens":9}']);
      expect(getAction(crew, opus.actionKey)!.state).toBe("done");
    }
  });

  test("a reviewer that posted just before a newer head keeps its session", () => {
    pass(town({ head: SHA.reviewed, posts: [] }));
    const opus = activeRuns(crew).find(
      (entry) => entry.reviewer === "rev-opus",
    )!;
    pass(
      town({ head: SHA.fixed, posts: [confirm("rev-opus", SHA.reviewed)] }),
      NOW + 60_000,
    );
    expect(killed).not.toContain(opus.pid);
    expect(getRun(crew, opus.id)!.result).toBe(
      "RESULT #7: 2/2 resolved, 0 new",
    );
    expect(getAction(crew, opus.actionKey)!.state).toBe("done");
  });

  test("a post without a RESULT line leaves the reviewer working", () => {
    pass(town({ head: SHA.reviewed, posts: [] }));
    pass(
      town({
        head: SHA.reviewed,
        posts: [{ reviewer: "rev-opus", commit: SHA.reviewed, result: "" }],
      }),
      NOW + 60_000,
    );
    expect(activeRuns(crew)).toHaveLength(3);
    expect(actionsIn(crew, ["running"])).toHaveLength(3);
  });

  test("a check stuck running goes to the author to rerun, once", () => {
    const stuck = town({
      head: SHA.reviewed,
      posts: [],
      checks: [
        { name: "Delivery checks", state: "pass", required: true },
        {
          name: "World browser tests (4/6)",
          state: "pending",
          required: false,
          url: "https://github.com/example-org/widgets/actions/runs/1/job/22",
        },
      ],
    });
    pass(stuck);
    pass(stuck, NOW + 29 * 60_000);
    expect(prompts()).toEqual([]);
    pass(stuck, NOW + 31 * 60_000);
    pass(stuck, NOW + 40 * 60_000);
    expect(prompts()).toHaveLength(1);
    expect(prompts()[0]!.slice(3)).toEqual([
      "towncx",
      "[crew -> towncx] ACT #7 ci @" +
        SHA.reviewed.slice(0, 7) +
        ": World browser tests (4/6) has been running 31 minutes, longer than CI takes; GitHub may have lost its status. Rerun it: gh run rerun --job 22",
    ]);
    // No reviewer starts while a check is still running.
    expect(spawned).toEqual([]);
  });

  test("a reviewer past the limit is reported to the owner, not stopped", () => {
    pass(town({ head: SHA.reviewed, posts: [] }));
    const value = town({ head: SHA.reviewed, posts: [] });
    pass(value, NOW + 91 * 60_000);
    pass(value, NOW + 92 * 60_000);
    expect(killed).toEqual([]);
    expect(activeRuns(crew)).toHaveLength(3);
    const overdue = notices().filter((argv) =>
      argv.join(" ").includes("without posting"),
    );
    expect(overdue).toHaveLength(3);
  });

  test("a hold pauses waiting steps and its release resumes them", () => {
    live = live.map((seat) =>
      seat.name === "towncx" ? { ...seat, status: "working" } : seat,
    );
    pass(trioPosted());
    const held = { ...trioPosted(), hold: { reason: "owner repro", at: NOW } };
    live = live.map((seat) =>
      seat.name === "towncx" ? { ...seat, status: "idle" } : seat,
    );
    pass(held, NOW + 60_000);
    expect(prompts()).toHaveLength(0);
    pass(trioPosted(), NOW + 120_000);
    expect(prompts()).toHaveLength(1);
  });

  test("a new CI failure on the same head prompts the author again", () => {
    const red = (url: string) =>
      town({
        head: SHA.reviewed,
        posts: [],
        checks: [
          { name: "Delivery checks", state: "fail", required: true, url },
        ],
      });
    pass(red("https://example.com/job/1"));
    pass(red("https://example.com/job/1"), NOW + 60_000);
    pass(red("https://example.com/job/2"), NOW + 120_000);
    expect(prompts()).toHaveLength(2);
  });

  test("a later judgment on the same head reaches the owner too", () => {
    const value = trioPosted();
    pass({ ...value, item: { ...value.item!, branch: "feature/x" } });
    expect(notices()).toHaveLength(1);
    // An unattributed post with findings is a new, different judgment.
    pass(
      town({
        head: SHA.reviewed,
        posts: [
          open(SHA.reviewed),
          confirm("rev-astra", SHA.reviewed),
          confirm("rev-opus", SHA.reviewed),
          { reviewer: null, commit: SHA.reviewed, result: "1 new" },
        ],
        item: { branch: "feature/x" },
      }),
      NOW + 120_000,
    );
    expect(notices().length).toBeGreaterThanOrEqual(2);
    expect(notices().at(-1)!.join(" ")).toContain("Unattributed RESULT");
  });

  test("a refused prompt retries and tells the owner once", () => {
    refuse.add("prompt");
    for (let minute = 0; minute < 6; minute++)
      pass(trioPosted(), NOW + minute * 60_000);
    expect(prompts()).toHaveLength(6);
    expect(
      notices().filter((argv) => argv.join(" ").includes("Can't reach towncx")),
    ).toHaveLength(1);
  });

  test("a notification Herdr couldn't show is tried again", () => {
    const ready = town({
      head: SHA.reviewed,
      posts: ["rev2", "rev-astra", "rev-opus"].map((name) =>
        confirm(name, SHA.reviewed),
      ),
    });
    refuse.add("notification");
    pass(ready);
    expect(actionsIn(crew, ["pending"])).toHaveLength(1);
    refuse.clear();
    pass(ready, NOW + 60_000);
    pass(ready, NOW + 120_000);
    expect(notices()).toHaveLength(2);
    expect(actionsIn(crew, ["pending"])).toEqual([]);
  });

  test("a scoped pass leaves other PRs' queued steps alone", () => {
    live = live.map((seat) =>
      seat.name === "towncx" ? { ...seat, focused: true } : seat,
    );
    pass(trioPosted());
    live = live.map((seat) =>
      seat.name === "towncx" ? { ...seat, focused: false } : seat,
    );
    const other = { ...town({ head: SHA.other, posts: [] }), number: 8 };
    passOver([other], NOW + 60_000, { prs: [8] });
    expect(prompts()).toHaveLength(0);
    pass(trioPosted(), NOW + 120_000);
    expect(prompts()).toHaveLength(1);
  });

  test("a second process acting at the same time sends nothing twice", () => {
    const file = join(root, "shared.sqlite");
    const first = openCrewStore(file);
    const second = openCrewStore(file);
    const firstLock = openLock(join(root, "shared.lock"), 50);
    const secondLock = openLock(join(root, "shared.lock"), 50);
    let overlapped: unknown = null;
    onPrompt = () => {
      onPrompt = null;
      try {
        passOver([trioPosted()], NOW, { db: second, lock: secondLock });
      } catch (error) {
        overlapped = error;
      }
    };
    passOver([trioPosted()], NOW, { db: first, lock: firstLock });
    expect(String(overlapped)).toContain("locked");
    passOver([trioPosted()], NOW + 60_000, { db: second, lock: secondLock });
    expect(prompts()).toHaveLength(1);
    first.close();
    second.close();
    firstLock.close();
    secondLock.close();
  });

  test("a crash after a prompt keeps it sent; the next pass doesn't resend it", () => {
    const review = { ...town({ head: SHA.other, posts: [] }), number: 8 };
    const launch = deps.spawn;
    deps.spawn = () => {
      throw new Error("watcher stopped");
    };
    expect(() => passOver([trioPosted(), review])).toThrow("watcher stopped");
    deps.spawn = launch;
    expect(prompts()).toHaveLength(1);
    passOver([trioPosted(), review], NOW + 60_000);
    expect(prompts()).toHaveLength(1);
    // The interrupted launch keeps its slot until it times out; the other
    // two reviewers start now.
    expect(spawned).toHaveLength(2);
    expect(activeRuns(crew)).toHaveLength(3);
  });

  test("a PR closed and reopened on the same head is picked up again", () => {
    pass(town({ head: SHA.reviewed, posts: [] }));
    expect(spawned).toHaveLength(3);
    passOver([], NOW + 60_000);
    expect(actionsIn(crew, ["pending", "running"])).toEqual([]);
    pass(town({ head: SHA.reviewed, posts: [] }), NOW + 120_000);
    expect(spawned).toHaveLength(6);
  });

  test("an owner notice Herdr couldn't show is retried for every kind", () => {
    const value = trioPosted();
    const desk = {
      ...value,
      item: { ...value.item!, branch: "agent/firstmate-kit" },
    };
    refuse.add("notification");
    pass(desk);
    refuse.clear();
    pass(desk, NOW + 60_000);
    pass(desk, NOW + 120_000);
    const waits = notices().filter((argv) =>
      argv.join(" ").includes("waits for firstmate (never prompted)"),
    );
    expect(waits).toHaveLength(2);
    expect(
      actionsIn(crew, ["pending"]).filter((entry) => entry.target === "owner"),
    ).toEqual([]);
  });

  test("a pass reads GitHub only while it holds the lock", () => {
    const shared = openLock(join(root, "reads.lock"), 50);
    const other = openLock(join(root, "reads.lock"), 0);
    let blocked = false;
    crewPass({
      judge: () => {
        try {
          other.exec("BEGIN IMMEDIATE");
          other.exec("ROLLBACK");
        } catch {
          blocked = true;
        }
        return { verdicts: [], inputs: [] };
      },
      crew,
      lock: shared,
      configPath,
      dir,
      prs: [],
      dryRun: false,
      now: NOW,
      deps,
      worker: ["bun", "crew.ts"],
    });
    expect(blocked).toBe(true);
    shared.close();
    other.close();
  });

  test("a seat notice is dropped once the seat takes the prompt", () => {
    const named = join(root, "named.json");
    writeFileSync(
      named,
      JSON.stringify({
        ...config,
        roster: ROSTER,
        crew: { ...SETTINGS, authors: { "7": "towncx" } },
      }),
    );
    const at = (now: number) =>
      crewPass({
        judge: () => ({
          verdicts: [evaluate(trioPosted(), config, NOW)],
          inputs: [trioPosted()],
        }),
        crew,
        lock,
        configPath: named,
        dir,
        prs: [],
        dryRun: false,
        now,
        deps,
        worker: ["bun", "crew.ts"],
      });
    const seated = live;
    live = live.filter((seat) => seat.name !== "towncx");
    refuse.add("notification");
    at(NOW);
    refuse.clear();
    live = seated;
    at(NOW + 60_000);
    expect(prompts()).toHaveLength(1);
    const waits = notices().filter((argv) =>
      argv.join(" ").includes("waits for towncx"),
    );
    // Only the attempt Herdr refused; the stale notice never goes out.
    expect(waits).toHaveLength(1);
    expect(
      actionsIn(crew, ["pending"]).filter((entry) => entry.target === "owner"),
    ).toEqual([]);
  });

  test("a seat notice from an older store is dropped once its cause clears", () => {
    const named = join(root, "legacy.json");
    writeFileSync(
      named,
      JSON.stringify({
        ...config,
        roster: ROSTER,
        crew: { ...SETTINGS, authors: { "7": "towncx" } },
      }),
    );
    const at = (now: number) =>
      crewPass({
        judge: () => ({
          verdicts: [evaluate(trioPosted(), config, NOW)],
          inputs: [trioPosted()],
        }),
        crew,
        lock,
        configPath: named,
        dir,
        prs: [],
        dryRun: false,
        now,
        deps,
        worker: ["bun", "crew.ts"],
      });
    const seated = live;
    live = live.filter((seat) => seat.name !== "towncx");
    refuse.add("notification");
    at(NOW);
    // Rewrite the notice as an older watcher stored it: `<parent>|waits`.
    const [fresh] = actionsIn(crew, ["pending"]).filter((entry) =>
      entry.key.includes("|waits-"),
    );
    crew
      .query("UPDATE action SET key = ? WHERE key = ?")
      .run(fresh!.key.replace(/\|waits-.*$/u, "|waits"), fresh!.key);
    refuse.clear();
    live = seated;
    at(NOW + 60_000);
    expect(prompts()).toHaveLength(1);
    expect(
      notices().filter((argv) => argv.join(" ").includes("waits for towncx")),
    ).toHaveLength(1);
    expect(
      actionsIn(crew, ["pending"]).filter((entry) => entry.target === "owner"),
    ).toEqual([]);
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

  test("runs each reviewer interactively, with the brief as its first message", () => {
    expect(reviewerArgv(ROSTER["rev-opus"], "brief", "s-1")).toEqual([
      "claude",
      "--model",
      "claude-opus-5-5",
      "--effort",
      "high",
      "--permission-mode",
      "auto",
      "--session-id",
      "s-1",
      "brief",
    ]);
    const codex = reviewerArgv(ROSTER.rev2, "brief", null);
    expect(codex.slice(0, 3)).toEqual(["codex", "-m", "gpt-6.1-sol"]);
    expect(codex).toContain('model_reasoning_effort="xhigh"');
    expect(codex).not.toContain("exec");
    expect(codex.at(-1)).toBe("brief");
  });

  test("reads usage and sessions from the harnesses' own files", () => {
    const message = (id: string, output: number) =>
      JSON.stringify({
        type: "assistant",
        message: {
          id,
          usage: { input_tokens: 2, output_tokens: output, cache_creation: {} },
        },
      });
    // Claude repeats a message per content block; each counts once.
    expect(
      claudeUsage(
        [message("m1", 5), message("m1", 5), message("m2", 7), "{"].join("\n"),
      ),
    ).toEqual({ input_tokens: 4, output_tokens: 12 });
    expect(claudeUsage("")).toBeNull();
    const count = (output: number) =>
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { input_tokens: 10, output_tokens: output },
          },
        },
      });
    expect(codexUsage([count(1), count(3)].join("\n"))).toEqual({
      input_tokens: 10,
      output_tokens: 3,
    });
    const meta = JSON.stringify({
      type: "session_meta",
      payload: { id: "c-1", cwd: "/x/review-7-rev2" },
    });
    expect(codexSessionOf(meta, "/x/review-7-rev2")).toBe("c-1");
    expect(codexSessionOf(meta, "/x/other")).toBeNull();
    expect(claudeTranscript("/x/.agents/review-7", "s-1", "/h")).toBe(
      "/h/projects/-x--agents-review-7/s-1.jsonl",
    );
  });
});

describe("run display", () => {
  test("quotes a command line for the pane's shell", () => {
    expect(shellLine(["bun", "/x/crew.ts", "review", "--pr", "7"])).toBe(
      "bun /x/crew.ts review --pr 7",
    );
    expect(shellLine(["echo", "it's a b"])).toBe("echo 'it'\\''s a b'");
  });

  test("reads the new pane and its tab from Herdr", () => {
    expect(
      herdrIds(
        JSON.stringify({
          result: { root_pane: { pane_id: "wP:p9" }, tab: { tab_id: "wP:t2" } },
        }),
      ),
    ).toEqual({ pane: "wP:p9", tab: "wP:t2" });
    expect(
      herdrIds(
        JSON.stringify({
          result: { pane: { pane_id: "wP:pA", tab_id: "wP:t2" } },
        }),
      ),
    ).toEqual({ pane: "wP:pA", tab: "wP:t2" });
    expect(herdrIds("nope")).toEqual({ pane: null, tab: null });
  });

  test("counts a tab Herdr no longer has as closed", () => {
    const gone = JSON.stringify({
      error: { code: "tab_not_found", message: "tab wP:t1 not found" },
    });
    expect(tabClosed({ code: 0, stdout: "", stderr: "" })).toBe(true);
    expect(tabClosed({ code: 1, stdout: "", stderr: gone })).toBe(true);
    expect(
      tabClosed({
        code: 1,
        stdout: "",
        stderr: JSON.stringify({ error: { code: "server_not_running" } }),
      }),
    ).toBe(false);
    expect(tabClosed({ code: 1, stdout: "", stderr: "tab_not_found" })).toBe(
      false,
    );
  });

  test("names a round tab after its PR and branch", () => {
    expect(roundLabel(443, "agent/crew-watcher", 2)).toBe(
      "#443 crew-watcher · r2",
    );
    expect(roundLabel(9, "batch/town-3", 1)).toBe("#9 town-3 · r1");
    expect(roundLabel(9, undefined, 1)).toBe("#9 · r1");
  });

  test("reopens a run on its own harness and model", () => {
    expect(chatArgv("claude", "s-1", "claude-opus-5-5")).toEqual([
      "claude",
      "--resume",
      "s-1",
      "--model",
      "claude-opus-5-5",
    ]);
  });
});
