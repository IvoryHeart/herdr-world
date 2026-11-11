import { type GuiSettings, repoSettingsKey } from "../config/gui-settings";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeCore } from "./testing/fake-core";

/** The connection the fixture adds; its runtime kind is herdr-core. */
export const CORE_FIXTURE_CONNECTION_ID = "core-fixture";

const ROOT_PREFIX = "hcw-fixture-";

type Profiles = {
  coreList(): Array<{
    id: string;
    state: string;
    type: string;
    core_state_dir: string;
  }>;
  create(value: unknown): Promise<unknown>;
  connect(id: unknown): Promise<unknown>;
  remove(id: unknown): Promise<unknown>;
};

/** Synthetic terminals the fixture holds; see `populate`. */
const FIXTURE_TERMINALS = 7;
/** How long after a start the scout finishes its turn. */
export const FIXTURE_FINISH_MS = 3_000;
/** How often the working builder prints a line, so a watch is visibly live. */
const FIXTURE_TICK_MS = 1_500;
/**
 * The reviewer's desktop pane, as `pane` steps it: Herdr's desktop app
 * attaches every placed pane at its own size; `null` is the pane closed,
 * so core runs the terminal headless.
 */
const FIXTURE_PANE_SIZES: ReadonlyArray<readonly [number, number] | null> = [
  [96, 28],
  [132, 40],
  [72, 24],
  null,
];

const CSI = "\x1b[";
/** A synthetic first screen per agent, so a watch has something to show. */
function screen(program: string, lines: string[]) {
  return `${CSI}1m${program}${CSI}0m ${CSI}2m(fixture: no program runs)${CSI}0m\r\n${lines
    .map((line) => `${line}\r\n`)
    .join("")}`;
}

/**
 * Agents as Herdr's desktop app would leave them: two placed in its "web"
 * space (one waiting for an answer, one working), one in another tab that
 * finishes soon after World connects, one harness with no status
 * integration, and a plain shell. Returns the agents the fixture drives.
 */
function populate(fake: FakeCore, cwd: string, alphabet: boolean) {
  if (alphabet) {
    // Allocate through the native boundary, keeping t19 beside reviewer at
    // t1b. Removed earlier shells consumed IDs, exactly as they do in core.
    for (let ordinal = 1; ordinal <= 19; ordinal++) {
      const address = fake.create({ name: "alphabet-boundary", cwd });
      if (ordinal < 19) fake.remove(address);
    }
  }
  const space = (tab: string, where: string) => ({
    "herdr.space": "fx-web",
    "herdr.tab": tab,
    where,
  });
  const agent = (name: string, program: string, labels = {}) =>
    fake.create({
      name,
      argv: [program],
      keep: true,
      cwd,
      labels,
      foreground: {
        pid: 1,
        name: program,
        argv: [program],
        cwd,
      },
    });
  const reviewer = agent(
    "reviewer",
    "claude",
    space("fx-review", "web / review"),
  );
  fake.output(
    reviewer,
    screen("claude", [
      "Reviewing the merge plan for web.",
      "",
      `${CSI}33m?${CSI}0m Which branch should I merge into?`,
      "  1. main",
      "  2. release",
    ]),
  );
  fake.report(reviewer, { state: "working", app: "claude-code" });
  fake.report(reviewer, {
    state: "blocked",
    kind: "question",
    app: "claude-code",
    msg: "Which branch should I merge into?",
  });
  const builder = agent("builder", "codex", space("fx-review", "web / review"));
  fake.output(builder, screen("codex", ["Building the web bundle…"]));
  fake.report(builder, { state: "working", app: "codex" });
  // The builder's own sub-agents (`hc run` inside it): *tests* ends with it,
  // *preview-server* outlives it, so binning the builder names only *tests*.
  const tests = fake.create({
    name: "tests",
    argv: ["claude"],
    cwd,
    parent: builder,
    die_with_parent: true,
    foreground: {
      pid: 1,
      name: "claude",
      argv: ["claude"],
      cwd,
    },
  });
  fake.report(tests, { state: "working", app: "claude-code" });
  fake.create({
    name: "preview-server",
    parent: builder,
    die_with_parent: false,
  });
  const scout = agent(
    "scout",
    "gemini",
    space("fx-research", "web / research"),
  );
  fake.report(scout, { state: "working", app: "gemini" });
  fake.output(scout, screen("gemini", ["Researching cache headers…"]));
  const helper = agent("helper", "opencode");
  fake.output(helper, screen("opencode", ["Waiting for a task."]));
  fake.create({ name: "fixture-shell" });
  // The desktop app shows its placed agents; the unplaced helper has no
  // pane, so core runs it at its headless size.
  for (const placed of [reviewer, builder, scout])
    fake.desktopAttach(placed, ...FIXTURE_PANE_SIZES[0]!);
  return { scout, reviewer, builder };
}

export type CoreFixtureStatus = {
  running: boolean;
  connection_id: string;
  terminals: number;
  /** The reviewer's desktop pane: its size, or null when it is closed. */
  pane: { cols: number; rows: number } | null;
};

