import { expect, test } from "bun:test";
import { createTuiPassThrough } from "./herdr-runtime";
import { withAgentInput } from "./agent-input";

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
  for (const name of ["bash", "vim", "codex", "unknown", null])
    test(`${method} refuses ${name ?? "unknown"} foreground with stale Claude metadata`, async () => {
      const f = fixture(name);
      await expect(
        f.tui.call(method, {
          target: "w1:p1",
          pane_id: "w1:p1",
          text: "printf unsafe",
        }),
      ).rejects.toThrow("not attached");
      expect(f.writes).toEqual([]);
    });

test("input checks the same agent session around the foreground read", async () => {
  const f = fixture();
  const call = f.client.call.bind(f.client);
  f.client.call = async (method) => {
    if (method === "pane.process_info") f.changeSession();
    return call(method);
  };
  await expect(
    f.tui.call("agent.prompt", { target: "w1:p1", text: "hello" }),
  ).rejects.toThrow("not attached");
  expect(f.writes).toEqual([]);
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

test("the caller's original session survives transport preparation", async () => {
  const f = fixture();
  const info = (await f.client.call("agent.get")).agent!;
  f.changeSession();
  await expect(
    withAgentInput(info, () =>
      f.tui.call("agent.prompt", { target: "w1:p1", text: "hello" }),
    ),
  ).rejects.toThrow("not attached");
  expect(f.writes).toEqual([]);
});

for (const method of ["agent.prompt", "pane.send_input"])
  for (const name of ["bash", "vim", "codex"])
    test(`${method} refuses a ${name} foreground group containing an old Claude child`, async () => {
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
                  { pid: 20, name },
                  { pid: 21, name: "claude" },
                ],
              },
            }
          : call(method);
      await expect(
        f.tui.call(method, {
          target: "w1:p1",
          pane_id: "w1:p1",
          text: "printf unsafe",
        }),
      ).rejects.toThrow("not attached");
      expect(f.writes).toEqual([]);
    });
