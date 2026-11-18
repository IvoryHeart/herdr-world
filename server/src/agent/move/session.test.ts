import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  prepareShell,
  copyMoveSession,
  readMoveSession,
  type PreparedShell,
  type MoveSession,
} from "./session";
import type { MoveRuntime } from "./runtime";
import { runProcessWithInputTimeout } from "../../workspace/process";
import { runProcessWithCodeTimeout } from "../../utils/process-utils";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const address = {
  connection_id: "example",
  generation: 1,
  workspace_id: "w1",
  tab_id: "w1:t1",
  pane_id: "w1:p1",
  terminal_id: "term-a",
  color_key: "example:w1:t1",
};
function runtime(change: Record<string, unknown> = {}) {
  return {
    address: async () => address,
    latest: async () => ({
      status: "ok",
      agent: "claude",
      agent_status: "idle",
      pending_prompt: null,
      session_fingerprint: "exact",
      session_binding: "reported",
      running_tool: null,
      deliveries: [],
      ...change,
    }),
    summary: async () => ({
      status: "ok",
      agent: "claude",
      path: "/synthetic/00000000-0000-0000-0000-000000000001.jsonl",
      session: { kind: "id", value: "00000000-0000-0000-0000-000000000001" },
    }),
    foreground: async () => ({ group: 10, cwd: "/work/example" }),
  } as unknown as MoveRuntime;
}
test.each([
  { agent_status: "working" },
  { agent_status: "blocked" },
  { pending_prompt: {} },
  { running_tool: {} },
  { deliveries: [{ state: "pending" }] },
  { session_binding: "guessed" },
  { session_fingerprint: null },
])("move refuses unsafe session evidence %j", async (state) => {
  await expect(readMoveSession(runtime(state), address)).rejects.toThrow();
});
test("exact resume ID is read for an idle harness; forged colour keys refuse", async () => {
  expect((await readMoveSession(runtime(), address)).id).toBe(
    "00000000-0000-0000-0000-000000000001",
  );
  await expect(
    readMoveSession(runtime(), { ...address, color_key: "elsewhere" }),
  ).rejects.toThrow("replaced");
});
test("preflight stages only; post-quit copy installs the final transcript without overwriting divergence", async () => {
  const root = await mkdtemp(join(tmpdir(), "move-session-"));
  roots.push(root);
  let text = '{"sessionId":"00000000-0000-0000-0000-000000000001"}\n';
  const source = {
    run: async () => Buffer.from(text).toString("base64"),
  } as unknown as MoveRuntime;
  const destination = {
    write: async (script: string, input: Buffer) => {
      const result = await runProcessWithInputTimeout(
        ["sh", "-c", script],
        input,
        5000,
      );
      if (result.code) throw new Error("write failed");
    },
    run: async (script: string) => {
      const result = await runProcessWithCodeTimeout(
        ["sh", "-c", script],
        5000,
      );
      if (result.code) throw new Error("copy failed");
      return result.stdout;
    },
  } as unknown as MoveRuntime;
  const shell = {
    runtime: destination,
    address,
    directory: root,
    config: join(root, "config"),
    cwd: "/work/example",
  } as PreparedShell;
  const session: MoveSession = {
    kind: "claude",
    id: "00000000-0000-0000-0000-000000000001",
    cwd: shell.cwd,
    group: 10,
    path: "/synthetic/move-test/no-source.jsonl",
  };
  const target = join(
    shell.config,
    "projects",
    "-work-example",
    session.id + ".jsonl",
  );
  await copyMoveSession(source, shell, session);
  await expect(Bun.file(target).exists()).resolves.toBe(false);
  text += '{"type":"exit"}\n';
  await copyMoveSession(source, shell, session, true);
  expect(await readFile(target, "utf8")).toBe(text);
  text += '{"type":"different"}\n';
  await expect(copyMoveSession(source, shell, session, true)).rejects.toThrow(
    "copy failed",
  );
});

test.each(["claude", "codex"] as const)(
  "%s preflight uses the terminal shell's PATH and login, not the service environment",
  async (kind) => {
    const root = await mkdtemp(join(tmpdir(), "move-shell-env-"));
    roots.push(root);
    await mkdir(join(root, "bin"));
    const executable = join(root, "bin", kind);
    const loggedIn =
      kind === "claude" ? '{"loggedIn":true}' : "Logged in using ChatGPT";
    await writeFile(executable, `#!/bin/sh\nprintf '%s\\n' '${loggedIn}'\n`, {
      mode: 0o700,
    });
    const run = async (script: string, inTerminal = false) => {
      const result = await runProcessWithCodeTimeout(
        ["sh", "-c", script],
        5000,
        inTerminal
          ? {
              env: {
                PATH: join(root, "bin") + ":" + process.env.PATH,
                HOME: root,
              },
            }
          : {},
      );
      if (result.code) throw new Error("probe failed");
      return result.stdout;
    };
    const terminal = {
      run,
      shellCommand: async (_address: unknown, script: string) => {
        await run(script, true);
      },
    } as unknown as MoveRuntime;
    const session: MoveSession = {
      kind,
      id: "00000000-0000-0000-0000-000000000001",
      cwd: root,
      group: 10,
      path: "/synthetic/session.jsonl",
    };
    const prepared = await prepareShell(terminal, address, session, root);
    roots.push(prepared.directory);
    expect(prepared.executable).toBe(executable);
    expect(prepared.config).toBe(
      join(root, kind === "codex" ? ".codex" : ".claude"),
    );
  },
);

test("a reading-only link cannot select a different conversation for a destructive move", async () => {
  const port = runtime({ agent: "codex" });
  port.summary = async () =>
    ({
      status: "ok",
      agent: "codex",
      path: "/synthetic/00000000-0000-0000-0000-000000000001.jsonl",
      session: {
        source: "world-link",
        kind: "id",
        value: "00000000-0000-0000-0000-000000000001",
      },
    }) as never;
  port.resumeIdentity = async () => undefined;
  await expect(readMoveSession(port, address)).rejects.toThrow("reading only");
  port.resumeIdentity = async () => ({
    kind: "id",
    value: "00000000-0000-0000-0000-000000000002",
  });
  await expect(readMoveSession(port, address)).rejects.toThrow("reading only");
  port.resumeIdentity = async () => ({
    kind: "id",
    value: "00000000-0000-0000-0000-000000000001",
  });
  expect((await readMoveSession(port, address)).id).toBe(
    "00000000-0000-0000-0000-000000000001",
  );
});

test("a source session switch between conversation and session reads refuses", async () => {
  const port = runtime();
  const latest = port.latest;
  let calls = 0;
  port.latest = async (a) => ({
    ...(await latest(a)),
    session_fingerprint: calls++ === 0 ? "original" : "replacement",
  });
  await expect(readMoveSession(port, address)).rejects.toThrow(
    "changed during",
  );
});
