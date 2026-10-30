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
import {
  afterPass,
  crewPass,
  nextPass,
  parseOptions,
  promptable,
  roundLabel,
  type Seat,
  seats,
} from "./crew";
import {
  crewCodeVersion,
  forgetGoneWatchers,
  noticeStaleWatcher,
  processStart,
  startSeat,
} from "./crew/seats";
import { runTokens, showStatus, spend, status } from "./crew/status";
import {
  type Deps,
  herdrIds,
  type Place,
  shellLine,
  tabClosed,
} from "./crew/deps";
import { doneCommand, finishFixer, fixerPrompt } from "./crew/fixer";
import { openChat, runs } from "./crew/review";
import {
  authorOf,
  busyPrs,
  type CrewSettings,
  digest,
  isOnHold,
  mergeReady,
  plan,
  SETTINGS_DEFAULTS,
} from "./crew/plan";
import {
  actionsIn,
  addAction,
  setAction,
  activeRuns,
  addRun,
  finishRun,
  getAction,
  getMeta,
  getRun,
  openCrewStore,
  openLock,
  openRounds,
  setMeta,
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
  findCodexSession,
  reviewerArgv,
  reviewerPrompt,
  seatArgv,
} from "./crew/worker";
import { config, confirm, input, NOW, SHA, type Post } from "./gate/cases";
import type { Run } from "./gate/observe";
import { evaluate, type GateInput } from "./gate/predicate";
import { openStore, recordPass } from "./gate/store";

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

describe("cadence", () => {
  const verdicts = (inputs: GateInput[]) =>
    inputs.map((value) => evaluate(value, config, NOW));
  const busy = (inputs: GateInput[], open: number[] = []) =>
    busyPrs(verdicts(inputs), inputs, SETTINGS, open);
  const trio = (head: string) =>
    ["rev2", "rev-astra", "rev-opus"].map((name) => confirm(name, head));

  test("a PR is busy while a check runs, a step is open or it is READY", () => {
    const running = {
      ...town({
        head: SHA.reviewed,
        posts: [],
        checks: [{ name: "Delivery checks", state: "pending", required: true }],
      }),
      number: 8,
    };
    const ready = {
      ...town({ head: SHA.reviewed, posts: trio(SHA.reviewed) }),
      number: 9,
    };
    const reviewing = {
      ...town({ head: SHA.reviewed, posts: [] }),
      number: 10,
    };
    const waiting = {
      ...town({ head: SHA.reviewed, posts: [open(SHA.reviewed)] }),
      number: 11,
    };
    expect(busy([running, ready, reviewing, waiting], [10])).toEqual([
      8, 9, 10,
    ]);
  });

  test("a merged, closed or out-of-scope PR is never busy", () => {
    const merged = {
      ...town({
        head: SHA.reviewed,
        posts: trio(SHA.reviewed),
        state: "MERGED",
      }),
      number: 8,
    };
    const closed = {
      ...town({ head: SHA.reviewed, posts: [], state: "CLOSED" }),
      number: 9,
    };
    const elsewhere = {
      ...input({ head: SHA.reviewed, posts: trio(SHA.reviewed), labels: [] }),
      number: 10,
    };
    expect(busy([merged, closed, elsewhere], [8, 9, 10])).toEqual([]);
  });

  test("on-hold PRs are never busy and resume when the label is removed", () => {
    const held = town({
      head: SHA.reviewed,
      posts: [],
      labels: ["pod:town", "on-hold"],
    });
    expect(isOnHold(held)).toBe(true);
    expect(busy([held], [held.number])).toEqual([]);
    const resumed = { ...held, labels: ["pod:town"] };
    expect(isOnHold(resumed)).toBe(false);
    expect(planned(resumed).map((action) => action.kind)).toEqual([
      "review",
      "review",
      "review",
    ]);
  });

  test("full passes start an interval apart, however long one takes", () => {
    const options = { interval: 300, busyInterval: 60 };
    // A pass that started at NOW and took 70 seconds: the next still
    // starts 300 seconds after NOW, not 300 seconds after it ended.
    expect(nextPass(NOW, NOW, [], options)).toEqual({
      at: NOW + 300_000,
      prs: null,
    });
  });

  test("busy PRs get their own passes between full ones", () => {
    const options = { interval: 300, busyInterval: 60 };
    expect(nextPass(NOW, NOW, [8, 9], options)).toEqual({
      at: NOW + 60_000,
      prs: [8, 9],
    });
    // The full pass comes first once it is due before the next busy one.
    expect(nextPass(NOW, NOW + 250_000, [8], options)).toEqual({
      at: NOW + 300_000,
      prs: null,
    });
    // A busy interval as long as the interval turns busy passes off.
    expect(
      nextPass(NOW, NOW, [8], { interval: 300, busyInterval: 300 }),
    ).toEqual({ at: NOW + 300_000, prs: null });
  });

  test("the watch loop goes full, busy, busy, then full on time", () => {
    const options = { interval: 300, busyInterval: 60 };
    const start = { scope: null, lastFull: 0, busy: [] };
    // A full pass at NOW finds #8 busy: the next pass reads #8 alone.
    const first = afterPass(start, NOW, [8], options);
    expect(first).toEqual({
      cadence: { scope: [8], lastFull: NOW, busy: [8] },
      at: NOW + 60_000,
    });
    // Busy passes leave the full pass's start where it was.
    const second = afterPass(first.cadence, NOW + 60_000, [8], options);
    expect(second.cadence.lastFull).toBe(NOW);
    expect(second.at).toBe(NOW + 120_000);
    // Once the full pass is due first, it comes 300 s after NOW.
    const late = afterPass(second.cadence, NOW + 250_000, [8], options);
    expect(late).toEqual({
      cadence: { scope: null, lastFull: NOW, busy: [8] },
      at: NOW + 300_000,
    });
    // That full pass, finding nothing busy, sets the next full one.
    const full = afterPass(late.cadence, NOW + 300_000, [], options);
    expect(full).toEqual({
      cadence: { scope: null, lastFull: NOW + 300_000, busy: [] },
      at: NOW + 600_000,
    });
  });

  test("a failed pass keeps its busy PRs, and a quiet busy pass ends them", () => {
    const options = { interval: 300, busyInterval: 60 };
    const busy = { scope: [8], lastFull: NOW, busy: [8] };
    expect(afterPass(busy, NOW + 60_000, null, options)).toEqual({
      cadence: { scope: [8], lastFull: NOW, busy: [8] },
      at: NOW + 120_000,
    });
    // #8 merged: the busy pass that closed its pod finds nothing busy.
    expect(afterPass(busy, NOW + 60_000, [], options)).toEqual({
      cadence: { scope: null, lastFull: NOW, busy: [] },
      at: NOW + 300_000,
    });
  });

  test("watch takes a busy interval, 60 seconds unless given", () => {
    expect(parseOptions(["watch"]).busyInterval).toBe(60);
    expect(parseOptions(["watch", "--busy-interval", "30"]).busyInterval).toBe(
      30,
    );
    // Zero would read busy PRs back to back.
    expect(() => parseOptions(["watch", "--busy-interval", "0"])).toThrow(
      "at least 1 second",
    );
  });
});

