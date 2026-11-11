import { chmodSync, mkdtempSync, rmSync } from "node:fs";
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
function populate(fake: FakeCore): string {
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
      labels,
      foreground: {
        pid: 1,
        name: program,
        argv: [program],
        cwd: "/tmp/example",
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
export function createCoreFixture(profiles: () => Profiles) {
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
  const stop = () => {
    if (finish) clearTimeout(finish);
    finish = null;
    if (fake?.isRunning) fake.kill(socket ?? undefined);
    socket = null;
  };
  return {
    status,
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
        scout = populate(fake);
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
      const finishing = scout;
      const word = (
        fake.terminal(finishing ?? "")?.status as { state?: unknown } | null
      )?.state;
      if (finishing && word === "working") {
        if (finish) clearTimeout(finish);
        finish = setTimeout(() => {
          finish = null;
          if (fake?.isRunning)
            fake.report(finishing, { state: "idle", app: "gemini" });
        }, FIXTURE_FINISH_MS);
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
