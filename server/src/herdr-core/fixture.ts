import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeCore } from "./testing/fake-core";

/** The connection the fixture adds; its runtime kind is herdr-core. */
export const CORE_FIXTURE_CONNECTION_ID = "core-fixture";

type Profiles = {
  coreList(): Array<{ id: string; state: string }>;
  create(value: unknown): Promise<unknown>;
  connect(id: unknown): Promise<unknown>;
  remove(id: unknown): Promise<unknown>;
};

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
  const status = (): CoreFixtureStatus => ({
    running: fake?.isRunning ?? false,
    connection_id: CORE_FIXTURE_CONNECTION_ID,
    terminals: fake ? 2 : 0,
  });
  const stop = () => {
    if (fake?.isRunning) fake.kill(socket ?? undefined);
    socket = null;
  };
  return {
    status,
    async start(): Promise<CoreFixtureStatus> {
      if (!fake || !root) {
        // Short: Unix socket paths are limited to about 100 bytes.
        root = mkdtempSync(join(tmpdir(), "hcw-fixture-"));
        chmodSync(root, 0o700);
        fake = new FakeCore({ name: "fixture-host" });
        fake.revive();
        fake.create({
          name: "fixture-agent",
          argv: ["claude"],
          keep: true,
          reported: true,
          status: { state: "working" },
        });
        fake.create({ name: "fixture-shell" });
      } else if (!fake.isRunning) {
        // A new core process: same terminals at the same addresses.
        fake.revive();
      }
      socket ??= await fake.listen(join(root, "state"), join(root, "run"));
      const service = profiles();
      const existing = service
        .coreList()
        .find((item) => item.id === CORE_FIXTURE_CONNECTION_ID);
      if (!existing)
        await service.create({
          id: CORE_FIXTURE_CONNECTION_ID,
          label: "Fixture core",
          type: "local",
          runtime: "herdr-core",
          core_session: "default",
          core_state_dir: join(root, "state"),
          auto_connect: true,
        });
      else if (["disconnected", "error"].includes(existing.state))
        await service.connect(CORE_FIXTURE_CONNECTION_ID);
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
      if (service.coreList().some((c) => c.id === CORE_FIXTURE_CONNECTION_ID))
        await service.remove(CORE_FIXTURE_CONNECTION_ID);
      if (root) rmSync(root, { recursive: true, force: true });
      fake = null;
      root = null;
      socket = null;
      return status();
    },
    dispose(): void {
      stop();
      if (root) rmSync(root, { recursive: true, force: true });
    },
  };
}

export type CoreFixture = ReturnType<typeof createCoreFixture>;
