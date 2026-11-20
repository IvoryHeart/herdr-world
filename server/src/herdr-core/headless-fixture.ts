import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { fixtures } from "../agent/testing/conversation-fixtures";
import type { FakeCore } from "./testing/fake-core";

/** Testing only: real writable descriptors, synthetic core records, no model calls. */
export async function headlessFixture(
  fake: FakeCore,
  root: string,
  terminals: { builder: string; reviewer: string },
) {
  if (process.platform === "win32")
    throw new Error("Headless Chat fixture needs a Unix host.");
  const children: ReturnType<typeof Bun.spawn>[] = [];
  const stop = async () => {
    for (const child of children) child.kill();
    await Promise.all(children.map((child) => child.exited));
  };
  try {
    for (const [agent, terminal] of [
      ["codex", terminals.builder],
      ["claude", terminals.reviewer],
    ] as const) {
      const path = await fixtures
        .find((item) => item.agent === agent)!
        .write(root);
      // Claude's native top-level transcript shape; the fixture writer's
      // generic name is renamed without exposing any real session directory.
      let transcript = path;
      if (agent === "claude") {
        const project = join(root, "projects", "-work-demo");
        await mkdir(project, { recursive: true });
        transcript = join(
          project,
          "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.jsonl",
        );
        await rename(path, transcript);
      }
      const child = Bun.spawn(
        [
          "sh",
          "-c",
          'exec 3>>"$1"; printf ready; read line',
          "fixture",
          transcript,
        ],
        { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
      );
      children.push(child);
      const reader = child.stdout.getReader();
      const ready = await reader.read();
      reader.releaseLock();
      if (ready.done)
        throw new Error("Fixture transcript writer did not start.");
      fake.foreground(terminal, {
        pid: child.pid,
        name: agent,
        argv: [agent, agent === "codex" ? "exec" : "-p"],
        cwd: root,
      });
      // Remove the original resume reference as well as the foreground flags.
      fake.terminal(terminal)!.argv = [
        agent,
        agent === "codex" ? "exec" : "-p",
      ];
    }
    return { stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