describe("plan", () => {
  test("an on-hold label suppresses every planned action, including READY notices", () => {
    const held = town({
      head: SHA.reviewed,
      posts: [
        confirm("rev2", SHA.reviewed),
        confirm("rev-astra", SHA.reviewed),
        confirm("rev-opus", SHA.reviewed),
      ],
      labels: ["pod:town", "on-hold"],
    });
    expect(planned(held)).toEqual([]);
  });

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

  test("red CI goes to the author; reviewers read the diff regardless", () => {
    const actions = planned(
      town({
        head: SHA.reviewed,
        posts: [],
        checks: [{ name: "Delivery checks", state: "fail", required: true }],
      }),
    );
    expect(actions.map((a) => [a.kind, a.target])).toEqual([
      ["ci", "towncx"],
      ["review", "rev2"],
      ["review", "rev-astra"],
      ["review", "rev-opus"],
    ]);
  });

  test("a pushed head is reviewed while its checks still run", () => {
    const pushed = town({
      head: SHA.fixed,
      posts: [
        open(SHA.reviewed),
        confirm("rev-astra", SHA.reviewed),
        confirm("rev-opus", SHA.reviewed),
      ],
      checks: [{ name: "Delivery checks", state: "pending", required: true }],
    });
    expect(planned(pushed).map((a) => [a.kind, a.target, a.since])).toEqual([
      ["confirm", "rev2", SHA.reviewed],
      ["confirm", "rev-astra", SHA.reviewed],
      ["confirm", "rev-opus", SHA.reviewed],
    ]);
  });

  test("a finished head is reviewed while the owner judges a CI rerun", () => {
    // As on #468: one check went green on a rerun, another still fails.
    const rerun = town({
      head: SHA.reviewed,
      posts: [],
      checks: [
        { name: "Delivery checks", state: "pass", required: true },
        { name: "Validation scope", state: "fail", required: false },
      ],
      attempts: [
        {
          runId: 11,
          attempt: 1,
          name: "Delivery checks",
          conclusion: "failure",
          completedAt: NOW - 600_000,
        },
      ],
    });
    const kinds = planned(rerun).map((a) => [a.kind, a.target]);
    expect(kinds).toContainEqual(["review", "rev2"]);
    expect(kinds).toContainEqual(["review", "rev-astra"]);
    expect(kinds).toContainEqual(["judgment", "owner"]);
    expect(kinds).toContainEqual(["ci", "towncx"]);
    // Still running: the failure waits for the checks to finish; the
    // reviewers don't.
    const running = town({
      head: SHA.reviewed,
      posts: [],
      attempts: rerun.attempts,
      checks: [
        { name: "Delivery checks", state: "pass", required: true },
        { name: "Validation scope", state: "pending", required: false },
      ],
    });
    const whileRunning = planned(running);
    expect(whileRunning.some((a) => a.kind === "ci")).toBe(false);
    expect(whileRunning.filter((a) => a.kind === "review")).toHaveLength(3);
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
    expect(actions.some((a) => a.kind === "ci")).toBe(false);
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
  let output: string[];
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
  // What `git worktree list --porcelain`, `status` and `rev-parse` report.
  let worktrees: string;
  let dirty: string;
  let checkedOut: string;
  let ownerAsks: Map<
    string,
    {
      id: string;
      answer?: { text: string };
      withdrawn?: { at: number };
      dismissed?: { at: number; by: string };
    }
  >;
  let crew: ReturnType<typeof openCrewStore>;
  let lock: ReturnType<typeof openLock>;

  beforeEach(() => {
    calls = [];
    output = [];
    ownerAsks = new Map();
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
    worktrees = "";
    dirty = "";
    checkedOut = SHA.reviewed;
    live = SEATS.map((name) => ({ name, status: "idle", focused: false }));
    crew = openCrewStore(":memory:");
    lock = openLock(":memory:");
  });

  const run: Run = (argv) => {
    calls.push(argv);
    if (argv[0] === "gh" && argv.includes("--paginate"))
      return { code: 0, stdout: "[[]]", stderr: "" };
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
    if (argv[0] === "git" && argv[4] === "list")
      return { code: 0, stdout: worktrees, stderr: "" };
    if (argv[0] === "git" && argv[3] === "status")
      return { code: 0, stdout: dirty, stderr: "" };
    if (argv[0] === "git" && argv[3] === "rev-parse")
      return { code: 0, stdout: `${checkedOut}\n`, stderr: "" };
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
    if (argv[0] === "herdr-world") {
      if (refuse.has("ask"))
        return { code: 1, stdout: "", stderr: "World unavailable" };
      const verb = argv[2];
      let ask;
      if (verb === "get" || verb === "withdraw") {
        if (verb === "withdraw" && refuse.has("withdraw"))
          return {
            code: 1,
            stdout: JSON.stringify({
              ok: false,
              code: "refused",
              error: "only the original asker",
            }),
            stderr: "",
          };
        ask = argv.includes("--key")
          ? ownerAsks.get(argv[argv.indexOf("--key") + 1]!)
          : [...ownerAsks.values()].find((entry) => entry.id === argv[3]);
        if (verb === "withdraw" && ask) ask.withdrawn = { at: NOW };
      } else {
        const key = argv[argv.indexOf("--key") + 1]!;
        ask = ownerAsks.get(key);
        if (!ask || ask.withdrawn) {
          ask = { id: `q-${ownerAsks.size + 1}-${calls.length}` };
          ownerAsks.set(key, ask);
        }
      }
      return {
        code: 0,
        stdout: JSON.stringify({
          ok: Boolean(ask),
          ...(ask ? { result: ask } : { code: "not_found" }),
        }),
        stderr: "",
      };
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
    out: (line) => output.push(line),
  };
  const passOver = (
    values: GateInput[],
    now = NOW,
    options: {
      prs?: number[];
      db?: typeof crew;
      lock?: typeof lock;
      configPath?: string;
    } = {},
  ) =>
    crewPass({
      judge: () => ({
        verdicts: values.map((value) => evaluate(value, config, NOW)),
        inputs: values,
      }),
      crew: options.db ?? crew,
      lock: options.lock ?? lock,
      configPath: options.configPath ?? configPath,
      dir,
      prs: options.prs ?? [],
      dryRun: false,
      now,
      deps,
      worker: ["bun", "crew.ts"],
    });
  const pass = (value: GateInput, now = NOW) => passOver([value], now);
  const prompts = () => calls.filter((argv) => argv[2] === "prompt");
  const notices = () =>
    calls.filter(
      (argv) =>
        argv[0] === "herdr-world" &&
        argv[1] === "ask" &&
        argv[2] !== "get" &&
        argv[2] !== "withdraw",
    );

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

  describe("fixers", () => {
    // The author seat has a roster model, so a fixer can run on it.
    const fixerConfig = join(root, "fixer.json");
    writeFileSync(
      fixerConfig,
      JSON.stringify({
        ...config,
        roster: { ...ROSTER, towncx: { model: "claude-opus-5-5" } },
        crew: SETTINGS,
      }),
    );
    const worktree = join(root, "repo", ".agents", "worktrees", "towncx-12");
    const checkOut = () => {
      worktrees = `worktree ${join(root, "repo")}\nHEAD ${SHA.fixed}\nbranch refs/heads/main\n\nworktree ${worktree}\nHEAD ${SHA.reviewed}\nbranch refs/heads/agent/towncx-12-plates\n\n`;
    };
    const author = (status: string) => {
      live = live.map((seat) =>
        seat.name === "towncx" ? { ...seat, status } : seat,
      );
    };
    // The author's latest prompt, one for all of `prs`: what it is on.
    const prompted = (prs: number[], at = NOW - 60_000) => {
      for (const pr of prs) {
        const key = `earlier-${pr}-${at}`;
        addAction(
          crew,
          {
            key,
            pr,
            head: SHA.reviewed,
            kind: "ci",
            target: "towncx",
            text: `ACT #${pr} ci`,
          },
          at,
        );
        setAction(crew, key, "sent", at);
      }
    };
    // Busy on PR 8, with PR 7's worktree clean at its head.
    const busyElsewhere = (status = "working") => {
      author(status);
      prompted([8]);
      checkOut();
    };
    const findings = (
      head = SHA.reviewed,
      checks: Parameters<typeof town>[0]["checks"] = [],
    ) =>
      town({
        head,
        posts: [
          open(SHA.reviewed),
          confirm("rev-astra", SHA.reviewed),
          confirm("rev-opus", SHA.reviewed),
        ],
        checks,
      });
    const passFixer = (value: GateInput, now = NOW) =>
      passOver([value], now, { configPath: fixerConfig });
    const fixes = () => spawned.filter((argv) => argv[2] === "fix");

    test("a busy author's fix goes to one fresh fixer in the PR's worktree", () => {
      busyElsewhere();
      passFixer(findings());
      expect(prompts()).toEqual([]);
      expect(fixes()).toEqual([
        [
          "bun",
          "crew.ts",
          "fix",
          "--pr",
          "7",
          "--author",
          "towncx",
          "--head",
          SHA.reviewed,
          "--run",
          "1",
        ],
      ]);
      expect(places[0]!.title).toBe("towncx fixer");
      expect(getRun(crew, 1)).toMatchObject({
        reviewer: "towncx",
        cwd: worktree,
      });
      const [step] = actionsIn(crew, ["running"]);
      expect(step).toMatchObject({
        kind: "fix",
        target: "towncx",
        detail: "run 1",
      });
      // One fixer at a time: later passes start no second one, and a new
      // step on the PR waits for it rather than going to the author.
      author("idle");
      passFixer(
        findings(SHA.reviewed, [
          { name: "Delivery checks", state: "fail", required: true },
        ]),
        NOW + 60_000,
      );
      expect(fixes()).toHaveLength(1);
      expect(prompts()).toEqual([]);
      expect(actionsIn(crew, ["pending"]).map((a) => a.kind)).toEqual(["ci"]);
      // Its push ends its job: the run finishes with its usage and its
      // session stays open as a chat; review waits for replies and quiet.
      checkedOut = SHA.fixed;
      passFixer(findings(SHA.fixed), NOW + 120_000);
      expect(getRun(crew, 1)).toMatchObject({
        exitCode: 0,
        finishedAt: NOW + 120_000,
        usage: '{"output_tokens":1}',
      });
      expect(killed).toEqual([]);
      expect(getAction(crew, step!.key)!.state).toBe("superseded");
      expect(spawned.slice(1)).toEqual([]);
    });

    test("a blocked author's steps go to a fixer without asking the owner", () => {
      busyElsewhere("blocked");
      passFixer(findings());
      expect(fixes()).toHaveLength(1);
      expect(notices()).toEqual([]);
    });

    test("the step waits for the author when a fixer could clash with them", () => {
      const waits = (setup: () => void, configPath = fixerConfig) => {
        crew = openCrewStore(":memory:");
        spawned = [];
        busyElsewhere();
        setup();
        passOver([findings()], NOW, { configPath });
        expect(fixes()).toEqual([]);
        expect(
          actionsIn(crew, ["pending"])
            .filter((a) => a.pr === 7)
            .map((a) => a.detail),
        ).toEqual(["working"]);
      };
      // The latest prompt was about this PR, alone or with another one
      // the author may have started on first: it may be on this one now.
      waits(() => prompted([7], NOW - 30_000));
      waits(() => prompted([7, 8], NOW - 30_000));
      // Nothing shows what the author is working on.
      waits(() => {
        crew = openCrewStore(":memory:");
      });
      // Every run slot is taken.
      const full = join(root, "fixer-full.json");
      writeFileSync(
        full,
        JSON.stringify({
          ...config,
          roster: { ...ROSTER, towncx: { model: "claude-opus-5-5" } },
          crew: { ...SETTINGS, maxRuns: 1 },
        }),
      );
      waits(
        () =>
          addRun(
            crew,
            {
              actionKey: "other",
              reviewer: "rev2",
              pr: 9,
              head: SHA.reviewed,
              log: "x",
            },
            NOW,
          ),
        full,
      );
      // Work in progress in the worktree, or a worktree off the head.
      waits(() => {
        dirty = " M web/src/App.tsx\n";
      });
      waits(() => {
        dirty = "";
        checkedOut = SHA.fixed;
      });
      // No worktree has the branch.
      waits(() => {
        checkedOut = SHA.reviewed;
        worktrees = "";
      });
      // An idle author takes the step themselves.
      crew = openCrewStore(":memory:");
      spawned = [];
      author("idle");
      checkOut();
      passFixer(findings());
      expect(fixes()).toEqual([]);
      expect(prompts()).toHaveLength(1);
    });

    test("a fixer that ends without pushing leaves the step to the author", () => {
      busyElsewhere();
      passFixer(findings());
      // Quit cleanly, as when the owner closes its session.
      finishRun(crew, 1, 0, null, NOW + 1000);
      passFixer(findings(), NOW + 60_000);
      // A head gets one fixer; the step waits for the author.
      expect(fixes()).toHaveLength(1);
      expect(actionsIn(crew, ["pending"]).map((a) => a.kind)).toEqual(["fix"]);
      author("idle");
      passFixer(findings(), NOW + 120_000);
      expect(prompts()).toHaveLength(1);
      expect(prompts()[0]![4]).toStartWith("[crew -> towncx] ACT #7 fix @");
    });

    test("a fixer that says it is done without pushing frees its slot and the PR", () => {
      busyElsewhere();
      passFixer(findings());
      // It reran a flaky job: no push, so the head doesn't move.
      finishFixer(crew, 1, NOW + 1000, deps);
      expect(getRun(crew, 1)).toMatchObject({ exitCode: 0 });
      expect(actionsIn(crew, ["done"]).map((a) => a.kind)).toEqual(["fix"]);
      expect(activeRuns(crew)).toEqual([]);
      // A later step on the same head reaches the idle author at once.
      author("idle");
      passFixer(
        findings(SHA.reviewed, [
          { name: "Delivery checks", state: "fail", required: true },
        ]),
        NOW + 60_000,
      );
      expect(prompts().map((argv) => argv[4]!.slice(0, 26))).toEqual([
        "[crew -> towncx] ACT #7 ci",
      ]);
    });

    test("a fixer overtaken by another push, a merge or a close is stopped", () => {
      // Another push: the worktree is still at the old head.
      busyElsewhere();
      passFixer(findings());
      passFixer(findings(SHA.fixed), NOW + 60_000);
      expect(killed).toEqual([1001]);
      expect(getRun(crew, 1)!.exitCode).toBe(-15);
      // A merge: the PR leaves the open list. This run has no pane to
      // close with its round, so only its pid stops it.
      crew = openCrewStore(":memory:");
      spawned = [];
      killed = [];
      busyElsewhere();
      passFixer(findings());
      passOver([], NOW + 60_000, { configPath: fixerConfig });
      expect(killed).toEqual([1001]);
      expect(activeRuns(crew)).toEqual([]);
    });

    test("a fixer reopens as a chat in its PR's worktree, which it never removes", () => {
      busyElsewhere();
      mkdirSync(worktree, { recursive: true });
      passFixer(findings());
      setRunSession(crew, 1, "claude", "claude-opus-5-5", "session-1");
      finishRun(crew, 1, 0, null, NOW + 1000);
      dead.add(getRun(crew, 1)!.pid!);
      openChat(crew, { prs: [], run: 1 }, dir, lock, deps);
      expect(opened).toEqual([
        {
          line: "claude --resume session-1 --model claude-opus-5-5",
          cwd: worktree,
          label: "#7 towncx fixer · chat",
        },
      ]);
      expect(
        calls.some((argv) => argv[3] === "worktree" && argv[4] !== "list"),
      ).toBe(false);
      // It waits for a pass that holds the lock, which may close the round.
      const path = join(root, "fixer-open.lock");
      const held = openLock(path, 0);
      const opener = openLock(path, 0);
      held.exec("BEGIN IMMEDIATE");
      expect(() =>
        openChat(crew, { prs: [], run: 1 }, dir, opener, deps),
      ).toThrow();
      expect(opened).toHaveLength(1);
      held.exec("ROLLBACK");
      held.close();
      opener.close();
    });
  });

  test("a held or out-of-scope PR's waiting steps retire and return on release", () => {
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
    const waiting = () =>
      actionsIn(crew, ["pending"]).filter((entry) => entry.pr === value.number);
    expect(waiting().map((entry) => entry.kind)).toEqual(["fix"]);
    pass({ ...value, labels: ["pod:town", "on-hold"] }, NOW + 60_000);
    expect(waiting()).toEqual([]);
    expect(readFileSync(join(dir, "feed.log"), "utf8")).toContain(
      "retired fix towncx: on hold",
    );
    pass(value, NOW + 120_000);
    expect(waiting().map((entry) => entry.kind)).toEqual(["fix"]);
    pass({ ...value, labels: ["pod:chat"] }, NOW + 180_000);
    expect(waiting()).toEqual([]);
    live = live.map((seat) =>
      seat.name === "towncx" ? { ...seat, status: "idle" } : seat,
    );
    pass(value, NOW + 240_000);
    expect(prompts()).toHaveLength(1);
  });

  const statuses = () =>
    calls
      .filter((argv) => argv[0] === "gh" && argv[4]?.includes("/statuses/"))
      .map((argv) => ({
        sha: argv[4]!.split("/").pop(),
        state: argv[6]!.slice(6),
        context: argv[8]!.slice(8),
        description: argv[10]!.slice(12),
      }));
  const comments = () =>
    calls.filter((argv) => argv[0] === "gh" && argv[4]?.endsWith("/comments"));
  const trio = (head: string) =>
    ["rev2", "rev-astra", "rev-opus"].map((name) => confirm(name, head));

  test("marks a reviewed READY head merge-ready once; a new head carries no mark", () => {
    const ready = town({ head: SHA.reviewed, posts: trio(SHA.reviewed) });
    pass(ready);
    pass(ready, NOW + 60_000);
    expect(statuses()).toEqual([
      {
        sha: SHA.reviewed,
        state: "success",
        context: "crew/merge-ready",
        description: `READY at ${SHA.reviewed.slice(0, 7)}; confirmed by rev2, rev-astra, rev-opus`,
      },
    ]);
    // A push leaves the mark on the old head; the new one isn't marked.
    pass(
      town({
        head: SHA.fixed,
        commits: [SHA.reviewed, SHA.fixed],
        posts: trio(SHA.reviewed),
      }),
      NOW + 120_000,
    );
    expect(statuses()).toHaveLength(1);
    // Held on the same head: the mark is taken back.
    pass({ ...ready, labels: ["pod:town", "on-hold"] }, NOW + 180_000);
    expect(statuses().at(-1)).toMatchObject({
      sha: SHA.reviewed,
      state: "pending",
      context: "crew/merge-ready",
    });
  });

  test("a PR waiting on the owner is marked and signed once, and unmarked when it clears", () => {
    const rerun = town({
      head: SHA.reviewed,
      posts: trio(SHA.reviewed),
      attempts: [
        {
          runId: 11,
          attempt: 1,
          name: "Delivery checks",
          conclusion: "failure",
          completedAt: NOW - 600_000,
        },
      ],
    });
    pass(rerun);
    pass(rerun, NOW + 60_000);
    expect(statuses()).toEqual([
      expect.objectContaining({
        state: "pending",
        context: "crew/needs-owner",
        description: expect.stringContaining(
          "Needs the owner: Delivery checks: 1 failed attempt retained",
        ),
      }),
    ]);
    expect(comments()).toHaveLength(1);
    const body = comments()[0]!.at(-1)!;
    expect(body).toStartWith("body=[crew] NEEDS-OWNER #7 at ");
    // The owner judged it; the rerun is accepted, so the PR is READY.
    const judged = town({ head: SHA.reviewed, posts: trio(SHA.reviewed) });
    pass(judged, NOW + 120_000);
    expect(statuses().slice(1)).toEqual([
      expect.objectContaining({
        state: "success",
        context: "crew/merge-ready",
      }),
      expect.objectContaining({
        state: "success",
        context: "crew/needs-owner",
        description: "Nothing waits on the owner",
      }),
    ]);
    expect(comments()).toHaveLength(1);
  });

  test("a head marked again after a hold, and one revisited after a push, keep true marks", () => {
    const ready = town({ head: SHA.reviewed, posts: trio(SHA.reviewed) });
    pass(ready);
    pass({ ...ready, labels: ["pod:town", "on-hold"] }, NOW + 60_000);
    pass(ready, NOW + 120_000);
    expect(
      statuses().map((entry) => [entry.sha, entry.context, entry.state]),
    ).toEqual([
      [SHA.reviewed, "crew/merge-ready", "success"],
      [SHA.reviewed, "crew/merge-ready", "pending"],
      [SHA.reviewed, "crew/merge-ready", "success"],
    ]);
    // A is marked, then B, then the branch goes back to A, held: A's mark
    // is taken back even though B was marked last.
    const fixed = town({
      head: SHA.fixed,
      commits: [SHA.reviewed, SHA.fixed],
      posts: trio(SHA.fixed),
    });
    pass(fixed, NOW + 180_000);
    pass({ ...ready, labels: ["pod:town", "on-hold"] }, NOW + 240_000);
    expect(statuses().at(-1)).toMatchObject({
      sha: SHA.reviewed,
      context: "crew/merge-ready",
      state: "pending",
    });
  });

  test("a reviewer overdue while its PR is parked asks nothing of the owner", () => {
    const fresh = town({ head: SHA.reviewed, posts: [] });
    for (const parkedValue of [
      { ...fresh, labels: ["pod:town", "on-hold"] },
      { ...fresh, hold: { reason: "owner repro", at: NOW } },
      { ...fresh, labels: ["pod:chat"] },
    ]) {
      crew = openCrewStore(":memory:");
      calls = [];
      pass(fresh);
      expect(activeRuns(crew).length).toBeGreaterThan(0);
      pass(parkedValue, NOW + 60_000);
      pass(parkedValue, NOW + 91 * 60_000);
      pass(parkedValue, NOW + 92 * 60_000);
      const owner = actionsIn(crew, ["pending", "sent"]).filter(
        (entry) => entry.target === "owner" || entry.target === "github",
      );
      expect(owner).toEqual([]);
      expect(
        statuses().some(
          (entry) =>
            entry.context === "crew/needs-owner" && entry.state === "pending",
        ),
      ).toBe(false);
      // The reviewers keep working.
      expect(activeRuns(crew).length).toBeGreaterThan(0);
    }
  });

  test("a dry run prints the marks a real pass would set", () => {
    // The author is a seat the watcher never prompts: the owner is told,
    // and the head marked, by a seat notice rather than a planned judgment.
    const value = town({
      head: SHA.reviewed,
      posts: [
        open(SHA.reviewed),
        confirm("rev-astra", SHA.reviewed),
        confirm("rev-opus", SHA.reviewed),
      ],
      item: { branch: "agent/firstmate-12-plates" },
    });
    pass(value);
    expect(
      statuses().map((entry) => [entry.context, entry.state]),
    ).toContainEqual(["crew/needs-owner", "pending"]);
    const printed: string[] = [];
    crewPass({
      judge: () => ({
        verdicts: [evaluate(value, config, NOW)],
        inputs: [value],
      }),
      crew,
      lock,
      configPath,
      dir,
      prs: [],
      dryRun: true,
      now: NOW + 60_000,
      deps: { ...deps, out: (line) => printed.push(line) },
      worker: ["bun", "crew.ts"],
    });
    // The seat still can't be prompted, so the owner's mark stays as it is.
    expect(printed.filter((line) => line.includes("crew/needs-owner"))).toEqual(
      [],
    );
  });

  test("a READY PR with no finished review is never merge-ready", () => {
    expect(
      mergeReady({
        number: 7,
        head: SHA.reviewed,
        state: "READY",
        conditions: [{ id: "checks", state: "met", detail: "" }],
        notes: [],
      } as unknown as Parameters<typeof mergeReady>[0]),
    ).toBe(false);
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
    expect(notices()[0]!.join(" ")).toContain("READY #7");
    expect(prompts()).toHaveLength(0);
  });

  const ready = (head = SHA.reviewed) =>
    town({
      head,
      posts: ["rev2", "rev-astra", "rev-opus"].map((name) =>
        confirm(name, head),
      ),
    });

  test("an owner answer is read back to the watcher's own pane once", () => {
    pass(ready());
    const ask = [...ownerAsks.values()][0]!;
    ask.answer = { text: "Wait for the other change" };
    pass(ready(), NOW + 60_000);
    pass(ready(), NOW + 120_000);
    expect(notices()).toHaveLength(1);
    expect(
      output.filter((line) => line.includes("owner answered")),
    ).toHaveLength(1);
    expect(output.join(" ")).toContain("Wait for the other change");
    expect(calls.some((argv) => argv[1] === "notification")).toBe(false);
  });

  test("an answer arriving before cause withdrawal is still read once", () => {
    pass(ready());
    [...ownerAsks.values()][0]!.answer = { text: "Already merged" };
    passOver([], NOW + 60_000);
    passOver([], NOW + 120_000);
    expect(
      output.filter((line) => line.includes("Already merged")),
    ).toHaveLength(1);
  });

  test("a sent ask withdraws on same-head cause clearing and reopens only on recurrence", () => {
    pass(ready());
    const first = [...ownerAsks.values()][0]!;
    pass(trioPosted(), NOW + 60_000);
    expect(first.withdrawn).toBeDefined();
    pass(ready(), NOW + 120_000);
    expect(notices()).toHaveLength(2);
    expect([...ownerAsks.values()][0]!.id).not.toBe(first.id);
  });

  test("a crash after World persisted an ask retries under the same cause key", () => {
    const original = deps.run;
    let crash = true;
    deps.run = (argv) => {
      const result = original(argv);
      if (crash && argv[0] === "herdr-world" && argv.includes("--key")) {
        crash = false;
        throw new Error("watcher stopped after recording ask");
      }
      return result;
    };
    try {
      expect(() => pass(ready())).toThrow("watcher stopped");
      pass(ready(), NOW + 60_000);
      expect(ownerAsks.size).toBe(1);
    } finally {
      deps.run = original;
    }
  });

  for (const clearing of ["closed", "held", "not-ready"]) {
    test(`an unreceipted persisted ask is recovered when its cause becomes ${clearing}`, () => {
      const original = deps.run;
      let lost = true;
      deps.run = (argv) => {
        const result = original(argv);
        if (
          lost &&
          argv[0] === "herdr-world" &&
          argv[2] !== "withdraw" &&
          argv[2] !== "get"
        ) {
          lost = false;
          return {
            code: 1,
            stdout: "",
            stderr: "reply lost after persistence",
          };
        }
        return result;
      };
      try {
        pass(ready());
        const ask = [...ownerAsks.values()][0]!;
        ask.answer = { text: "Cleared decision" };
        const values =
          clearing === "closed"
            ? []
            : clearing === "held"
              ? [{ ...ready(), labels: ["pod:town", "on-hold"] }]
              : [trioPosted()];
        passOver(values, NOW + 60_000);
        passOver(values, NOW + 120_000);
        expect(ask.withdrawn).toBeDefined();
        expect(notices()).toHaveLength(1);
        expect(
          output.filter((line) => line.includes("Cleared decision")),
        ).toHaveLength(1);
      } finally {
        deps.run = original;
      }
    });
  }

  for (const acknowledged of [false, true]) {
    for (const outcome of ["lost reply", "crash", "not delivered"]) {
      test(`withdrawal ${outcome} re-arms a recurring cause (answer read: ${acknowledged})`, () => {
        pass(ready());
        const first = [...ownerAsks.values()][0]!;
        const answerText = `Decision before withdrawal ${outcome}`;
        if (acknowledged) {
          first.answer = { text: answerText };
          pass(ready(), NOW + 30_000);
        }
        const original = deps.run;
        let lost = true;
        deps.run = (argv) => {
          if (
            lost &&
            outcome === "not delivered" &&
            argv[0] === "herdr-world" &&
            argv[2] === "withdraw"
          ) {
            lost = false;
            calls.push(argv);
            return {
              code: 1,
              stdout: "",
              stderr: "World unavailable before withdrawal",
            };
          }
          const result = original(argv);
          if (lost && argv[0] === "herdr-world" && argv[2] === "withdraw") {
            lost = false;
            if (outcome === "crash")
              throw new Error("withdrawal process stopped");
            return { code: 1, stdout: "", stderr: "withdrawal reply lost" };
          }
          return result;
        };
        try {
          if (outcome === "crash")
            expect(() => pass(trioPosted(), NOW + 60_000)).toThrow(
              "withdrawal process stopped",
            );
          else pass(trioPosted(), NOW + 60_000);
          if (outcome === "not delivered")
            expect(first.withdrawn).toBeUndefined();
          else expect(first.withdrawn).toBeDefined();
          pass(ready(), NOW + 120_000);
          pass(ready(), NOW + 180_000);
          expect(notices()).toHaveLength(2);
          const current = [...ownerAsks.values()][0]!;
          expect(current.id).not.toBe(first.id);
          expect(current.withdrawn).toBeUndefined();
          if (acknowledged) {
            expect(
              output.filter((line) => line.includes(answerText)),
            ).toHaveLength(1);
            expect(
              readFileSync(join(dir, "feed.log"), "utf8")
                .split("\n")
                .filter((line) => line.includes(answerText)),
            ).toHaveLength(1);
          }
        } finally {
          deps.run = original;
        }
      });
    }
  }

  test("a lost reply while recreating a cause still withdraws the new ask", () => {
    pass(ready());
    const first = [...ownerAsks.values()][0]!;
    first.answer = { text: "First decision" };
    pass(ready(), NOW + 30_000);
    pass(trioPosted(), NOW + 60_000);
    const original = deps.run;
    let lost = true;
    deps.run = (argv) => {
      const result = original(argv);
      if (
        lost &&
        argv[0] === "herdr-world" &&
        argv[2] !== "withdraw" &&
        argv[2] !== "get"
      ) {
        lost = false;
        return { code: 1, stdout: "", stderr: "creation reply lost" };
      }
      return result;
    };
    try {
      pass(ready(), NOW + 120_000);
      const current = [...ownerAsks.values()][0]!;
      expect(current.id).not.toBe(first.id);
      current.answer = { text: "Second decision" };
      pass(trioPosted(), NOW + 180_000);
      pass(trioPosted(), NOW + 240_000);
      expect(current.withdrawn).toBeDefined();
      expect(
        output.filter((line) => line.includes("First decision")),
      ).toHaveLength(1);
      expect(
        output.filter((line) => line.includes("Second decision")),
      ).toHaveLength(1);
    } finally {
      deps.run = original;
    }
  });

  for (const clearing of ["new head", "held", "out of scope"]) {
    test(`a failed recreation followed by ${clearing} preserves the acknowledged receipt`, () => {
      pass(ready());
      const first = [...ownerAsks.values()][0]!;
      const key = actionsIn(crew, ["sent"]).find(
        (entry) => entry.target === "owner",
      )!.key;
      const answerText = `Only once after ${clearing}`;
      first.answer = { text: answerText };
      pass(ready(), NOW + 30_000);
      pass(trioPosted(), NOW + 60_000);
      refuse.add("ask");
      pass(ready(), NOW + 120_000);
      refuse.delete("ask");
      const cleared =
        clearing === "new head"
          ? ready(SHA.fixed)
          : {
              ...ready(),
              labels:
                clearing === "held" ? ["pod:town", "on-hold"] : ["pod:chat"],
            };
      pass(cleared, NOW + 180_000);
      pass(cleared, NOW + 240_000);
      expect(output.filter((line) => line.includes(answerText))).toHaveLength(
        1,
      );
      expect(
        readFileSync(join(dir, "feed.log"), "utf8")
          .split("\n")
          .filter((line) => line.includes(answerText)),
      ).toHaveLength(1);
      expect(JSON.parse(getAction(crew, key)!.detail!)).toMatchObject({
        ask: first.id,
        closed: true,
        retired: true,
      });
    });
  }

  for (const detail of [null, "on hold"]) {
    test(`legacy superseded owner notices without receipts are silent (${detail})`, () => {
      const entry = {
        key: `legacy-owner-${detail}`,
        pr: 7,
        head: SHA.reviewed,
        kind: "ready" as const,
        target: "owner",
        text: `Legacy notice ${detail}`,
      };
      addAction(crew, entry, NOW);
      setAction(crew, entry.key, "superseded", NOW, detail);
      const before = existsSync(join(dir, "feed.log"))
        ? readFileSync(join(dir, "feed.log"), "utf8").length
        : 0;
      passOver([], NOW + 60_000);
      passOver([], NOW + 120_000);
      expect(calls.filter((argv) => argv[0] === "herdr-world")).toEqual([]);
      const after = existsSync(join(dir, "feed.log"))
        ? readFileSync(join(dir, "feed.log"), "utf8").slice(before)
        : "";
      expect(after).not.toContain(entry.text);
      expect(getAction(crew, entry.key)!.detail).toBe(detail);
    });
  }

  test("keyed cleanup with no matching occupant does not claim to withdraw the old question", () => {
    const original = deps.run;
    let lost = true;
    deps.run = (argv) => {
      if (
        argv[0] === "herdr-world" &&
        argv[2] === "withdraw" &&
        argv.includes("--key")
      ) {
        calls.push(argv);
        return {
          code: 1,
          stdout: JSON.stringify({ ok: false, code: "not_found" }),
          stderr: "",
        };
      }
      const result = original(argv);
      if (lost && argv[0] === "herdr-world" && argv[2] !== "get") {
        lost = false;
        return { code: 1, stdout: "", stderr: "creation reply lost" };
      }
      return result;
    };
    try {
      pass(ready());
      const first = [...ownerAsks.values()][0]!;
      const before = readFileSync(join(dir, "feed.log"), "utf8").length;
      passOver([], NOW + 60_000);
      passOver([], NOW + 120_000);
      expect(first.withdrawn).toBeUndefined();
      const lines = readFileSync(join(dir, "feed.log"), "utf8")
        .slice(before)
        .split("\n");
      expect(
        lines.filter((line) => line.includes("no recorded ask to withdraw")),
      ).toHaveLength(1);
      expect(
        lines.filter((line) => line.includes("withdrew owner cause")),
      ).toHaveLength(0);
    } finally {
      deps.run = original;
    }
  });

  test("a process crash after creating an ask can still retire the cleared cause", () => {
    const original = deps.run;
    let crash = true;
    deps.run = (argv) => {
      const result = original(argv);
      if (
        crash &&
        argv[0] === "herdr-world" &&
        argv[2] !== "withdraw" &&
        argv[2] !== "get"
      ) {
        crash = false;
        throw new Error("watcher stopped before receipt");
      }
      return result;
    };
    try {
      expect(() => pass(ready())).toThrow("watcher stopped before receipt");
      const ask = [...ownerAsks.values()][0]!;
      passOver([], NOW + 60_000);
      passOver([], NOW + 120_000);
      expect(ask.withdrawn).toBeDefined();
      expect(notices()).toHaveLength(1);
    } finally {
      deps.run = original;
    }
  });

  test("refused cleanup of an uncertain recreation does not name its older answered ask", () => {
    pass(ready());
    const first = [...ownerAsks.values()][0]!;
    first.answer = { text: "Previous decision" };
    pass(ready(), NOW + 30_000);
    pass(trioPosted(), NOW + 60_000);
    const original = deps.run;
    let lost = true;
    deps.run = (argv) => {
      const result = original(argv);
      if (
        lost &&
        argv[0] === "herdr-world" &&
        argv[2] !== "withdraw" &&
        argv[2] !== "get"
      ) {
        lost = false;
        return { code: 1, stdout: "", stderr: "creation reply lost" };
      }
      return result;
    };
    try {
      pass(ready(), NOW + 120_000);
      const current = [...ownerAsks.values()][0]!;
      expect(current.id).not.toBe(first.id);
      refuse.add("withdraw");
      passOver([], NOW + 180_000);
      passOver([], NOW + 240_000);
      const lines = readFileSync(join(dir, "feed.log"), "utf8")
        .split("\n")
        .filter((line) => line.includes("could not withdraw"));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("its keyed ask");
      expect(lines[0]).toContain("owner to answer");
      expect(lines[0]).not.toContain(first.id);
      expect(current.withdrawn).toBeUndefined();
    } finally {
      deps.run = original;
    }
  });

  test("a refused withdrawal retires the cause and explains the leftover ask once", () => {
    pass(ready());
    const ask = [...ownerAsks.values()][0]!;
    refuse.add("withdraw");
    passOver([], NOW + 60_000);
    passOver([], NOW + 120_000);
    expect(
      calls.filter(
        (argv) => argv[0] === "herdr-world" && argv[2] === "withdraw",
      ),
    ).toHaveLength(1);
    const owner = actionsIn(crew, ["superseded"]).find(
      (entry) => entry.target === "owner",
    );
    expect(owner).toBeDefined();
    const feed = readFileSync(join(dir, "feed.log"), "utf8");
    expect(
      feed
        .split("\n")
        .filter(
          (line) =>
            line.includes("could not withdraw") &&
            line.includes(ask.id) &&
            line.includes("owner to answer"),
        ),
    ).toHaveLength(1);
    expect(ask.withdrawn).toBeUndefined();
  });

  test("a blocked author raises one owner ask in one pass and withdraws after it resumes", () => {
    live = live.map((seat) =>
      seat.name === "towncx" ? { ...seat, status: "blocked" } : seat,
    );
    pass(trioPosted());
    pass(trioPosted(), NOW + 60_000);
    expect(notices()).toHaveLength(1);
    expect(prompts()).toHaveLength(0);
    const ask = [...ownerAsks.values()][0]!;
    live = live.map((seat) => ({ ...seat, status: "idle" }));
    pass(trioPosted(), NOW + 120_000);
    expect(ask.withdrawn).toBeDefined();
  });

  test("an owner-dismissed ask is not asked again while its cause holds, and is withdrawn when it clears", () => {
    live = live.map((seat) =>
      seat.name === "towncx" ? { ...seat, status: "blocked" } : seat,
    );
    pass(trioPosted());
    const ask = [...ownerAsks.values()][0]!;
    ask.dismissed = { at: NOW, by: "owner" };
    pass(trioPosted(), NOW + 60_000);
    pass(trioPosted(), NOW + 120_000);
    expect(ownerAsks.size).toBe(1);
    const feed = readFileSync(join(dir, "feed.log"), "utf8");
    expect(
      feed
        .split("\n")
        .filter((line) => line.includes(`owner dismissed ${ask.id}`)),
    ).toHaveLength(1);
    expect(
      calls.filter((argv) => argv[0] === "herdr-world" && argv[2] === "get"),
    ).toHaveLength(1);
    live = live.map((seat) => ({ ...seat, status: "idle" }));
    pass(trioPosted(), NOW + 180_000);
    expect(ask.withdrawn).toBeDefined();
  });

  test("PR-scoped passes preserve other asks, and an on-hold label withdraws its notice", () => {
    pass(ready());
    const ask = [...ownerAsks.values()][0]!;
    passOver([], NOW + 60_000, { prs: [8] });
    expect(ask.withdrawn).toBeUndefined();
    pass({ ...ready(), labels: ["pod:town", "on-hold"] }, NOW + 120_000);
    expect(ask.withdrawn).toBeDefined();
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

  test("a new head preserves the pinned round until its reviewers post", () => {
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
    expect(activeRuns(crew)).toHaveLength(2);
    expect(activeRuns(crew).every((run) => run.head === SHA.reviewed)).toBe(
      true,
    );
    expect(killed).toEqual([]);
    expect(spawned).toHaveLength(2);
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

  test("a completed round opens a scoped round after a quiet push, keeping both tabs", () => {
    panes = true;
    pass(town({ head: SHA.reviewed, posts: [] }));
    const posts = ["rev2", "rev-astra", "rev-opus"].map((name) =>
      confirm(name, SHA.reviewed),
    );
    pass(town({ head: SHA.fixed, posts }), NOW + 60_000);
    pass(town({ head: SHA.fixed, posts }), NOW + 660_000);
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
    expect(closed).toEqual(["wP:t1"]);
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

  test("a closing PR stops a pinned reviewer by its reported pid", () => {
    panes = true;
    pass(town({ head: SHA.reviewed, posts: [] }));
    const [reported, quiet] = activeRuns(crew);
    setRunPid(crew, reported!.id, 4242);
    pass(town({ head: SHA.fixed, posts: [], state: "CLOSED" }), NOW + 60_000);
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
        ": World browser tests (4/6) has been running over 30 minutes, longer than CI takes; GitHub may have lost its status. Rerun it: gh run rerun --job 22",
    ]);
    // Reviewers started on the push and didn't wait for the check.
    expect(spawned.map((argv) => argv[6])).toEqual([
      "rev2",
      "rev-astra",
      "rev-opus",
    ]);
  });

  const jobUrl = (id: number) =>
    `https://github.com/example-org/widgets/actions/runs/${id}/job/${id}`;
  const stuckCheck = (item?: { branch: string }) =>
    town({
      head: SHA.reviewed,
      posts: [],
      checks: [
        { name: "Delivery checks", state: "pass", required: true },
        {
          name: "Browser tests",
          state: "pending",
          required: false,
          url: jobUrl(30),
        },
      ],
      ...(item ? { item } : {}),
    });

  test("an old attempt a rerun replaced is never sent to be rerun", () => {
    const replaced = town({
      head: SHA.reviewed,
      posts: [],
      checks: [
        { name: "Delivery checks", state: "pass", required: true },
        {
          name: "Browser tests",
          state: "pending",
          required: false,
          url: jobUrl(30),
        },
        {
          name: "Browser tests",
          state: "pass",
          required: false,
          url: jobUrl(12),
        },
      ],
      executions: {
        "30": { runId: 1001, workflowId: 9, runNumber: 1, attempt: 1 },
        "12": { runId: 1001, workflowId: 9, runNumber: 1, attempt: 2 },
      },
    });
    pass(replaced);
    pass(replaced, NOW + 31 * 60_000);
    expect(prompts()).toEqual([]);
    // The gate counts the newer green attempt, so reviewers start.
    expect(spawned).toHaveLength(3);
  });

  test("a failed rerun of a stuck check sends the author the failure", () => {
    const stuck = stuckCheck();
    pass(stuck);
    const rerunFailed = town({
      head: SHA.reviewed,
      posts: [],
      checks: [
        { name: "Delivery checks", state: "pass", required: true },
        {
          name: "Browser tests",
          state: "pending",
          required: false,
          url: jobUrl(30),
        },
        {
          name: "Browser tests",
          state: "fail",
          required: false,
          url: jobUrl(12),
        },
      ],
      executions: {
        "30": { runId: 1001, workflowId: 9, runNumber: 1, attempt: 1 },
        "12": { runId: 1001, workflowId: 9, runNumber: 1, attempt: 2 },
      },
    });
    pass(rerunFailed, NOW + 31 * 60_000);
    // The old pending attempt neither holds the failure back nor is sent to
    // be rerun: the author gets the failure of the attempt that counts.
    expect(prompts()).toHaveLength(1);
    expect(prompts()[0]!.at(-1)).toContain("1 failing");
    expect(prompts()[0]!.at(-1)).not.toContain("has been running");
  });

  test("same-name checks the gate can't order all count until each settles", () => {
    // Browser tests in two workflows: neither run replaced the other.
    const two = (second: "pending" | "fail") =>
      town({
        head: SHA.reviewed,
        posts: [],
        checks: [
          { name: "Delivery checks", state: "pass", required: true },
          {
            name: "Browser tests",
            state: "fail",
            required: false,
            url: jobUrl(30),
          },
          {
            name: "Browser tests",
            state: second,
            required: false,
            url: jobUrl(12),
          },
        ],
        executions: {
          "30": { runId: 1001, workflowId: 9, runNumber: 1, attempt: 1 },
          "12": { runId: 2001, workflowId: 7, runNumber: 1, attempt: 1 },
        },
      });
    pass(two("pending"));
    // The other run is still going: the author hears once it settles.
    expect(prompts().filter((argv) => argv.at(-1)!.includes(" ci @"))).toEqual(
      [],
    );
    pass(two("fail"), NOW + 60_000);
    const ci = prompts().filter((argv) => argv.at(-1)!.includes(" ci @"));
    expect(ci).toHaveLength(1);
    expect(
      getAction(
        crew,
        actionsIn(crew, ["sent"]).find((entry) => entry.kind === "ci")!.key,
      )!.key,
    ).toBe(
      `7:${SHA.reviewed}:ci:towncx:${digest([jobUrl(12), jobUrl(30)].sort().join(" "))}`,
    );
  });

  test("a stuck check on a PR with no author tells the owner once", () => {
    const orphan = stuckCheck({ branch: "agent/nobody-x" });
    pass(orphan);
    pass(orphan, NOW + 31 * 60_000);
    pass(orphan, NOW + 40 * 60_000);
    pass(orphan, NOW + 50 * 60_000);
    const stuck = notices().filter((argv) =>
      argv.join(" ").includes("Browser tests has been running over 30 minutes"),
    );
    expect(stuck).toHaveLength(1);
  });

  test("a dry run shows a stuck check the watcher has timed, and records nothing", () => {
    const seen = () =>
      crew
        .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM check_seen")
        .get()!.n;
    const dry = (now: number) =>
      crewPass({
        judge: () => ({
          verdicts: [evaluate(stuckCheck(), config, NOW)],
          inputs: [stuckCheck()],
        }),
        crew,
        lock,
        configPath,
        dir,
        prs: [],
        dryRun: true,
        now,
        deps,
        worker: ["bun", "crew.ts"],
      });
    expect(dry(NOW).filter((entry) => entry.kind === "ci")).toEqual([]);
    expect(seen()).toBe(0);
    pass(stuckCheck());
    expect(seen()).toBe(1);
    const planned = dry(NOW + 31 * 60_000);
    expect(planned.filter((entry) => entry.kind === "ci")).toHaveLength(1);
    expect(seen()).toBe(1);
    expect(prompts()).toEqual([]);
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
    refuse.add("ask");
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
    refuse.add("ask");
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
    refuse.add("ask");
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
    refuse.add("ask");
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

describe("held status", () => {
  test("status lists open on-hold PRs as last read", () => {
    const crew = openCrewStore(":memory:");
    const lines: string[] = [];
    const held = town({
      head: SHA.reviewed,
      posts: [],
      labels: ["pod:town", "on-hold"],
    });
    status(
      crew,
      (line) => lines.push(line),
      NOW,
      SETTINGS,
      [held],
      2 * 1024 ** 2,
    );
    expect(lines[0]).toBe("1 held pull request(s) (as last read)");
    expect(lines[1]).toContain(`#${held.number}`);
    expect(lines[1]).toContain(held.item?.title ?? "");
    expect(lines).toContain("gate store: 2.0 MiB");
    crew.close();
  });

  test("a held PR stays listed after a scoped pass over another PR", () => {
    const dir = mkdtempSync(join(tmpdir(), "crew-status-"));
    try {
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({ ...config, crew: SETTINGS }),
      );
      const held = town({
        head: SHA.reviewed,
        posts: [],
        labels: ["pod:town", "on-hold"],
      });
      const busy = { ...town({ head: SHA.reviewed, posts: [] }), number: 8 };
      const gate = openStore(join(dir, "gate.sqlite"));
      const record = (trigger: string, inputs: GateInput[]) =>
        recordPass(gate, {
          trigger,
          config,
          startedAt: NOW,
          finishedAt: NOW,
          inputs,
          verdicts: inputs.map((value) => evaluate(value, config, NOW)),
        });
      record("open", [held, busy]);
      record("pr 8", [busy]);
      gate.close();
      const crew = openCrewStore(":memory:");
      const lines: string[] = [];
      showStatus(crew, dir, (line) => lines.push(line), NOW);
      expect(lines[0]).toBe("1 held pull request(s) (as last read)");
      expect(lines[1]).toContain("#7");
      // A later read that sees it closed drops it.
      const reopened = openStore(join(dir, "gate.sqlite"));
      recordPass(reopened, {
        trigger: "pr 7",
        config,
        startedAt: NOW,
        finishedAt: NOW,
        inputs: [{ ...held, state: "CLOSED" }],
        verdicts: [evaluate({ ...held, state: "CLOSED" }, config, NOW)],
      });
      reopened.close();
      lines.length = 0;
      showStatus(crew, dir, (line) => lines.push(line), NOW);
      expect(lines[0]).toBe("0 held pull request(s) (as last read)");
      crew.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("before any full pass, every scoped pass's PRs are listed", () => {
    const dir = mkdtempSync(join(tmpdir(), "crew-status-"));
    try {
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({ ...config, crew: SETTINGS }),
      );
      const held = town({
        head: SHA.reviewed,
        posts: [],
        labels: ["pod:town", "on-hold"],
      });
      const busy = { ...town({ head: SHA.reviewed, posts: [] }), number: 8 };
      const gate = openStore(join(dir, "gate.sqlite"));
      for (const [trigger, inputs] of [
        ["pr 7", [held]],
        ["pr 8", [busy]],
      ] as const)
        recordPass(gate, {
          trigger,
          config,
          startedAt: NOW,
          finishedAt: NOW,
          inputs: [...inputs],
          verdicts: inputs.map((value) => evaluate(value, config, NOW)),
        });
      gate.close();
      const crew = openCrewStore(":memory:");
      const lines: string[] = [];
      showStatus(crew, dir, (line) => lines.push(line), NOW);
      expect(lines[0]).toBe("1 held pull request(s) (as last read)");
      crew.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("status shows the ledger without a configuration or a pass", () => {
    const dir = mkdtempSync(join(tmpdir(), "crew-status-"));
    try {
      const crew = openCrewStore(":memory:");
      const lines: string[] = [];
      showStatus(crew, dir, (line) => lines.push(line), NOW);
      expect(lines[0]).toBe(
        "held pull requests unknown: no crew pass or configuration yet",
      );
      expect(lines[2]).toBe("0 open action(s)");
      crew.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

describe("seats and spend", () => {
  // Watcher tests give their own process start times; none means pid only.
  const noStart = () => null;

  test("a seat starts on exactly its roster harness, model, effort and persona", () => {
    expect(
      seatArgv({
        model: "claude-haiku-5-5",
        effort: "low",
        persona: "You are dispatch.",
      }),
    ).toEqual({
      kind: "claude",
      args: [
        "--model",
        "claude-haiku-5-5",
        "--effort",
        "low",
        "--permission-mode",
        "auto",
        "--append-system-prompt",
        "You are dispatch.",
      ],
    });
    expect(seatArgv({ model: "gpt-6.1-sol", effort: "xhigh" })).toEqual({
      kind: "codex",
      args: [
        "-m",
        "gpt-6.1-sol",
        "-c",
        'model_reasoning_effort="xhigh"',
        "--dangerously-bypass-approvals-and-sandbox",
      ],
    });
    expect(seatArgv({ model: "gemini-4" })).toBeNull();
  });

  test("seat start opens a tab and starts the named agent; refuses unknown or live seats", () => {
    const root = mkdtempSync(join(tmpdir(), "crew-seat-"));
    const dir = join(root, "repo", ".agents", "crew-gate");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        ...config,
        roster: { dispatch: { model: "claude-haiku-5-5", effort: "low" } },
      }),
    );
    const calls: string[][] = [];
    let busy = 1;
    let failStart = false;
    let running: string[] = [];
    const out: string[] = [];
    const deps = {
      run: (argv: string[]) => {
        calls.push(argv);
        if (argv.join(" ") === "herdr agent list")
          return {
            code: 0,
            stdout: JSON.stringify({
              result: { agents: running.map((name) => ({ name })) },
            }),
            stderr: "",
          };
        if (argv[1] === "tab")
          return {
            code: 0,
            stdout: JSON.stringify({
              result: {
                tab: { tab_id: "w:t1" },
                root_pane: { pane_id: "w:p1" },
              },
            }),
            stderr: "",
          };
        if (argv[2] === "start" && busy-- > 0)
          return { code: 1, stdout: "", stderr: "agent_pane_busy" };
        if (argv[2] === "start" && failStart)
          return { code: 1, stdout: "", stderr: "agent_name_taken" };
        return { code: 0, stdout: "", stderr: "" };
      },
      out: (text: string) => out.push(text),
    } as unknown as Deps;
    const start = (name: string) =>
      startSeat(parseOptions(["seat", "start", name]), dir, deps);
    try {
      expect(start("dispatch")).toBe(0);
      const starts = calls.filter((argv) => argv[2] === "start");
      expect(starts).toHaveLength(2);
      expect(starts[1]).toEqual([
        "herdr",
        "agent",
        "start",
        "dispatch",
        "--kind",
        "claude",
        "--pane",
        "w:p1",
        "--timeout",
        "60000",
        "--",
        "--model",
        "claude-haiku-5-5",
        "--effort",
        "low",
        "--permission-mode",
        "auto",
      ]);
      expect(calls.find((argv) => argv[1] === "tab")).toContain(
        join(root, "repo"),
      );
      expect(out).toEqual(["started dispatch: claude claude-haiku-5-5 (low)"]);
      // A seat that fails to start closes the tab it opened.
      busy = 0;
      failStart = true;
      expect(() => start("dispatch")).toThrow("Herdr couldn't start dispatch");
      expect(calls.at(-1)).toEqual(["herdr", "tab", "close", "w:t1"]);
      failStart = false;
      expect(() => start("visionary")).toThrow(
        "visionary is not in the roster",
      );
      running = ["dispatch"];
      expect(() => start("dispatch")).toThrow("dispatch is already running");
      expect(() => parseOptions(["status", "extra"])).toThrow(
        "Unknown argument extra",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("status sums reviewer tokens per PR, pod and track in its window", () => {
    expect(runTokens('{"total_tokens":900,"input_tokens":800}')).toBe(900);
    expect(
      runTokens(
        '{"input_tokens":10,"output_tokens":20,"cache_creation_input_tokens":30,"cache_read_input_tokens":40}',
      ),
    ).toBe(100);
    expect(runTokens(null)).toBe(0);
    const crew = openCrewStore(":memory:");
    const usage = (pr: number, tokens: number, at: number) => {
      const id = addRun(
        crew,
        {
          actionKey: `${pr}:x:review:rev2`,
          reviewer: "rev2",
          pr,
          head: SHA.reviewed,
          log: "log",
          round: 1,
        },
        at,
      );
      finishRun(crew, id, 0, `{"total_tokens":${tokens}}`, at);
    };
    usage(7, 1000, NOW - 3_600_000);
    usage(8, 500, NOW - 600_000);
    usage(7, 250, NOW - 60_000);
    usage(9, 99, NOW - 48 * 3_600_000);
    const labels: Record<number, string[]> = {
      7: ["pod:town", "track:product"],
      8: ["pod:platform", "track:debt"],
    };
    // The run two days ago is outside the 24-hour window.
    const dir = mkdtempSync(join(tmpdir(), "crew-spend-"));
    const lines: string[] = [];
    try {
      showStatus(crew, dir, (line) => lines.push(line), NOW, { hours: 24 });
      expect(lines).toContain("reviewer tokens, last 24 h: 1,750 in 3 run(s)");
      expect(lines).toContain("  by pr: #7 1,250; #8 500");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      crew.close();
    }
    const grouped: string[] = [];
    spend(
      [
        { pr: 7, usage: '{"total_tokens":1250}' },
        { pr: 8, usage: '{"total_tokens":500}' },
      ] as Parameters<typeof spend>[0],
      (pr) => labels[pr] ?? [],
      24,
      (line) => grouped.push(line),
    );
    expect(grouped).toEqual([
      "reviewer tokens, last 24 h: 1,750 in 2 run(s)",
      "  by pr: #7 1,250; #8 500",
      "  by pod: town 1,250; platform 500",
      "  by track: product 1,250; debt 500",
    ]);
  });

  test("status names live seats missing from the roster and a watcher on old code", () => {
    const dir = mkdtempSync(join(tmpdir(), "crew-roster-"));
    const crew = openCrewStore(":memory:");
    try {
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({ ...config, roster: ROSTER }),
      );
      // The watcher records both versions from its own checkout, so `status`
      // run from another worktree compares the watcher's, not its own.
      setMeta(
        crew,
        "watcher:4242",
        JSON.stringify({ loaded: "old", disk: "new" }),
      );
      const lines: string[] = [];
      const show = (alive: boolean) => {
        lines.length = 0;
        showStatus(crew, dir, (line) => lines.push(line), NOW, {
          live: [
            { name: "rev2", status: "idle", focused: false },
            { name: "dispatch", status: "idle", focused: false },
          ],
          alive: () => alive,
        });
        return lines;
      };
      expect(show(true)).toContain("seats not in the roster: dispatch");
      expect(show(true).at(-1)).toContain("older crew code");
      // A watcher that has exited isn't stale, just gone.
      expect(show(false).some((line) => line.includes("older crew code"))).toBe(
        false,
      );
      setMeta(
        crew,
        "watcher:4242",
        JSON.stringify({ loaded: "old", disk: "old" }),
      );
      expect(show(true).some((line) => line.includes("older crew code"))).toBe(
        false,
      );
    } finally {
      crew.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the code version follows everything the watcher imports, not tests", () => {
    const code = mkdtempSync(join(tmpdir(), "crew-code-"));
    try {
      const write = (file: string, text: string) => {
        mkdirSync(join(code, file, ".."), { recursive: true });
        writeFileSync(join(code, file), text);
      };
      write(
        "scripts/agent/crew.ts",
        'import { plan } from "./crew/plan";\nexport { gate } from "./gate";\n',
      );
      write(
        "scripts/agent/crew/plan.ts",
        'import type { Rule } from "../../../shared/rules";\n',
      );
      write(
        "scripts/agent/gate.ts",
        'const later = () => import("./gate/store");\n',
      );
      write("scripts/agent/gate/store.ts", "// store\n");
      write("shared/rules.ts", "// rules v1\n");
      write("shared/unrelated.ts", "// not imported\n");
      const entry = join(code, "scripts", "agent", "crew.ts");
      const before = crewCodeVersion(entry);
      write("scripts/agent/crew/plan.test.ts", "// test\n");
      write("shared/unrelated.ts", "// changed, still not imported\n");
      expect(crewCodeVersion(entry)).toBe(before);
      // A merged change only to an imported dependency outside the crew.
      write("shared/rules.ts", "// rules v2\n");
      const shared = crewCodeVersion(entry);
      expect(shared).not.toBe(before);
      write("scripts/agent/gate/store.ts", "// store v2\n");
      expect(crewCodeVersion(entry)).not.toBe(shared);
    } finally {
      rmSync(code, { recursive: true, force: true });
    }
  });

  test("a stale watcher tells the owner once per version, retrying a failed notice", () => {
    const dir = mkdtempSync(join(tmpdir(), "crew-stale-"));
    const crew = openCrewStore(":memory:");
    try {
      let refuse = true;
      const notices: string[][] = [];
      const deps = {
        alive: () => true,
        run: (argv: string[]) => {
          notices.push(argv);
          return refuse
            ? { code: 1, stdout: "", stderr: "no server" }
            : { code: 0, stdout: "", stderr: "" };
        },
      } as unknown as Deps;
      const feedText = () =>
        existsSync(join(dir, "feed.log"))
          ? readFileSync(join(dir, "feed.log"), "utf8")
          : "";
      noticeStaleWatcher(crew, "v1", "v1", dir, deps, NOW, 11, noStart);
      expect(notices).toEqual([]);
      noticeStaleWatcher(crew, "v1", "v2", dir, deps, NOW, 11, noStart);
      expect(notices).toHaveLength(1);
      expect(feedText()).toBe("");
      refuse = false;
      noticeStaleWatcher(crew, "v1", "v2", dir, deps, NOW, 11, noStart);
      noticeStaleWatcher(crew, "v1", "v2", dir, deps, NOW, 11, noStart);
      expect(notices).toHaveLength(2);
      expect(notices[1]!.slice(0, 4)).toEqual([
        "herdr",
        "notification",
        "show",
        "Crew: restart the watcher",
      ]);
      expect(feedText()).toContain("told the owner to restart it");
      // Another merge is another version: the owner hears again.
      noticeStaleWatcher(crew, "v1", "v3", dir, deps, NOW, 11, noStart);
      expect(notices).toHaveLength(3);
    } finally {
      crew.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("watchers in two checkouts sharing the store keep their own versions", () => {
    const dir = mkdtempSync(join(tmpdir(), "crew-two-"));
    const crew = openCrewStore(":memory:");
    try {
      const deps = {
        alive: () => true,
        run: () => ({ code: 0, stdout: "", stderr: "" }),
      } as unknown as Deps;
      const stale = () => {
        const lines: string[] = [];
        showStatus(crew, dir, (line) => lines.push(line), NOW, {
          alive: () => true,
        });
        return lines.filter((line) => line.includes("older crew code"));
      };
      // B runs v2 from its current checkout; A runs v1 from its own.
      noticeStaleWatcher(crew, "v2", "v2", dir, deps, NOW, 202, noStart);
      noticeStaleWatcher(crew, "v1", "v1", dir, deps, NOW, 101, noStart);
      expect(stale()).toEqual([]);
      // A's checkout moves on: only A is stale.
      noticeStaleWatcher(crew, "v1", "v3", dir, deps, NOW, 101, noStart);
      noticeStaleWatcher(crew, "v2", "v2", dir, deps, NOW, 202, noStart);
      expect(stale()).toEqual([
        "watcher 101 runs older crew code than its checkout; restart `agent:crew -- watch`",
      ]);
    } finally {
      crew.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a stopped watcher's record is forgotten, so a reused pid isn't reported", () => {
    const dir = mkdtempSync(join(tmpdir(), "crew-gone-"));
    const crew = openCrewStore(":memory:");
    try {
      const running = new Set([101, 202]);
      const deps = {
        alive: (pid: number) => running.has(pid),
        run: () => ({ code: 0, stdout: "", stderr: "" }),
      } as unknown as Deps;
      const stale = () => {
        const lines: string[] = [];
        showStatus(crew, dir, (line) => lines.push(line), NOW, {
          alive: deps.alive,
          startOf: noStart,
        });
        return lines.filter((line) => line.includes("older crew code"));
      };
      // Watcher 101 falls behind its checkout, then is killed without
      // cleaning up; watcher 202 replaces it.
      noticeStaleWatcher(crew, "v1", "v2", dir, deps, NOW, 101, noStart);
      running.delete(101);
      noticeStaleWatcher(crew, "v2", "v2", dir, deps, NOW, 202, noStart);
      expect(getMeta(crew, "watcher:101")).toBeNull();
      // The OS later gives pid 101 to an unrelated process.
      running.add(101);
      expect(stale()).toEqual([]);
      forgetGoneWatchers(crew, () => false, 202);
      expect(getMeta(crew, "watcher:202")).not.toBeNull();
    } finally {
      crew.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a crashed watcher's pid reused before any cleanup isn't taken for it", () => {
    const dir = mkdtempSync(join(tmpdir(), "crew-reuse-"));
    const crew = openCrewStore(":memory:");
    try {
      const starts = new Map([
        [101, "Wed Oct 28 10:00:00 2026"],
        [202, "Wed Oct 28 11:00:00 2026"],
      ]);
      const startOf = (pid: number) => starts.get(pid) ?? null;
      const deps = {
        alive: (pid: number) => starts.has(pid),
        run: () => ({ code: 0, stdout: "", stderr: "" }),
      } as unknown as Deps;
      const stale = () => {
        const lines: string[] = [];
        showStatus(crew, dir, (line) => lines.push(line), NOW, {
          alive: deps.alive,
          startOf,
        });
        return lines.filter((line) => line.includes("older crew code"));
      };
      noticeStaleWatcher(crew, "v1", "v2", dir, deps, NOW, 101, startOf);
      expect(stale()).toHaveLength(1);
      // Watcher 101 crashes, and an unrelated process (or a reboot) takes
      // its pid before any other watcher has run a pass.
      starts.set(101, "Wed Oct 28 12:30:00 2026");
      expect(stale()).toEqual([]);
      noticeStaleWatcher(crew, "v2", "v2", dir, deps, NOW, 202, startOf);
      expect(getMeta(crew, "watcher:101")).toBeNull();
      expect(JSON.parse(getMeta(crew, "watcher:202")!).started).toBe(
        "Wed Oct 28 11:00:00 2026",
      );
    } finally {
      crew.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a new watcher on a crashed watcher's pid starts its own record", () => {
    const dir = mkdtempSync(join(tmpdir(), "crew-replace-"));
    const crew = openCrewStore(":memory:");
    try {
      const starts = new Map([
        [101, "Wed Oct 28 10:00:00 2026"],
        [202, "Wed Oct 28 11:00:00 2026"],
      ]);
      const startOf = (pid: number) => starts.get(pid) ?? null;
      const notices: string[][] = [];
      const deps = {
        alive: (pid: number) => starts.has(pid),
        run: (argv: string[]) => {
          notices.push(argv);
          return { code: 0, stdout: "", stderr: "" };
        },
      } as unknown as Deps;
      // Watcher 101 runs v1 and is told about v3 in its checkout.
      noticeStaleWatcher(crew, "v1", "v3", dir, deps, NOW, 101, startOf);
      expect(notices).toHaveLength(1);
      // It crashes; a new watcher gets pid 101 before any cleanup, runs v2,
      // and its checkout is at v3 too: it hasn't been told, so it tells.
      starts.set(101, "Wed Oct 28 12:30:00 2026");
      noticeStaleWatcher(crew, "v2", "v3", dir, deps, NOW, 101, startOf);
      expect(JSON.parse(getMeta(crew, "watcher:101")!)).toEqual({
        loaded: "v2",
        disk: "v3",
        started: "Wed Oct 28 12:30:00 2026",
        told: "v3",
      });
      expect(notices).toHaveLength(2);
      // Another watcher's pass keeps the live record, and status reports it.
      noticeStaleWatcher(crew, "v3", "v3", dir, deps, NOW, 202, startOf);
      expect(getMeta(crew, "watcher:101")).not.toBeNull();
      const lines: string[] = [];
      showStatus(crew, dir, (line) => lines.push(line), NOW, {
        alive: deps.alive,
        startOf,
      });
      expect(lines.filter((line) => line.includes("older crew code"))).toEqual([
        "watcher 101 runs older crew code than its checkout; restart `agent:crew -- watch`",
      ]);
    } finally {
      crew.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a process's start time reads the same whatever the caller's TZ and locale", () => {
    // Callers with different settings, such as a watcher and `status` run
    // from other shells, read this test process's start time.
    const read = (env: Record<string, string>) =>
      Bun.spawnSync(
        [
          process.execPath,
          "-e",
          `import { processStart } from ${JSON.stringify(join(import.meta.dir, "crew", "seats.ts"))}; console.log(processStart(${process.pid}));`,
        ],
        { env: { ...process.env, ...env }, stdout: "pipe" },
      )
        .stdout.toString()
        .trim();
    const tokyo = read({ TZ: "Asia/Tokyo", LC_ALL: "C" });
    const losAngeles = read({ TZ: "America/Los_Angeles", LC_ALL: "C" });
    expect(tokyo).not.toBe("null");
    expect(tokyo).toBe(losAngeles);
    expect(processStart(process.pid)).toBe(tokyo);
  });

  test("reviewers run on their roster harness and persona too", () => {
    const entry = {
      model: "sonnet",
      harness: "claude" as const,
      persona: "Use the review checklist.",
    };
    expect(reviewerArgv(entry, "brief", "s-1")).toEqual([
      "claude",
      "--model",
      "sonnet",
      "--permission-mode",
      "auto",
      "--append-system-prompt",
      "Use the review checklist.",
      "--session-id",
      "s-1",
      "brief",
    ]);
    const settings = {
      ...SETTINGS,
      roster: {
        ...ROSTER,
        rev2: { model: "sol-latest", harness: "codex" as const },
      },
    };
    const actions = planned(town({ head: SHA.reviewed, posts: [] }), settings);
    expect(actions.map((a) => [a.kind, a.target])).toContainEqual([
      "review",
      "rev2",
    ]);
    expect(actions.some((a) => a.kind === "judgment")).toBe(false);
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

  test("a fixer's brief carries the steps, the branch and its signature", () => {
    const brief = fixerPrompt({
      repo: "example-org/widgets",
      pr: 7,
      head: SHA.reviewed,
      author: "towncx",
      title: "Plates",
      url: "https://github.com/example-org/widgets/pull/7",
      branch: "agent/towncx-12-plates",
      steps: ["[crew -> towncx] ACT #7 fix @aaaaaaa: findings from rev2"],
      done: "bun /x/crew.ts fixed --run 3",
    });
    expect(brief).toContain(
      "When you are done, pushed or not, run `bun /x/crew.ts fixed --run 3`",
    );
    // A checkout path with spaces stays one argument.
    expect(doneCommand("/x/my repo/scripts/agent/crew.ts", 3)).toBe(
      "bun '/x/my repo/scripts/agent/crew.ts' fixed --run 3",
    );
    expect(brief).toContain(
      "- [crew -> towncx] ACT #7 fix @aaaaaaa: findings from rev2",
    );
    expect(brief).toContain("Push to agent/towncx-12-plates only.");
    expect(brief).toContain("starts with `[fixer #7]`");
    expect(brief).toContain("Never use git stash");
    expect(brief).toContain("candidate-delivery skill");
  });

  test("the brief carries the canonical header and the delta for a confirm", () => {
    const prompt = reviewerPrompt({ ...task, since: SHA.reviewed });
    expect(prompt).toContain(
      `Reviewer: rev2\n  Reviewed commit: ${SHA.fixed}\n  RESULT #7: x/y resolved, z new`,
    );
    expect(prompt).toContain(
      `--first-parent --reverse ${SHA.reviewed}..${SHA.fixed}`,
    );
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
    // A fixer shares the author's worktree: the author's older session,
    // still writing there, is not the one the fixer just started.
    const sessions = mkdtempSync(join(tmpdir(), "codex-"));
    const day = join(sessions, "2026", "10", "29");
    mkdirSync(day, { recursive: true });
    const rollout = (name: string, id: string, created: number) =>
      writeFileSync(
        join(day, `rollout-${name}.jsonl`),
        `${JSON.stringify({
          type: "session_meta",
          payload: {
            id,
            cwd: "/x/towncx-12",
            timestamp: new Date(created).toISOString(),
          },
        })}\n`,
      );
    const started = Date.now();
    rollout("1-author", "author-1", started - 3_600_000);
    expect(findCodexSession("/x/towncx-12", started - 5_000, sessions)).toBe(
      null,
    );
    rollout("2-fixer", "fixer-1", started);
    expect(findCodexSession("/x/towncx-12", started - 5_000, sessions)).toBe(
      "fixer-1",
    );
    rmSync(sessions, { recursive: true, force: true });
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
