import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HerdrClient } from "../bridge/herdr-client";
import { resolveHerdrSocketPaths } from "../config/server-config";
import { herdrAdapter } from "./herdr";
import { AdapterSession } from "./session";

const live = process.env.HERDR_WORLD_LIVE_ADAPTERS === "1" ? test : test.skip;

live(
  "Herdr adapter observes one disposable named session and refuses terminal writes",
  async () => {
    const binary = Bun.which("herdr");
    expect(binary).not.toBeNull();
    const name = "world-adapter-" + crypto.randomUUID().slice(0, 8);
    const directory = mkdtempSync(join(tmpdir(), "world-adapter-"));
    const child = Bun.spawn([binary!, "--session", name, "server"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const run = async (args: string[]) => {
      const command = Bun.spawn([binary!, "--session", name, ...args], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, output] = await Promise.all([
        command.exited,
        new Response(command.stdout).text(),
        new Response(command.stderr).text(),
      ]);
      if (code !== 0) throw new Error("disposable Herdr command failed");
      return output;
    };
    const client = new HerdrClient(
      resolveHerdrSocketPaths({ session: name }).socketPath,
    );
    const session = new AdapterSession(
      herdrAdapter,
      {
        call: client.call.bind(client),
        epoch: () => name,
      },
      {
        instanceId: "disposable",
        isCurrent: () => true,
        monotonic: () => performance.now(),
      },
      true,
    );
    try {
      // Block on the server's readiness message, rather than probing sockets.
      const reader = child.stderr.getReader();
      let ready = "";
      const deadline = AbortSignal.timeout(15000);
      const abort = () => {
        void reader.cancel();
      };
      deadline.addEventListener("abort", abort, { once: true });
      try {
        while (!ready.includes("api socket:")) {
          const next = await reader.read();
          if (next.done)
            throw new Error("disposable Herdr did not announce readiness");
          ready += new TextDecoder().decode(next.value);
        }
      } finally {
        deadline.removeEventListener("abort", abort);
        reader.releaseLock();
      }
      await run([
        "workspace",
        "create",
        "--cwd",
        directory,
        "--label",
        "Conformance",
        "--no-focus",
      ]);
      const rows = await session.refresh();
      const panes = rows.filter((row) => row.kind === "pane");
      expect(panes.length).toBeGreaterThan(0);
      expect(rows.some((row) => row.kind === "workspace")).toBe(true);
      for (const pane of panes) {
        expect(pane.evidence).not.toBeNull();
        expect(session.resolve(pane)).toBe("attached");
      }
      await expect(session.dispatch("terminal.send_text", {})).rejects.toThrow(
        "undeclared",
      );
      expect(await session.dispatch("pane.list", {})).toHaveProperty("panes");
    } finally {
      session.retire();
      try {
        await run(["server", "stop"]);
      } finally {
        child.kill();
        await child.exited;
        await run(["session", "delete", name]);
        rmSync(directory, { recursive: true, force: true });
      }
    }
  },
  25000,
);
