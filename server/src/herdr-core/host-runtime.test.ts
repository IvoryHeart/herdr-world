import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultGuiSettings } from "../config/gui-settings";
import { coreHostRuntimes, createCoreHostRuntime } from "./host-runtime";
import { coreWorld, until } from "./testing/core-world";

/**
 * A core connection's host consumers (P4) over World's real provider and an
 * in-process core: reads are screen only, every answer belongs to the
 * generation it was asked under, and an agent's Files follow the program
 * running at its address now.
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

const host = (w: World) =>
  createCoreHostRuntime({
    lease: w.lease(),
    host: null,
    readSettings: async () => defaultGuiSettings(),
  });

/** A Git repository with one file: an agent's worktree. */
function folder(root: string, name: string) {
  const path = join(root, name);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, `${name}.txt`), name);
  Bun.spawnSync(["git", "init", "-q", path]);
  return path;
}

describe("core host runtime (P4)", () => {
  test("a terminal read is the screen only: lines 0, no caller, whatever was asked", async () => {
    const w = await world();
    const address = w.fake.create({ name: "agent" });
    await w.settle();
    const read = await host(w).operations.readTerminal({
      pane_id: address,
      lines: 500,
      source: "recent",
    });
    expect(read).toEqual({
      read: {
        pane_id: address,
        workspace_id: "hc:unplaced",
        source: "screen",
        text: "$",
        truncated: false,
      },
    });
    const sent = w.fake.calls.filter((c) => c.method === "terminal.read");
    expect(sent.map((c) => c.params)).toEqual([
      { terminal: address, lines: 0 },
    ]);
  });

  test.each([1, 20])(
    "a read answered after its generation retired is refused, never returned (ordinal %i)",
    async (ordinal) => {
      const w = await world();
      for (let n = 1; n < ordinal; n++) w.fake.create();
      const address = w.fake.create({ name: "agent" });
      await w.settle();
      const runtime = host(w);
      const release = w.fake.holdReads();
      const pending = runtime.operations
        .readTerminal({ pane_id: address })
        .catch((error: Error) => error);
      await until(() => w.fake.calls.some((c) => c.method === "terminal.read"));
      const lease = w.lease();
      w.fake.kill(w.socket);
      await until(() => !lease.isCurrent());
      release();
      const outcome = await pending;
      expect(outcome).toBeInstanceOf(Error);
      // Later calls on the retired runtime are refused before anything runs.
      await expect(runtime.operations.listWorkspaces()).rejects.toThrow(
        "reconnected",
      );
      await expect(
        runtime.files.listWorkspaceFiles({ workspace_id: "hc:unplaced" }),
      ).rejects.toThrow("reconnected");
    },
  );

  test("each generation gets its own host runtime; a retired one is not reused", async () => {
    const w = await world();
    const runtimes = coreHostRuntimes({
      host: () => null,
      readSettings: async () => defaultGuiSettings(),
    });
    const first = runtimes(w.lease());
    expect(runtimes(w.lease())).toBe(first);
    const old = w.lease();
    w.fake.kill(w.socket);
    await until(() => !old.isCurrent());
    expect(() => runtimes(old)).toThrow("reconnected");
    w.fake.revive();
    await w.fake.listen(w.stateDir, join(w.root, "core", "run"));
    await until(
      () =>
        w.core.manager.readyRuntimeLease("box")?.isCurrent() === true &&
        w.core.manager.readyRuntimeLease("box")!.generation !== old.generation,
      10_000,
    );
    const next = runtimes(w.lease());
    expect(next).not.toBe(first);
    expect(next.generation).toBe(w.lease().generation);
  });

  test.each([1, 20])(
    "an agent's Files follow its live folder; a replaced program's binding is refused (ordinal %i)",
    async (ordinal) => {
      const w = await world();
      for (let n = 1; n < ordinal; n++) w.fake.create();
      const repo = folder(w.root, "agent-folder");
      const address = w.fake.create({
        name: "agent",
        argv: ["/opt/example/bin/claude"],
        cwd: repo,
        foreground: { pid: 4242, name: "claude", argv: [], cwd: repo },
      });
      await w.settle();
      const runtime = host(w);
      const subject = {
        connectionId: "box",
        generation: w.lease().generation,
        paneId: address,
        terminalId: address,
        sessionFingerprint: null,
      };
      const read = await runtime.agentWorktree.get(subject, { refresh: true });
      expect(read).toMatchObject({
        state: "resolved",
        candidates: [{ source: "foreground_cwd" }],
      });
      const target = {
        subject,
        revision: read.revision,
        candidateId: read.selectedCandidateId,
      };
      const listed = (await runtime.files.listWorkspaceFiles({
        workspace_id: "hc:unplaced",
        agent_worktree: target,
      })) as { entries?: Array<{ name: string }> };
      expect(listed.entries?.map((e) => e.name)).toContain("agent-folder.txt");
      await runtime.files.runWorkspaceGitFileAction({
        workspace_id: "hc:unplaced",
        agent_worktree: target,
        action: "stage",
        path: "agent-folder.txt",
      });
      expect(
        Bun.spawnSync(["git", "-C", repo, "diff", "--cached", "--name-only"])
          .stdout.toString()
          .trim(),
      ).toBe("agent-folder.txt");
      // The program at that address is replaced by one reusing its pid, in
      // the same folder: the binding World read no longer holds.
      w.fake.replaceWithShell(address, { reusePid: true });
      w.fake.foreground(address, {
        pid: 4242,
        name: "claude",
        argv: [],
        cwd: repo,
      });
      await w.settle();
      await expect(
        runtime.files.listWorkspaceFiles({
          workspace_id: "hc:unplaced",
          agent_worktree: target,
        }),
      ).rejects.toThrow("binding changed");
    },
  );
});
