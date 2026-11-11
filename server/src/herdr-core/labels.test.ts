import { afterEach, describe, expect, test } from "bun:test";
import { runSpawnStampCommand } from "../herdr/spawn-stamp";
import { runTaskSummaryCommand } from "../herdr/task-summary";
import { CoreClient } from "./client";
import {
  ancestorDistance,
  type CoreCallerClaim,
  nearerRuntime,
  verifyCoreCaller,
} from "./cli-claim";
import {
  CORE_SPAWNED_BY_LABEL,
  CORE_SUMMARY_LABEL,
  coreOccupantFingerprint,
  coreSummaryOf,
  encodeCoreSummary,
} from "./labels";
import { connectUnixStream } from "./stream";
import { coreWorld, until } from "./testing/core-world";

/**
 * Task summaries (M6) and spawn stamps (M7) for core agents: written by the
 * standalone CLI inside a verified core terminal, read back by World only
 * while they still describe the program running there.
 */

type World = Awaited<ReturnType<typeof coreWorld>>;
const worlds: World[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.dispose();
});
async function world() {
  const w = await coreWorld();
  worlds.push(w);
  await w.connect();
  return w;
}

const CORE = "c0ffee0000000001";
/** An agent as core lists it: the harness is what runs in the terminal. */
const claude = () => ({
  argv: ["/opt/example/bin/claude"],
  foreground: {
    pid: 7,
    name: "claude",
    argv: ["/opt/example/bin/claude"],
    cwd: "/tmp/example",
  },
});
const agent = { address: "t3", pid: 4242, argv: ["/opt/example/bin/claude"] };

describe("a core task summary is bound to its program and expiry", () => {
  const fingerprint = coreOccupantFingerprint(CORE, agent)!;
  const labels = (
    exp: number,
    fp = fingerprint,
    text = "Fixing the tests",
  ) => ({
    [CORE_SUMMARY_LABEL]: encodeCoreSummary({
      text,
      fingerprint: fp,
      expiresMs: exp,
    }),
  });

  test("shown while the same program runs and the expiry is ahead", () => {
    expect(
      coreSummaryOf(CORE, { ...agent, labels: labels(2_000) }, 1_000),
    ).toEqual({
      text: "Fixing the tests",
      expiresMs: 2_000,
    });
  });

  test("hidden once expired, for another program, core or garbage", () => {
    expect(
      coreSummaryOf(CORE, { ...agent, labels: labels(1_000) }, 1_000),
    ).toBeNull();
    // A kept terminal's replacement shell: new pid and argv, same labels.
    expect(
      coreSummaryOf(
        CORE,
        { address: "t3", pid: 5151, argv: ["/bin/sh"], labels: labels(9e12) },
        1_000,
      ),
    ).toBeNull();
    // The same pid reused by another command line.
    expect(
      coreSummaryOf(
        CORE,
        { ...agent, argv: ["/bin/sh"], labels: labels(9e12) },
        1_000,
      ),
    ).toBeNull();
    expect(
      coreSummaryOf("other", { ...agent, labels: labels(9e12) }, 1),
    ).toBeNull();
    expect(
      coreSummaryOf(
        CORE,
        { ...agent, labels: { [CORE_SUMMARY_LABEL]: "{" } },
        1,
      ),
    ).toBeNull();
  });
});

