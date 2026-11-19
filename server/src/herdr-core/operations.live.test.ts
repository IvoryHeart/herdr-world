import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withClaudeLimitsTap } from "../agent/profile-launch";
import { claudeTapArgs } from "../usage/claude-tap";
import { type CoreKillConfirmation } from "./kill-plan";
import {
  CoreOperationRefused,
  createCoreRoom,
  killCore,
  launchCore,
  planCoreKill,
  type CoreKillPlanView,
} from "./operations";
import { connectedLive, until } from "./testing/live-world";
import { ScratchCore, scratchCoreBinary } from "./testing/scratch-core";

/**
 * World's writes against a real herdr-core release (M2, M3, M7): what core
 * accepts, what it records, and that its own parent cascade ends exactly
 * the confirmed set. Opt in with HERDR_CORE_BIN=<official binary>; Linux
 * only, under scratch HOME/XDG directories, every process killed after.
 */
const bin = scratchCoreBinary();
const live = bin ? test : test.skip;
const scratch: ScratchCore[] = [];
const roots: string[] = [];
const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  for (const core of scratch.splice(0)) await core.dispose();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

async function connected(stateDir: string) {
  const w = await connectedLive(stateDir);
  roots.push(w.root);
  stops.push(w.stop);
  return w;
}

const confirmAll = (plan: CoreKillPlanView): CoreKillConfirmation => ({
  coreId: plan.core_id,
  terminals: [...plan.roots, ...plan.descendants].map((e) => ({
    address: e.address,
    pid: e.pid,
    occupant: e.occupant,
    remote: e.remote,
  })),
});

/** A program that reports itself working (OSC 7501: `;` then `:`-joined fields), then waits. */
const REPORTING = [
  "-c",
  "printf '\\033]7501;state=working:app=claude-code\\033\\\\'; exec sleep 600",
];

