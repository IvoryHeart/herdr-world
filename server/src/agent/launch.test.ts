import { describe, expect, test } from "bun:test";
import { agentKinds, launchAgent, type HerdrCall } from "./launch";

/**
 * A fake Herdr whose new shell refuses `agent.start` for the first `busy`
 * attempts, as a real one does until the shell reaches its prompt.
 */
function herdr(
  options: {
    busy?: number;
    taken?: string[];
    refuse?: string;
    /** The harness exits at once: no agent, the shell back in front. */
    exits?: boolean;
  } = {},
) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let started: Record<string, unknown> | undefined;
  let busy = options.busy ?? 0;
  const call: HerdrCall = async (method, params) => {
    calls.push({ method, params });
    if (method === "agent.list")
      return { agents: (options.taken ?? []).map((name) => ({ name })) };
    if (method === "tab.create")
      return {
        tab: { tab_id: "w1:t9" },
        root_pane: { pane_id: "w1:p9", terminal_id: "term_new" },
      };
    if (method === "agent.start") {
      if (options.refuse) throw new Error(options.refuse);
      if (busy-- > 0)
        throw new Error(
          "agent_pane_busy: agent target pane w1:p9 is not an available shell",
        );
      if (options.taken?.includes(String(params.name)))
        throw new Error(`agent_name_taken: agent name ${params.name} is used`);
      started = params;
      return { agent: { pane_id: "w1:p9" } };
    }
    if (method === "pane.get")
      return { pane: { pane_id: "w1:p9", terminal_id: "term_new" } };
    if (method === "pane.process_info")
      return {
        process_info: {
          shell_pid: 10,
          foreground_process_group_id: options.exits ? 10 : 11,
        },
      };
    if (method === "agent.get") {
      if (!started) throw new Error("agent_not_found: none");
      if (options.exits)
        // Herdr lists the launch as pending until its timeout.
        return {
          agent: {
            pane_id: "w1:p9",
            agent: started.kind,
            name: started.name,
            launch_pending: true,
            agent_status: "unknown",
          },
        };
      return {
        agent: {
          pane_id: "w1:p9",
          terminal_id: "term_new",
          agent: started.kind,
          name: started.name,
          agent_status: "idle",
          interactive_ready: true,
        },
      };
    }
    if (method === "agent.prompt") return { agent: { pane_id: "w1:p9" } };
    throw new Error(`unexpected ${method}`);
  };
  const starts = () => calls.filter((c) => c.method === "agent.start");
  return { call, calls, starts };
}

function request(patch: Partial<Parameters<typeof launchAgent>[1]> = {}) {
  let clock = 0;
  return {
    workspace_id: "w1",
    kind: "claude",
    label: "Plan the migration",
    text: "",
    isCurrent: () => true,
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
    timeoutMs: 5_000,
    ...patch,
  };
}

describe("Launching an agent in a new tab", () => {
  test("waits for the new shell instead of leaving a plain shell (#219)", async () => {
    const h = herdr({ busy: 3 });
    expect(await launchAgent(h.call, request())).toMatchObject({
      status: "started",
      pane_id: "w1:p9",
    });
    expect(h.starts()).toHaveLength(4);
  });

  test("a shell that never becomes ready fails and says so", async () => {
    const h = herdr({ busy: 1_000 });
    expect(await launchAgent(h.call, request())).toMatchObject({
      status: "failed",
      message: expect.stringContaining("shell did not become ready"),
      tab_id: "w1:t9",
    });
  });

  test("the tab keeps its label and the agent gets a valid, free Herdr name", async () => {
    const h = herdr({ taken: ["plan-the-migration"] });
    expect(await launchAgent(h.call, request())).toMatchObject({
      status: "started",
      agent_name: "plan-the-migration-2",
    });
    expect(h.calls.find((c) => c.method === "tab.create")?.params).toEqual({
      workspace_id: "w1",
      label: "Plan the migration",
    });
  });

  test("a name taken after listing is refused and the next one is used", async () => {
    const h = herdr({ taken: ["reviewer"] });
    // The list saw nothing; Herdr's refusal starts nothing, so retry.
    const call: HerdrCall = (method, params) =>
      method === "agent.list"
        ? Promise.resolve({ agents: [] })
        : h.call(method, params);
    expect(
      await launchAgent(call, request({ label: "Reviewer" })),
    ).toMatchObject({ status: "started", agent_name: "reviewer-2" });
  });

  test("passes the profile's native arguments and prompts once when ready", async () => {
    const h = herdr();
    const outcome = await launchAgent(
      h.call,
      request({ kind: "codex", args: ["-m", "example-model"], text: "Go" }),
    );
    expect(outcome.status).toBe("sent");
    expect(h.starts()[0]!.params).toMatchObject({
      kind: "codex",
      args: ["-m", "example-model"],
    });
    expect(h.calls.filter((c) => c.method === "agent.prompt")).toHaveLength(1);
  });

  test("a harness that exits as it starts fails soon, not at the timeout", async () => {
    const h = herdr({ exits: true });
    const outcome = await launchAgent(h.call, request({ timeoutMs: 60_000 }));
    expect(outcome).toMatchObject({
      status: "failed",
      message: expect.stringContaining("exited as it started"),
    });
    expect(h.calls.filter((c) => c.method === "agent.get").length).toBeLessThan(
      12,
    );
  });

  test("another refusal fails at once with Herdr's reason", async () => {
    const h = herdr({
      refuse: "unsupported_agent: kind muse is not installed",
    });
    expect(await launchAgent(h.call, request({ kind: "muse" }))).toMatchObject({
      status: "failed",
      message: expect.stringContaining("not installed"),
    });
    expect(h.starts()).toHaveLength(1);
  });
});

describe("Agent kinds from the host", () => {
  test("come from Herdr's agent manifests", async () => {
    expect(
      await agentKinds(async () => ({
        manifests: [{ agent: "pi" }, { agent: "claude" }, { agent: "../x" }],
      })),
    ).toEqual(["pi", "claude"]);
  });
  test("fall back to Claude and Codex on an older Herdr", async () => {
    expect(
      await agentKinds(async () => {
        throw new Error("unknown_method: server.agent_manifests");
      }),
    ).toEqual(["claude", "codex"]);
  });
});
