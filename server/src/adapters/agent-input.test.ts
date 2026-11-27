import { expect, test } from "bun:test";
import { createTuiPassThrough } from "./herdr-runtime";
import { foregroundInputRefusal, withAgentInput } from "./agent-input";

function fixture(name: string | null = "claude") {
  let session = "original";
  let reads = 0;
  const writes: string[] = [];
  const client = {
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
  for (const name of ["bash", "vim", "python", "node", "ssh", "sudo", "psql"])
    test(`${method} refuses ${name ?? "unknown"} foreground with stale Claude metadata`, async () => {
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

test("a resumed agent is admitted without original-session matching", async () => {
  const f = fixture();
  const info = (await f.client.call("agent.get")).agent!;
  f.changeSession();
  await withAgentInput(info, () =>
    f.tui.call("agent.prompt", { target: "w1:p1", text: "hello" }),
  );
  expect(f.writes).toEqual(["agent.prompt"]);
});

test("matching foreground sends once and preserves the final dispatch guard", async () => {
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

for (const name of ["bash", "vim", "less"])
  for (const method of ["agent.prompt", "pane.send_input"])
    test(`${method} refuses a Claude leader with a ${name} child`, async () => {
      const f = fixture();
      const call = f.client.call.bind(f.client);
      f.client.call = async (method) =>
        method === "pane.process_info"
          ? {
              process_info: {
                pane_id: "w1:p1",
                shell_pid: 10,
                foreground_process_group_id: 20,
                foreground_processes: [
                  { pid: 20, name: "claude" },
                  { pid: 21, name },
                ],
              },
            }
          : call(method);
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
  ["codex", ["codex"]],
  ["new-agent", ["new-agent"]],
  ["node", ["node", "/opt/agent/cli.js"]],
  ["node", ["node", "/opt/agent/cli.js", "--interactive"]],
  ["python", ["python", "/opt/agent/cli.py", "-i"]],
  ["bash", ["bash", "run-agent.sh", "-i"]],
  ["bash", ["bash", "run-agent.sh"]],
  ["sh", ["sh", "-c", "mcp-server"]],
] as const)
  test(`admits ${argv.join(" ")} without a harness allowlist`, async () => {
    const f = fixture();
    const call = f.client.call.bind(f.client);
    f.client.call = async (method) =>
      method === "pane.process_info"
        ? {
            process_info: {
              pane_id: "w1:p1",
              shell_pid: 10,
              foreground_process_group_id: 20,
              foreground_processes: [
                { pid: 20, name, argv: [...argv] },
                { pid: 21, name: "new-agent" },
              ],
            },
          }
        : call(method);
    await f.tui.call("agent.prompt", { target: "w1:p1", text: "hello" });
    expect(f.writes).toEqual(["agent.prompt"]);
  });

test("working titles, state changes and revisions do not replace an agent session", async () => {
  const f = fixture();
  const info = (await f.client.call("agent.get")).agent!;
  const call = f.client.call.bind(f.client);
  let revision = 0;
  f.client.call = async (method) => {
    const result = await call(method);
    if (method === "agent.get")
      Object.assign(result.agent!, {
        terminal_title: `Working ${++revision}`,
        state_change_seq: revision,
        revision,
      });
    return result;
  };
  await withAgentInput(info, () =>
    f.tui.call("agent.prompt", { target: "w1:p1", text: "hello" }),
  );
  expect(f.writes).toEqual(["agent.prompt"]);
});

for (const failureAt of [1, 2])
  test(`admission read failure ${failureAt} is unavailable and permits a fresh retry`, async () => {
    const f = fixture();
    const call = f.client.call.bind(f.client);
    let reads = 0;
    f.client.call = async (method) => {
      if (++reads === failureAt) throw new Error("RPC timeout");
      return call(method);
    };
    await expect(
      f.tui.call("agent.prompt", { target: "w1:p1", text: "hello" }),
    ).rejects.toThrow("agent_input_unavailable:");
    expect(f.writes).toEqual([]);
    await f.tui.call("agent.prompt", { target: "w1:p1", text: "hello" });
    expect(f.writes).toEqual(["agent.prompt"]);
  });

for (const malformed of ["agent.get", "pane.process_info"])
  test(`malformed ${malformed} reply is unavailable, not a changed agent`, async () => {
    const f = fixture();
    const call = f.client.call.bind(f.client);
    const tui = createTuiPassThrough("herdr", {
      call: async (method) => (method === malformed ? {} : call(method)),
    });
    await expect(
      tui.call("agent.prompt", { target: "w1:p1", text: "hello" }),
    ).rejects.toThrow("agent_input_unavailable:");
    expect(f.writes).toEqual([]);
  });

for (const argv of [
  ["python3", "-i", "agent.py"],
  ["python3.13"],
  ["node", "--title", "agent"],
  ["node", "-i", "agent.js"],
  ["node", "-e", "expression", "-i"],
  ["bash", "-s", "argument"],
  ["irb"],
  ["less"],
  ["su"],
  ["mysql"],
  ["sqlite3", "example.db"],
])
  test(`refuses interactive ${argv.join(" ")}`, () => {
    expect(foregroundInputRefusal([{ name: argv[0], argv }])).toBeString();
  });

test("empty foreground evidence is temporary, never a permanent refusal", () => {
  expect(() => foregroundInputRefusal([])).toThrow("agent_input_unavailable:");
});
