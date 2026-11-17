import { expect, test } from "bun:test";
import { defaultGuiSettings } from "../config/gui-settings";
import { CoreOperationFence } from "./fence";
import { createCoreFixture, CORE_FIXTURE_CONNECTION_ID } from "./fixture";
import { createCoreHostRuntime } from "./host-runtime";
import { coreWorld, until } from "./testing/core-world";

test("the alphabet preview admits reviewer at t1b, its Terminal and its Files under the original generation", async () => {
  const w = await coreWorld();
  const fixture = createCoreFixture(() => w.service);
  try {
    await expect(fixture.start("unknown")).rejects.toThrow("scenario");
    expect(await fixture.start("alphabet")).toMatchObject({
      running: true,
      terminals: 8,
    });
    await until(
      () => w.core.manager.status(CORE_FIXTURE_CONNECTION_ID).state === "ready",
    );
    const lease = w.lease(CORE_FIXTURE_CONNECTION_ID);
    expect(lease.runtime.core.terminal("t19")).toMatchObject({
      name: "alphabet-boundary",
    });
    expect(lease.runtime.core.terminal("t1b")).toMatchObject({
      name: "reviewer",
      remote: false,
      state: "live",
    });
    const rows = await w.rows(CORE_FIXTURE_CONNECTION_ID);
    const pane = rows.panes.find((p) => p.pane_id === "t1b")!;
    expect(pane).toBeDefined();
    const host = createCoreHostRuntime({
      lease,
      host: null,
      readSettings: async () => defaultGuiSettings(),
    });
    expect(
      await host.operations.readTerminal({ pane_id: "t1b" }),
    ).toMatchObject({ read: { pane_id: "t1b", source: "screen" } });
    const paint: string[] = [];
    const watch = await lease.runtime.watchTerminal(
      CoreOperationFence.admit(lease, "t1b"),
      {
        resize() {},
        data(bytes) {
          paint.push(new TextDecoder().decode(bytes));
        },
        close() {},
      },
    );
    expect(watch.terminal.address).toBe("t1b");
    expect(paint.join("")).toContain("Reviewing the merge plan");
    watch.detach();
    const subject = {
      connectionId: CORE_FIXTURE_CONNECTION_ID,
      generation: lease.generation,
      paneId: "t1b",
      terminalId: "t1b",
      sessionFingerprint: null,
    };
    const binding = await host.agentWorktree.get(subject, { refresh: true });
    expect(binding.state).toBe("resolved");
    const listed = (await host.files.listWorkspaceFiles({
      workspace_id: pane.workspace_id,
      agent_worktree: {
        subject,
        revision: binding.revision,
        candidateId: binding.selectedCandidateId,
      },
    })) as { entries?: Array<{ name: string }> };
    expect(listed.entries?.map((e) => e.name)).toContain("README.md");
    await expect(
      host.agentWorktree.get(
        { ...subject, connectionId: "other-core" },
        { refresh: true },
      ),
    ).rejects.toThrow();
    await expect(
      host.agentWorktree.get(
        { ...subject, generation: lease.generation + 1 },
        { refresh: true },
      ),
    ).rejects.toThrow();
    const fence = CoreOperationFence.admit(lease, "t1b");
    expect(fence.connectionId).toBe(CORE_FIXTURE_CONNECTION_ID);
    fixture.kill();
    await until(() => !lease.isCurrent());
    expect(() => fence.check("dispatch")).toThrow();
    await expect(
      host.operations.readTerminal({ pane_id: "t1b" }),
    ).rejects.toThrow();
    await fixture.start("alphabet");
    await until(
      () => w.core.manager.status(CORE_FIXTURE_CONNECTION_ID).state === "ready",
    );
    expect(w.lease(CORE_FIXTURE_CONNECTION_ID).generation).not.toBe(
      lease.generation,
    );
    expect(
      w.lease(CORE_FIXTURE_CONNECTION_ID).runtime.core.terminal("t1b")?.name,
    ).toBe("reviewer");
  } finally {
    await fixture.remove();
    await w.dispose();
  }
});

test("Start changes only the owned fixture when switching to the alphabet scenario", async () => {
  const w = await coreWorld();
  const fixture = createCoreFixture(() => w.service);
  try {
    await fixture.start();
    await until(
      () => w.core.manager.status(CORE_FIXTURE_CONNECTION_ID).state === "ready",
    );
    expect(
      w.lease(CORE_FIXTURE_CONNECTION_ID).runtime.core.terminal("t1")?.name,
    ).toBe("reviewer");
    await fixture.start("alphabet");
    await until(
      () => w.core.manager.status(CORE_FIXTURE_CONNECTION_ID).state === "ready",
    );
    expect(
      w.lease(CORE_FIXTURE_CONNECTION_ID).runtime.core.terminal("t1b")?.name,
    ).toBe("reviewer");
    expect(
      w.lease(CORE_FIXTURE_CONNECTION_ID).runtime.core.terminal("t1"),
    ).toBeUndefined();
  } finally {
    await fixture.remove();
    await w.dispose();
  }
});
