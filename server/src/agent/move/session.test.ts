import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  prepareShell,
  copyMoveSession,
  readMoveSession,
  resumeInShell,
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
    foreground: async () => ({
      group: 10,
      cwd: "/work/example",
      argv: [change.agent ?? "claude"],
    }),
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
    launchArgs: [],
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
      launchArgs: [],
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

test.each([
  {
    kind: "claude",
    argv: ["claude", "--model", "sonnet", "--permission-mode", "auto"],
    kept: ["--model", "sonnet", "--permission-mode", "auto"],
  },
  {
    kind: "codex",
    argv: [
      "codex",
      "-a",
      "never",
      "-s",
      "danger-full-access",
      "-m",
      "example-model",
      "resume",
      "00000000-0000-0000-0000-000000000002",
      "--cd",
      "/old/folder",
    ],
    kept: ["-a", "never", "-s", "danger-full-access", "-m", "example-model"],
  },
  {
    kind: "claude",
    argv: [
      "claude",
      "--session-id=00000000-0000-0000-0000-000000000002",
      "--agents",
      '{"reviewer":{"description":"Owner\'s helper","prompt":"Check $(touch injected) `touch injected`"}}',
      "--append-system-prompt",
      "--resume",
      "--continue",
    ],
    kept: [
      "--agents",
      '{"reviewer":{"description":"Owner\'s helper","prompt":"Check $(touch injected) `touch injected`"}}',
      "--append-system-prompt",
      "--resume",
    ],
  },
])(
  "$kind move keeps launch settings as literal shell arguments",
  async ({ kind, argv, kept }) => {
    const root = await mkdtemp(join(tmpdir(), "move-launch-"));
    roots.push(root);
    const originalCwd = join(root, "source");
    const destinationCwd = join(root, "destination");
    await mkdir(originalCwd);
    await mkdir(destinationCwd);
    const source = runtime({ agent: kind });
    const summary = await source.summary(address);
    source.summary = async () => ({ ...summary, agent: kind }) as never;
    source.foreground = async () => ({ group: 10, cwd: originalCwd, argv });
    const session = await readMoveSession(source, address);
    const executable = join(root, kind);
    await writeFile(executable, "#!/bin/sh\nprintf '%s\\0' \"$@\" > argv\n", {
      mode: 0o700,
    });
    const destination = {
      ...source,
      subscribe: () => () => {},
      input: async (_address: unknown, command: string) => {
        const result = await runProcessWithCodeTimeout(
          ["sh", "-c", command],
          5000,
        );
        if (result.code) throw new Error("resume command failed");
      },
    } as unknown as MoveRuntime;
    // The same launch settings apply to the destination and the recovery shell.
    for (const cwd of [destinationCwd, originalCwd]) {
      const shell = {
        address,
        runtime: destination,
        executable,
        cwd,
      } as PreparedShell;
      await resumeInShell(shell, session);
      expect(
        (await readFile(join(cwd, "argv"), "utf8")).split("\0").slice(0, -1),
      ).toEqual(
        kind === "codex"
          ? ["resume", session.id, ...kept, "--cd", cwd]
          : ["--resume", session.id, ...kept],
      );
      expect(await Bun.file(join(cwd, "injected")).exists()).toBe(false);
    }
  },
);

test.each(
  [
    undefined,
    [],
    ["sh"],
    ["claude", 123],
    ["claude", "--agents", "line\nbreak"],
  ].map((argv) => ({ argv })),
)(
  "missing or unsafe launch argv refuses before quitting: %j",
  async ({ argv }) => {
    const source = runtime();
    source.foreground = async () =>
      ({ group: 10, cwd: "/work/example", argv }) as never;
    await expect(readMoveSession(source, address)).rejects.toThrow(
      "launch arguments",
    );
  },
);

test.each([
  [
    "claude",
    ["claude", "-r", "old-session", "--fork-session", "--model=sonnet"],
    ["--model=sonnet"],
  ],
  [
    "claude",
    [
      "node",
      "/opt/example/claude-code/cli.js",
      "--continue",
      "--permission-mode=auto",
    ],
    ["--permission-mode=auto"],
  ],
  [
    "codex",
    [
      "node",
      "/opt/example/codex.js",
      "resume",
      "--model",
      "resume",
      "old-session",
      "-a",
      "never",
      "-C",
      "/old",
    ],
    ["--model", "resume", "-a", "never"],
  ],
  [
    "codex",
    [
      "codex",
      "resume",
      "--last",
      "--all",
      "--cd=/old",
      "--config",
      'model_reasoning_effort="high"',
      "--full-auto",
    ],
    ["--config", 'model_reasoning_effort="high"', "--full-auto"],
  ],
  [
    "claude",
    ["zsh", "-ic", '"$@"; exec "$0" -i', "zsh", "claude", "--agents={}"],
    ["--agents={}"],
  ],
  [
    "claude",
    ["claude", "-rold-session", "--model", "sonnet"],
    ["--model", "sonnet"],
  ],
  [
    "codex",
    [
      "codex",
      "-anever",
      "-sdanger-full-access",
      "-mexample-model",
      "resume",
      "old-session",
      "-C/old",
    ],
    ["-anever", "-sdanger-full-access", "-mexample-model"],
  ],
] as const)(
  "launch policy survives supported selectors and wrappers: %s %j",
  async (kind, argv, kept) => {
    const source = runtime({ agent: kind });
    source.summary = async () =>
      ({
        status: "ok",
        agent: kind,
        path: "/synthetic/session.jsonl",
        session: { kind: "id", value: "00000000-0000-0000-0000-000000000001" },
      }) as never;
    source.foreground = async () => ({ group: 10, cwd: "/work/example", argv });
    expect((await readMoveSession(source, address)).launchArgs).toEqual([
      ...kept,
    ]);
  },
);

test.each([
  ["claude", ["claude", "original prompt"]],
  ["claude", ["claude", "--unknown-option", "--resume"]],
  ["claude", ["claude", "--agents"]],
  ["codex", ["codex", "exec", "original prompt"]],
  ["codex", ["codex", "resume", "old-session", "original prompt"]],
] as const)(
  "ambiguous launch syntax refuses instead of replaying work: %s %j",
  async (kind, argv) => {
    const source = runtime({ agent: kind });
    const summary = await source.summary(address);
    source.summary = async () => ({ ...summary, agent: kind }) as never;
    source.foreground = async () => ({ group: 10, cwd: "/work/example", argv });
    await expect(readMoveSession(source, address)).rejects.toThrow(
      "launch arguments",
    );
  },
);