describe("the read model shows verified summaries and stamps", () => {
  test("a summary appears for its program and leaves at its expiry", async () => {
    const w = await world();
    const address = w.fake.create(claude());
    const record = w.fake.terminal(address)!;
    const expires = Date.now() + 400;
    w.fake.label(address, {
      [CORE_SUMMARY_LABEL]: encodeCoreSummary({
        text: "Reviewing PR 12",
        fingerprint: coreOccupantFingerprint(w.fake.coreId, record)!,
        expiresMs: expires,
      }),
    });
    await w.settle();
    const summary = async () =>
      (await w.rows()).panes.find((p) => p.pane_id === address)?.task_summary;
    expect(await summary()).toBe("Reviewing PR 12");
    await until(async () => (await summary()) === undefined, 2_000);
    expect(Date.now()).toBeGreaterThanOrEqual(expires);
    // No event says it expired: the runtime's own timer announced it.
    await until(() => w.changedAt.some((at) => at >= expires), 1_000);
  });

  test("a stamp and core's own parent both relate a child to its spawner", async () => {
    const w = await world();
    const lead = w.fake.create({ argv: ["/opt/example/bin/claude"] });
    const stamped = w.fake.create({
      argv: ["/opt/example/bin/codex"],
      labels: { [CORE_SPAWNED_BY_LABEL]: lead },
    });
    const child = w.fake.create({
      argv: ["/opt/example/bin/codex"],
      parent: lead,
      die_with_parent: true,
    });
    const forged = w.fake.create({
      argv: ["/bin/sh"],
      labels: { [CORE_SPAWNED_BY_LABEL]: "mac/t1" },
    });
    await w.settle();
    const panes = (await w.rows()).panes;
    const tokens = (address: string) =>
      panes.find((p) => p.pane_id === address)?.tokens;
    expect(tokens(stamped)).toEqual({
      spawned_by: lead,
      spawned_by_terminal: lead,
    });
    expect(tokens(child)).toEqual({
      spawned_by: lead,
      spawned_by_terminal: lead,
    });
    expect(tokens(forged)).toBeUndefined();
    expect(tokens(lead)).toBeUndefined();
  });
});

describe("the CLI verifies the core terminal it runs in (§4.10)", () => {
  const chain = new Map([
    [100, 90],
    [90, 80],
    [80, 1],
  ]);
  const parentOf = async (pid: number) => chain.get(pid) ?? null;

  test("ancestry is counted up the process tree", async () => {
    expect(await ancestorDistance(100, 80, parentOf)).toBe(2);
    expect(await ancestorDistance(100, 100, parentOf)).toBe(0);
    expect(await ancestorDistance(100, 55, parentOf)).toBeNull();
  });

  test("a marker for a terminal this process is not inside is refused", async () => {
    const w = await world();
    const address = w.fake.create({ pid: 80 });
    await w.settle();
    const open = async (socket: string) =>
      CoreClient.open(
        await connectUnixStream(socket, new AbortController().signal),
      );
    const env = { HC_TERMINAL_ID: address, HC_TERMINAL_SOCKET: w.socket };
    const claim = await verifyCoreCaller({ env, pid: 100, parentOf, open });
    expect(claim).toMatchObject({
      address,
      distance: 2,
      coreId: w.fake.coreId,
    });
    claim.client.close();
    await expect(
      verifyCoreCaller({
        env,
        pid: 100,
        parentOf: async () => null,
        open,
      }),
    ).rejects.toThrow("does not run inside");
    await expect(
      verifyCoreCaller({
        env: { ...env, HC_TERMINAL_ID: "t99" },
        pid: 100,
        parentOf,
        open,
      }),
    ).rejects.toThrow();
  });

  test("with both runtimes' markers, the nearer terminal wins", async () => {
    // 100 → 90 → 80 (the core terminal's program, distance 2) → 1.
    const claim = { distance: 2 } as CoreCallerClaim;
    const marked = (pids: number[]) => (pid: number) =>
      new Map(pids.includes(pid) ? [["HERDR_PANE_ID", "p1"]] : []);
    // A TUI started inside the core terminal: its pane shell (90) is nearer.
    expect(
      await nearerRuntime(claim, "p1", {
        pid: 100,
        parentOf,
        environment: marked([100, 90]),
      }),
    ).toBe("herdr");
    // A core started inside a TUI pane: the pane ID reaches past the program.
    expect(
      await nearerRuntime(claim, "p1", {
        pid: 100,
        parentOf: async (pid) => (pid > 10 ? pid - 10 : null),
        environment: () => new Map([["HERDR_PANE_ID", "p1"]]),
      }),
    ).toBe("herdr-core");
    // Only the core marker is really ours.
    expect(
      await nearerRuntime(claim, "p1", {
        pid: 100,
        parentOf,
        environment: marked([]),
      }),
    ).toBe("herdr-core");
    // The same terminal by both counts, or no readable environments: refuse.
    expect(
      await nearerRuntime(claim, "p1", {
        pid: 100,
        parentOf,
        environment: marked([100, 90, 80]),
      }),
    ).toBeNull();
    expect(
      await nearerRuntime(claim, "p1", {
        pid: 100,
        parentOf,
        environment: () => null,
      }),
    ).toBeNull();
  });
});