describe("World's writes to a real herdr-core", () => {
  live(
    "Claude starts through core with the real long tap and literal multiline arguments",
    async () => {
      const core = new ScratchCore(bin!);
      scratch.push(core);
      core.env.SHELL = "/bin/bash";
      const executable = join(core.root, "claude");
      const received = join(core.root, "received.json");
      writeFileSync(
        join(core.env.HOME!, ".bashrc"),
        "export WORLD_SHELL_LOADED=yes\n",
      );
      writeFileSync(
        executable,
        `#!${process.execPath}
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(received)}, JSON.stringify({ args: process.argv.slice(2), shell: process.env.WORLD_SHELL_LOADED }));
process.stdout.write('\\x1b]7501;state=working:app=claude-code\\x1b\\\\');
setTimeout(() => {}, 60000);
`,
      );
      chmodSync(executable, 0o755);
      await core.start();
      const w = await connected(core.stateDir);
      const room = await createCoreRoom(w.lease(), w.topology, "Review");
      const prompt =
        "Review 'quoted' and \"nested\" text.\n$(exit 92); `exit 93`";
      const runtime = { kind: "node" as const, path: "/usr/bin/node" };
      const launch = withClaudeLimitsTap(
        {
          kind: "claude",
          label: "Reviewer",
          text: "",
          args: ["--append-system-prompt", prompt],
        },
        runtime,
      );
      const outcome = await launchCore(
        w.lease(),
        {
          workspaceId: room.workspace_id,
          ...launch,
        },
        { topology: w.topology, resolveExecutable: async () => executable },
      );
      expect(outcome.status).toBe("started");
      if (outcome.status !== "started") throw new Error("launch failed");
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          stop();
          reject(new Error("Claude harness never reported working"));
        }, 5000);
        const check = () => {
          if (
            (w.record(outcome.terminal_id)?.status as { state?: string })
              ?.state === "working"
          ) {
            clearTimeout(timer);
            stop();
            resolve();
          }
        };
        const stop = w.lease().runtime.watch(check);
        check();
      });
      expect(JSON.parse(readFileSync(received, "utf8"))).toEqual({
        args: [
          "--append-system-prompt",
          prompt,
          ...claudeTapArgs(runtime),
          "--session-id",
          expect.any(String),
        ],
        shell: "yes",
      });
    },
    30_000,
  );

  live(
    "a launch is accepted with explicit parameters, placed, kept and reporting",
    async () => {
      const scratchCore = new ScratchCore(bin!);
      scratch.push(scratchCore);
      await scratchCore.start();
      const w = await connected(scratchCore.stateDir);
      const room = await createCoreRoom(w.lease(), w.topology, "Review");
      const outcome = await launchCore(
        w.lease(),
        {
          workspaceId: room.workspace_id,
          kind: "claude",
          label: "Reviewer",
          args: REPORTING,
          text: "",
        },
        // The real executable is a shell standing in for the harness.
        { topology: w.topology, resolveExecutable: async () => "/bin/sh" },
      );
      expect(outcome).toMatchObject({
        status: "started",
        runtime: "herdr-core",
        placed: true,
        agent_name: "reviewer",
      });
      const address = outcome.status === "started" ? outcome.terminal_id : "";
      await until(() => Boolean(w.record(address)?.status));
      const record = w.record(address)!;
      // What core itself recorded: no parent, kept, World's labels.
      expect(record).toMatchObject({
        state: "live",
        name: "reviewer",
        keep: true,
        argv: [
          "/bin/sh",
          "-c",
          expect.stringContaining('exec "$@"'),
          "world-agent",
          "/bin/sh",
          ...REPORTING,
        ],
      });
      expect(record.parent ?? null).toBeNull();
      expect(record.labels).toMatchObject({
        "herdr.seen": "0",
        where: "Review / Reviewer",
      });
      expect(record.labels?.["herdr.space"]).toMatch(/^world-r[0-9a-f]{12}$/);
      expect(record.labels?.["herdr.tab"]).toMatch(/^world-b[0-9a-f]{12}$/);
      // The read model puts it in World's room, as a working Claude agent.
      const { panes } = await w.lease().runtime.operations.listTerminals();
      expect(panes).toEqual([
        expect.objectContaining({
          pane_id: address,
          workspace_id: room.workspace_id,
          agent: "claude",
          agent_status: "working",
          runtime: "herdr-core",
        }),
      ]);
      // A plain shell: unplaced in the app, not kept.
      const shell = await launchCore(
        w.lease(),
        { workspaceId: room.workspace_id, kind: null, label: "", text: "" },
        { topology: w.topology, resolveExecutable: async () => "/bin/sh" },
      );
      const shellAddress = shell.status === "started" ? shell.terminal_id : "";
      await until(() => w.record(shellAddress) !== null);
      expect(w.record(shellAddress)).toMatchObject({ keep: false, labels: {} });
    },
    30_000,
  );

  live(
    "a kill names core's own cascade and ends exactly the confirmed set",
    async () => {
      const scratchCore = new ScratchCore(bin!);
      scratch.push(scratchCore);
      await scratchCore.start();
      await scratchCore.hc(
        "run",
        "--bg",
        "--name",
        "lead",
        "--",
        "sleep",
        "600",
      );
      const w = await connected(scratchCore.stateDir);
      await until(() => w.record("t1")?.state === "live");
      await scratchCore.hc(
        "run",
        "--bg",
        "--parent",
        "t1",
        "--name",
        "helper",
        "--",
        "sleep",
        "600",
      );
      await scratchCore.hc(
        "run",
        "--bg",
        "--parent",
        "t1",
        "--outlive-parent",
        "--name",
        "server",
        "--",
        "sleep",
        "600",
      );
      await until(() => w.record("t3")?.state === "live");
      const plan = await planCoreKill(w.lease(), ["t1"]);
      expect(plan.roots.map((e) => e.name)).toEqual(["lead"]);
      // Core's die_with_parent decides: the helper dies, the server lives.
      expect(plan.descendants.map((e) => e.name)).toEqual(["helper"]);

      // A child started after the confirmation refuses the kill.
      const confirmation = confirmAll(plan);
      await scratchCore.hc(
        "run",
        "--bg",
        "--parent",
        "t1",
        "--name",
        "late",
        "--",
        "sleep",
        "600",
      );
      await until(() => w.record("t4")?.state === "live");
      const refused = await killCore(w.lease(), ["t1"], confirmation).catch(
        (error: unknown) => error,
      );
      expect(refused).toBeInstanceOf(CoreOperationRefused);
      expect(
        (refused as CoreOperationRefused).plan?.descendants.map((e) => e.name),
      ).toEqual(["helper", "late"]);
      expect(w.record("t1")?.state).toBe("live");

      // Confirmed again with the late child: core ends exactly those three.
      const again = (refused as CoreOperationRefused).plan!;
      const outcome = await killCore(w.lease(), ["t1"], confirmAll(again));
      expect(outcome).toEqual({ killed: ["t1"], uncertain: [], alsoEnded: [] });
      await until(() =>
        ["t1", "t2", "t4"].every((a) => w.record(a)?.state !== "live"),
      );
      expect(w.record("t3")?.state).toBe("live");
    },
    30_000,
  );
});
