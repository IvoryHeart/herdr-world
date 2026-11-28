import { expect, test } from "bun:test";
import type { TuiControlClient } from "./herdr-runtime";
import { createTuiPassThrough } from "./herdr-runtime";
import { foregroundInputRefusal, withAgentInput } from "./agent-input";

function fixture(name: string | null = "claude") {
  let session = "original";
  let reads = 0;
  const writes: string[] = [];
  const client: TuiControlClient = {
    async call(method: string) {
      if (method === "agent.get") {
        reads++;
        return {
          agent: {
            pane_id: "w1:p1",
            terminal_id: "terminal-1",
            agent: "claude",
            agent_session: {
              source: "herdr:claude",
              agent: "claude",
              kind: "id",
              value: session,
            },
          },
        };
      }
      if (method === "pane.process_info")
        return {
          process_info: {
            pane_id: "w1:p1",
            shell_pid: 10,
            foreground_process_group_id: 20,
            foreground_processes: name ? [{ pid: 20, name }] : [],
          },
        };
      writes.push(method);
      return { sent: true };
    },
  };
  return {
    writes,
    client,
    tui: createTuiPassThrough("herdr", client),
    changeSession() {
      session = "replacement";
    },
    reads: () => reads,
  };
}

for (const method of ["agent.prompt", "pane.send_input"])
  for (const name of [
    "bash",
    "vim",
    "less",
    "python",
    "node",
    "ssh",
    "sudo",
    "psql",
    "tmux",
    "screen",
    "zellij",
    "docker",
  ])
    test(`${method} refuses ${name} foreground with stale Claude metadata`, async () => {
      const f = fixture(name);
      await expect(
        withAgentInput(null, () =>
          f.tui.call(method, {
            target: "w1:p1",
            pane_id: "w1:p1",
            text: "printf unsafe",
          }),
        ),
      ).rejects.toThrow("agent_not_ready:");
      expect(f.writes).toEqual([]);
    });

for (const [name, argv] of [
  ["/bin/bash", ["bash", "--rcfile", "example"]],
  ["bash", ["bash", "-o", "vi"]],
  ["zsh", ["zsh", "-o", "vi"]],
  ["sh", ["sh", "-c", "agent"]],
  ["node", ["node", "agent.js"]],
  ["python3.13", ["python3", "agent.py"]],
  ["docker", ["docker", "exec", "-it", "example", "sh"]],
  ["busybox", ["busybox", "sh"]],
  ["C:\\Windows\\System32\\cmd.exe", []],
  ["-bash", []],
] as const)
  test(`refuses executable ${name} regardless of arguments`, () => {
    expect(foregroundInputRefusal({ name, argv })).toBeString();
  });

for (const name of ["claude", "codex", "new-agent"])
  test(`admits ${name} using executable name alone`, async () => {
    const f = fixture(name);
    f.changeSession();
    await f.tui.call("agent.prompt", { target: "w1:p1", text: "hello" });
    expect(f.writes).toEqual(["agent.prompt"]);
    expect(
      foregroundInputRefusal({ name, argv: ["bash", "--interactive"] }),
    ).toBeNull();
  });

for (const method of ["agent.prompt", "pane.send_input"])
  for (const reverse of [false, true])
    test(`${method} checks only the group leader (reverse=${reverse}), without tty information`, async () => {
      const f = fixture();
      const call = f.client.call.bind(f.client);
      const programs = [
        { pid: 20, name: "claude" },
        { pid: 21, name: "bash" },
        { pid: 22, name: "python3" },
        { pid: 23, name: "docker" },
        { pid: 24, name: "vim" },
      ];
      f.client.call = async (method) =>
        method === "pane.process_info"
          ? {
              process_info: {
                pane_id: "w1:p1",
                foreground_process_group_id: 20,
                foreground_processes: reverse
                  ? [...programs].reverse()
                  : programs,
              },
            }
          : call(method);
      await withAgentInput(null, () =>
        f.tui.call(method, {
          target: "w1:p1",
          pane_id: "w1:p1",
          text: "An answer",
        }),
      );
      expect(f.writes).toEqual([method]);
    });

for (const process_info of [
  undefined,
  {},
  { foreground_process_group_id: 20, foreground_processes: [] },
  {
    foreground_process_group_id: 20,
    foreground_processes: [{ pid: 21, name: "bash" }],
  },
  {
    foreground_process_group_id: 20,
    foreground_processes: [{ pid: 20, argv: [] }],
  },
])
  test(`missing TUI foreground preserves input: ${JSON.stringify(process_info)}`, async () => {
    const f = fixture();
    const call = f.client.call.bind(f.client);
    f.client.call = async (method) =>
      method === "pane.process_info" ? ({ process_info } as any) : call(method);
    await f.tui.call("agent.prompt", { target: "w1:p1", text: "hello" });
    expect(f.writes).toEqual(["agent.prompt"]);
  });

test("TUI without process-info support preserves input", async () => {
  const f = fixture();
  const call = f.client.call.bind(f.client);
  f.client.call = async (method) => {
    if (method === "pane.process_info") throw new Error("Unknown method");
    return call(method);
  };
  await f.tui.call("agent.prompt", { target: "w1:p1", text: "hello" });
  expect(f.writes).toEqual(["agent.prompt"]);
});

test("missing foreground does not itself refuse input", () => {
  for (const leader of [null, undefined, {}, { name: "" }])
    expect(foregroundInputRefusal(leader)).toBeNull();
});

test("a missing target still refuses before typing", async () => {
  const f = fixture();
  f.client.call = async () => ({}) as any;
  await expect(
    f.tui.call("agent.prompt", { target: "missing", text: "hello" }),
  ).rejects.toThrow("agent_input_unavailable:");
  expect(f.writes).toEqual([]);
});

test("the final native dispatch guard is preserved", async () => {
  const f = fixture();
  let guarded = false;
  const call = f.client.call.bind(f.client);
  const tui = createTuiPassThrough("herdr", {
    call(method, _params, _timeout, beforeSend) {
      beforeSend?.();
      return call(method);
    },
  });
  await tui.call(
    "agent.prompt",
    { target: "w1:p1", text: "hello" },
    1000,
    () => {
      guarded = true;
    },
  );
  expect(guarded).toBe(true);
  expect(f.writes).toEqual(["agent.prompt"]);
});
