import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HerdrClient } from "../bridge/herdr-client";
import { ProfileStore } from "./profile-store";
import { TerminalSettings } from "./terminal-settings";
import { readTerminalSettings, type PaneRow } from "./terminal-tokens";

// Opt in explicitly. Every server and pane belongs to this disposable named session.
const live =
  process.env.HERDR_LIVE_TERMINAL_SETTINGS === "1" ? test : test.skip;
live(
  "P5: two in-process Worlds share disposable Herdr metadata through move, lease loss and restart",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "world-terminal-live-"));
    const session = `world-termset-test-${process.pid}`;
    const start = async () => {
      const child = Bun.spawn(["herdr", "--session", session, "server"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const ready = Promise.withResolvers<string>();
      const drain = async (stream: ReadableStream<Uint8Array>) => {
        let text = "";
        for await (const bytes of stream) {
          text += new TextDecoder().decode(bytes);
          const match = /api socket: ([^\r\n]+)/.exec(text);
          if (match) ready.resolve(match[1]!);
          if (text.length > 8192) text = text.slice(-4096);
        }
      };
      void Promise.all([drain(child.stdout), drain(child.stderr)]).then(() =>
        ready.reject(new Error("disposable Herdr exited before readiness")),
      );
      return { child, client: new HerdrClient(await ready.promise) };
    };
    let server = await start();
    const stop = async () => {
      const stopped = Bun.spawn(
        ["herdr", "--session", session, "server", "stop"],
        { stdout: "ignore", stderr: "ignore" },
      );
      await stopped.exited;
      await server.child.exited;
    };
    try {
      const create = async () =>
        (
          await server.client.call("workspace.create", {
            label: "Settings test",
          })
        ).root_pane as PaneRow;
      const first = await create(),
        second = await create(),
        full = await create();
      const firstTerminal = String(first.terminal_id),
        secondTerminal = String(second.terminal_id);
      let alphaOnline = true,
        generation = 1;
      const lease = (id: string) =>
        !alphaOnline && id === "alpha"
          ? null
          : {
              generation,
              isCurrent: () => id !== "alpha" || alphaOnline,
              runtime: { herdr: server.client },
            };
      const aStore = new ProfileStore(join(root, "a.json")),
        bStore = new ProfileStore(join(root, "b.json"));
      const a = new TerminalSettings(
        aStore,
        lease,
        () => {},
        () => 100,
      );
      const b = new TerminalSettings(
        bStore,
        lease,
        () => {},
        () => 101,
      );
      const observe = async (world: TerminalSettings, id: string) => {
        const panes = (await server.client.call("pane.list"))
          .panes as PaneRow[];
        await world.observe(id, generation, panes);
      };
      const target = (id: string, pane: PaneRow) => ({
        connection_id: id,
        connection_generation: generation,
        pane_id: String(pane.pane_id),
        terminal_id: String(pane.terminal_id),
      });
      await observe(a, "alpha");
      await observe(a, "beta");
      await a.assign(target("alpha", first), aStore.profile("builder")!);
      await a.setMaster({ terminal: target("alpha", first) });
      await observe(b, "alpha");
      await observe(b, "beta");
      expect(
        b
          .get()
          .assignments.some(
            (p) =>
              p.terminal_id === firstTerminal && p.profile_id === "builder",
          ),
      ).toBe(true);
      const moved = (
        await server.client.call("pane.move", {
          pane_id: first.pane_id,
          destination: { type: "new_workspace", label: "Moved settings test" },
          focus: false,
        })
      ).move_result.pane as PaneRow;
      expect(moved.terminal_id).toBe(firstTerminal);
      expect(
        readTerminalSettings(
          (await server.client.call("pane.get", { pane_id: moved.pane_id }))
            .pane,
        ),
      ).toMatchObject({ profile_id: "builder", master: 100 });
      // Two logical connection leases share this disposable runtime. Retire one
      // lease while the other remains usable, then restore its older observation.
      alphaOnline = false;
      await b.setMaster({ terminal: target("beta", second), replace: true });
      alphaOnline = true;
      await observe(a, "alpha");
      await observe(a, "beta");
      await observe(b, "alpha");
      await observe(b, "beta");
      expect(a.get().town_master?.terminal_id).toBe(secondTerminal);
      expect(b.get().town_master?.terminal_id).toBe(secondTerminal);
      expect(
        readTerminalSettings(
          (await server.client.call("pane.get", { pane_id: moved.pane_id }))
            .pane,
        ).master,
      ).toBeUndefined();
      for (const offset of [0, 16])
        await server.client.call("pane.report_metadata", {
          pane_id: full.pane_id,
          source: "settings-test",
          tokens: Object.fromEntries(
            Array.from({ length: 16 }, (_, i) => [`test_${offset + i}`, "v"]),
          ),
        });
      await expect(
        a.assign(target("beta", full), aStore.profile("builder")!),
      ).rejects.toThrow(/metadata_token_limit/);
      await server.client.call("pane.report_metadata", {
        pane_id: second.pane_id,
        source: "settings-test",
        tokens: { normalized: `  ${"x".repeat(90)}\u0001  ` },
      });
      expect(
        (await server.client.call("pane.get", { pane_id: second.pane_id })).pane
          .tokens.normalized,
      ).toBe("x".repeat(80));
      await stop();
      server = await start();
      generation++;
      const restored = (await server.client.call("pane.list"))
        .panes as PaneRow[];
      expect(
        restored.every(
          (pane) =>
            !pane.tokens &&
            pane.terminal_id !== firstTerminal &&
            pane.terminal_id !== secondTerminal,
        ),
      ).toBe(true);
      await observe(a, "alpha");
      await observe(a, "beta");
      expect(a.get().assignments).toEqual([]);
      expect(a.get().town_master).toBeNull();
    } finally {
      await stop();
      await Bun.spawn(["herdr", "session", "delete", session, "--json"], {
        stdout: "ignore",
        stderr: "ignore",
      }).exited;
      rmSync(root, { recursive: true, force: true });
    }
  },
  60_000,
);