describe("the standalone CLI writes to the verified core terminal", () => {
  async function inside(w: World) {
    const address = w.fake.create(claude());
    await w.settle();
    const verifyCore = async (): Promise<CoreCallerClaim> => {
      const client = await CoreClient.open(
        await connectUnixStream(w.socket, new AbortController().signal),
      );
      return {
        client,
        coreId: client.hello.core.id,
        address,
        record: await client.getTerminal(address),
        distance: 1,
      };
    };
    const env = { HC_TERMINAL_ID: address, HC_TERMINAL_SOCKET: w.socket };
    return { address, verifyCore, env };
  }

  test("task-summary reports with no World service, read back by World", async () => {
    const w = await world();
    const { address, verifyCore, env } = await inside(w);
    const out: string[] = [];
    const code = await runTaskSummaryCommand(
      ["task-summary", "Writing", "the", "docs"],
      "test",
      { env, verifyCore, log: (m) => out.push(m), error: (m) => out.push(m) },
    );
    expect(code).toBe(0);
    expect(JSON.parse(out[0]!)).toEqual({
      terminal: address,
      runtime: "herdr-core",
      status: "reported",
      ttl_ms: 900_000,
    });
    const label = w.fake.calls.find((c) => c.method === "terminal.label");
    expect(label?.params).toMatchObject({ terminal: address });
    await w.settle();
    expect(
      (await w.rows()).panes.find((p) => p.pane_id === address)?.task_summary,
    ).toBe("Writing the docs");
  });

  test("--pane always means Herdr's TUI, even inside core", async () => {
    const w = await world();
    const { verifyCore, env } = await inside(w);
    let tuiCalled = false;
    const code = await runTaskSummaryCommand(
      ["task-summary", "x", "--pane", "w1:p1"],
      "test",
      {
        env,
        verifyCore,
        loadConfig: () => {
          tuiCalled = true;
          throw new Error("no TUI here");
        },
        log: () => {},
        error: () => {},
      },
    );
    expect(tuiCalled).toBe(true);
    expect(code).toBe(1);
    expect(w.fake.calls.some((c) => c.method === "terminal.label")).toBe(false);
  });

  test("stamp writes a display label, never a native parent", async () => {
    const w = await world();
    const { address, verifyCore, env } = await inside(w);
    const child = w.fake.create({ argv: ["/opt/example/bin/codex"] });
    await w.settle();
    const out: string[] = [];
    const code = await runSpawnStampCommand(["stamp", child, address], "test", {
      env,
      verifyCore,
      log: (m) => out.push(m),
      error: (m) => out.push(m),
    });
    expect(code).toBe(0);
    expect(JSON.parse(out[0]!)).toMatchObject({
      pane_id: child,
      spawned_by: address,
      runtime: "herdr-core",
    });
    expect(w.fake.terminal(child)!.parent ?? null).toBeNull();
    expect(w.fake.terminal(child)!.labels).toEqual({
      [CORE_SPAWNED_BY_LABEL]: address,
    });
    const missing = await runSpawnStampCommand(
      ["stamp", "t99", address],
      "test",
      { env, verifyCore, log: () => {}, error: () => {} },
    );
    expect(missing).toBe(1);
  });
});
