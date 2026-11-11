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
const FIXTURE_TERMINALS = 5;
/** How long after a start the scout finishes its turn. */
export const FIXTURE_FINISH_MS = 3_000;

/**
 * Agents as Herdr's desktop app would leave them: two placed in its "web"
 * space (one waiting for an answer, one working), one in another tab that
 * finishes soon after World connects, one harness with no status
 * integration, and a plain shell. Returns the scout's address.
 */
function populate(fake: FakeCore, cwd: string): string {
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
  fake.report(reviewer, { state: "working", app: "claude-code" });
  fake.report(reviewer, {
    state: "blocked",
    kind: "question",
    app: "claude-code",
    msg: "Which branch should I merge into?",
  });
  const builder = agent("builder", "codex", space("fx-review", "web / review"));
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
  agent("helper", "opencode");
  fake.create({ name: "fixture-shell" });
  return scout;
}

export type CoreFixtureStatus = {
  running: boolean;
  connection_id: string;
  terminals: number;
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
  let finish: ReturnType<typeof setTimeout> | null = null;
  const status = (): CoreFixtureStatus => ({
    running: fake?.isRunning ?? false,
    connection_id: CORE_FIXTURE_CONNECTION_ID,
    terminals: fake ? FIXTURE_TERMINALS : 0,
  });
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
    async start(): Promise<CoreFixtureStatus> {
      const service = profiles();
      const existing = fixtureProfile(service);
      const owner = ownership(existing);
      if (owner === "foreign")
        throw new Error(
          `the connection with ID ${CORE_FIXTURE_CONNECTION_ID} is not this fixture's; remove it in Settings first`,
        );
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
        scout = populate(fake, repo);
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