/**
 * A testing switch for previews: an in-process herdr-core double (synthetic
 * terminals, no programs, private directory) that a person can start and
 * kill to watch a core connection go live, stale and back, without
 * installing core. World's real provider connects to it like any core.
 */
export function createCoreFixture(
  profiles: () => Profiles,
  { finishMs = FIXTURE_FINISH_MS }: { finishMs?: number } = {},
) {
  let fake: FakeCore | null = null;
  let root: string | null = null;
  let socket: string | null = null;
  const stateDir = () => (root ? join(root, "state") : null);
  /**
   * Whether a profile under the fixture's ID is the fixture's own: only the
   * local core profile this fixture created at its private directory in this
   * process. Nothing else proves ownership (an earlier run's directory is
   * deleted with it), so any other profile under that ID is the user's and is
   * never adopted or removed; the person removes a stale one in Settings.
   */
  const ownership = (
    profile: ReturnType<Profiles["coreList"]>[number] | undefined,
  ): "none" | "current" | "foreign" => {
    if (!profile) return "none";
    const dir = stateDir();
    return profile.type === "local" && dir && profile.core_state_dir === dir
      ? "current"
      : "foreign";
  };
  const fixtureProfile = (service: Profiles) =>
    service.coreList().find((item) => item.id === CORE_FIXTURE_CONNECTION_ID);
  let scout: string | null = null;
  let agents: ReturnType<typeof populate> | null = null;
  let finish: ReturnType<typeof setTimeout> | null = null;
  let ticker: ReturnType<typeof setInterval> | null = null;
  let ticks = 0;
  let paneStep = 0;
  let scenario: "default" | "alphabet" = "default";
  const status = (): CoreFixtureStatus => {
    const size = FIXTURE_PANE_SIZES[paneStep];
    return {
      running: fake?.isRunning ?? false,
      connection_id: CORE_FIXTURE_CONNECTION_ID,
      terminals: fake
        ? FIXTURE_TERMINALS + (scenario === "alphabet" ? 1 : 0)
        : 0,
      pane: fake && size ? { cols: size[0], rows: size[1] } : null,
    };
  };
  const runningScout = () => {
    if (!fake?.isRunning || !scout)
      throw new Error("start the fixture core first");
    return scout;
  };
  const finishScout = () => {
    const finishing = scout;
    const word = (
      fake?.terminal(finishing ?? "")?.status as { state?: unknown } | null
    )?.state;
    if (!finishing || word !== "working") return;
    if (finish) clearTimeout(finish);
    finish = setTimeout(() => {
      finish = null;
      if (fake?.isRunning)
        fake.report(finishing, { state: "idle", app: "gemini" });
    }, finishMs);
  };
  const stop = () => {
    if (finish) clearTimeout(finish);
    finish = null;
    if (ticker) clearInterval(ticker);
    ticker = null;
    if (fake?.isRunning) fake.kill(socket ?? undefined);
    socket = null;
  };
  return {
    status,
    /** Synthetic preview settings, never persisted or applied to user repos. */
    settingsFor(connectionId: string, settings: GuiSettings): GuiSettings {
      if (
        connectionId !== CORE_FIXTURE_CONNECTION_ID ||
        !root ||
        ownership(fixtureProfile(profiles())) !== "current"
      )
        return settings;
      const repo = join(root, "example-repo");
      const key = repoSettingsKey(repo, undefined, CORE_FIXTURE_CONNECTION_ID)!;
      return {
        ...settings,
        repositories: {
          ...settings.repositories,
          [key]: {
            worktree_directory: join(root, "worktrees"),
            worktree_hooks_enabled: true,
          },
        },
      };
    },
    async start(value: unknown = "default"): Promise<CoreFixtureStatus> {
      if (value !== "default" && value !== "alphabet")
        throw new Error("unknown core fixture scenario");
      const service = profiles();
      const existing = fixtureProfile(service);
      const owner = ownership(existing);
      if (owner === "foreign")
        throw new Error(
          `the connection with ID ${CORE_FIXTURE_CONNECTION_ID} is not this fixture's; remove it in Settings first`,
        );
      if (fake && scenario !== value) {
        await this.remove();
        return this.start(value);
      }
      if (!fake || !root) {
        // Short: Unix socket paths are limited to about 100 bytes.
        root = mkdtempSync(join(tmpdir(), ROOT_PREFIX));
        chmodSync(root, 0o700);
        fake = new FakeCore({ name: "fixture-host" });
        fake.revive();
        const repo = join(root, "example-repo");
        mkdirSync(repo);
        writeFileSync(
          join(repo, "README.md"),
          "# Example core workspace\n\nFiles, worktrees and Ranger share this disposable repository.\n",
        );
        writeFileSync(
          join(repo, "paseo.json"),
          JSON.stringify({
            worktree: {
              setup: "printf 'Setup hook ran\\n'",
              opened: "printf 'Opened hook ran\\n'",
              teardown: "printf 'Teardown hook ran\\n'",
              removed: "printf 'Removed hook ran\\n'",
            },
          }),
        );
        for (const args of [
          ["init", "-q", "-b", "main"],
          ["add", "."],
          [
            "-c",
            "user.name=Example",
            "-c",
            "user.email=dev@example.com",
            "commit",
            "-q",
            "-m",
            "Example workspace",
          ],
        ]) {
          const result = Bun.spawnSync(["git", "-C", repo, ...args], {
            env: {
              PATH: process.env.PATH ?? "/usr/bin:/bin",
              HOME: root,
              XDG_CONFIG_HOME: root,
              GIT_CONFIG_NOSYSTEM: "1",
            },
          });
          if (result.exitCode !== 0)
            throw new Error(
              "Cannot create disposable core fixture repository: Git is required.",
            );
        }
        paneStep = 0;
        scenario = value;
        agents = populate(fake, repo, scenario === "alphabet");
        scout = agents.scout;
        fake.onTyped = () => {
          if (fake && agents)
            fake.report(agents.reviewer, {
              state: "working",
              app: "claude-code",
            });
        };
      } else if (!fake.isRunning) {
        // A new core process: same terminals at the same addresses.
        fake.revive();
      }
      socket ??= await fake.listen(join(root, "state"), join(root, "run"));
      if (owner !== "current")
        await service.create({
          id: CORE_FIXTURE_CONNECTION_ID,
          label: "Fixture core",
          type: "local",
          runtime: "herdr-core",
          core_session: "default",
          core_state_dir: join(root, "state"),
          auto_connect: true,
        });
      else if (["disconnected", "error"].includes(existing?.state ?? ""))
        await service.connect(CORE_FIXTURE_CONNECTION_ID);
      // The builder keeps printing while it works, so a watch is live.
      ticker ??= setInterval(() => {
        if (fake?.isRunning && agents)
          fake.output(
            agents.builder,
            `${CSI}32m✓${CSI}0m step ${++ticks} compiled ${CSI}2m(${new Date().toISOString().slice(11, 19)})${CSI}0m\r\n`,
          );
      }, FIXTURE_TICK_MS);
      // Scout finishes its turn while World watches: done until seen.
      finishScout();
      return status();
    },
    /** Scout works again and finishes another turn soon after. */
    turn(): CoreFixtureStatus {
      const running = runningScout();
      const word = (
        fake!.terminal(running)?.status as { state?: unknown } | null
      )?.state;
      if (word !== "working")
        fake!.report(running, { state: "working", app: "gemini" });
      finishScout();
      return status();
    },
    /**
     * What Herdr's phone or desktop app writes when a person marks scout
     * unread (`herdr.seen=<turn - 1>`) or pins it (`herdr.pinned`): the
     * shared labels another client changes, as the app's label contract says.
     */
    otherApp(change: "unread" | "pin"): CoreFixtureStatus {
      const running = runningScout();
      const record = fake!.terminal(running)!;
      if (change === "unread") {
        const turn = typeof record.turn === "number" ? record.turn : 0;
        if (turn < 1) throw new Error("scout has not finished a turn yet");
        fake!.label(running, { "herdr.seen": String(turn - 1) });
      } else {
        const pinned = Boolean(record.labels?.["herdr.pinned"]);
        fake!.label(running, { "herdr.pinned": pinned ? "" : "1" });
      }
      return status();
    },
    replaceReviewer(): CoreFixtureStatus {
      if (!fake?.isRunning) throw new Error("Start fixture core first.");
      fake.replaceWithShell(agents!.reviewer);
      return status();
    },
    loseReply(): CoreFixtureStatus {
      if (!fake?.isRunning) throw new Error("Start fixture core first.");
      fake.onTyped = () => stop();
      return status();
    },
    /**
     * The reviewer's desktop pane changes, as a person resizing or closing
     * it in Herdr's desktop app would: 96x28, 132x40, 72x24, closed
     * (headless), and round again. Watches follow; World never sizes it.
     */
    pane(): CoreFixtureStatus {
      if (!fake?.isRunning || !agents)
        throw new Error("start the fixture core first");
      paneStep = (paneStep + 1) % FIXTURE_PANE_SIZES.length;
      const size = FIXTURE_PANE_SIZES[paneStep];
      if (size) fake.desktopAttach(agents.reviewer, size[0], size[1]);
      else fake.desktopDetach(agents.reviewer);
      return status();
    },
    /** Like `kill -9` of core: connections end, the socket goes, the lock stays. */
    kill(): CoreFixtureStatus {
      stop();
      return status();
    },
    async remove(): Promise<CoreFixtureStatus> {
      stop();
      const service = profiles();
      const existing = fixtureProfile(service);
      const owner = ownership(existing);
      if (owner === "current") await service.remove(CORE_FIXTURE_CONNECTION_ID);
      if (root) rmSync(root, { recursive: true, force: true });
      fake = null;
      root = null;
      socket = null;
      scout = null;
      agents = null;
      if (owner === "foreign")
        throw new Error(
          `the connection with ID ${CORE_FIXTURE_CONNECTION_ID} is not this fixture's; it was left in place`,
        );
      return status();
    },
    dispose(): void {
      stop();
      if (root) rmSync(root, { recursive: true, force: true });
    },
  };
}

export type CoreFixture = ReturnType<typeof createCoreFixture>;
