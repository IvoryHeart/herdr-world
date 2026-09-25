import { describe, expect, test } from "bun:test";
import {
  normalizeTaskSummary,
  runTaskSummaryCommand,
  taskSummarySessionFingerprint,
} from "./task-summary";

const session = {
  source: "herdr:codex",
  agent: "codex",
  kind: "id",
  value: "synthetic-session-a",
};

function fakeConfig(sshHost?: string) {
  return {
    socketPath: "/tmp/synthetic-herdr.sock",
    clientSocketPath: "/tmp/synthetic-herdr-client.sock",
    sshHost,
  } as never;
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    log: (message: string) => out.push(message),
    error: (message: string) => err.push(message),
  };
}

describe("task-summary", () => {
  test("reports an exact pane with a paired session fingerprint and shared TTL", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> =
      [];
    const io = capture();
    const code = await runTaskSummaryCommand(
      [
        "task-summary",
        "Reviewing",
        "CI",
        "--pane",
        "w1:p1",
        "--ttl-ms",
        "1200",
      ],
      "0.0.0",
      {
        ...io,
        loadConfig: () => fakeConfig(),
        createClient: () => ({
          call: async (method, params = {}) => {
            calls.push({ method, params });
            if (method === "pane.get") {
              return { pane_id: "w1:p1", agent_session: session };
            }
            return { type: "pane_metadata" };
          },
        }),
      },
    );

    expect(code).toBe(0);
    expect(calls).toEqual([
      { method: "pane.get", params: { pane_id: "w1:p1" } },
      {
        method: "pane.report_metadata",
        params: {
          pane_id: "w1:p1",
          source: "herdr-world:task-summary",
          tokens: {
            task_summary: "Reviewing CI",
            task_summary_session: taskSummarySessionFingerprint(session),
          },
          ttl_ms: 1200,
        },
      },
    ]);
    expect(io.out.join("\n")).toContain('"status":"reported"');
    expect(io.out.join("\n")).not.toContain("Reviewing CI");
  });

  test("rejects clear and invalid input before loading a transport or sending metadata", async () => {
    let loaded = 0;
    const clear = capture();
    expect(
      await runTaskSummaryCommand(["task-summary", "--clear"], "0.0.0", {
        ...clear,
        loadConfig: () => {
          loaded += 1;
          return fakeConfig();
        },
      }),
    ).toBe(2);
    expect(loaded).toBe(0);
    expect(clear.err.join("\n")).toContain("does not support --clear");

    const invalid = capture();
    expect(
      await runTaskSummaryCommand(
        ["task-summary", "--pane", "w1:p1", "--ttl-ms", "0", "text"],
        "0.0.0",
        { ...invalid, loadConfig: () => fakeConfig() },
      ),
    ).toBe(2);
    expect(loaded).toBe(0);

    const inheritedPane = process.env.HERDR_PANE_ID;
    delete process.env.HERDR_PANE_ID;
    try {
      const noPane = capture();
      expect(
        await runTaskSummaryCommand(["task-summary", "text"], "0.0.0", {
          ...noPane,
          loadConfig: () => {
            loaded += 1;
            return fakeConfig();
          },
        }),
      ).toBe(2);
      expect(loaded).toBe(0);
      expect(noPane.err.join("\n")).toContain("requires --pane");
    } finally {
      if (inheritedPane === undefined) delete process.env.HERDR_PANE_ID;
      else process.env.HERDR_PANE_ID = inheritedPane;
    }
  });

  test("does not report when the target session is missing, malformed, or replaced", async () => {
    for (const target of [
      { pane_id: "w1:p1" },
      { pane_id: "w1:p1", agent_session: { ...session, source: "" } },
      { pane_id: "another-pane", agent_session: session },
    ]) {
      const calls: string[] = [];
      const code = await runTaskSummaryCommand(
        ["task-summary", "text", "--pane", "w1:p1"],
        "0.0.0",
        {
          loadConfig: () => fakeConfig(),
          error: () => undefined,
          createClient: () => ({
            call: async (method) => {
              calls.push(method);
              return target;
            },
          }),
        },
      );
      expect(code).toBe(1);
      expect(calls).toEqual(["pane.get"]);
    }
  });

  test("uses one fixed-policy SSH tunnel and cleans it up after the one-shot report", async () => {
    const events: string[] = [];
    const code = await runTaskSummaryCommand(
      [
        "task-summary",
        "text",
        "--pane",
        "w1:p1",
        "--ssh-host",
        "example.invalid",
      ],
      "0.0.0",
      {
        loadConfig: () => fakeConfig("example.invalid"),
        error: () => undefined,
        createTunnel: () => ({
          startAutoSshTunnel: async () => void events.push("start"),
          cleanupAutoSshTunnel: async () => void events.push("cleanup"),
        }),
        createClient: () => ({
          call: async (method) =>
            method === "pane.get"
              ? { pane_id: "w1:p1", agent_session: session }
              : {},
        }),
      },
    );
    expect(code).toBe(0);
    expect(events).toEqual(["start", "cleanup"]);
  });

  test("normalizes, redacts, bounds Unicode, and accepts dash-prefixed text after --", async () => {
    expect(normalizeTaskSummary("  Running\n release\tchecks ")).toBe(
      "Running release checks",
    );
    expect(normalizeTaskSummary("password=synthetic-secret-value")).toBe(
      "[redacted]",
    );
    const bounded = normalizeTaskSummary("界".repeat(100));
    expect(Array.from(bounded)).toHaveLength(80);
    expect(bounded.endsWith("…")).toBe(true);

    const calls: Array<Record<string, unknown>> = [];
    await runTaskSummaryCommand(
      ["task-summary", "--pane", "w1:p1", "--", "-not-an-option"],
      "0.0.0",
      {
        loadConfig: () => fakeConfig(),
        error: () => undefined,
        createClient: () => ({
          call: async (method, params = {}) => {
            calls.push({ method, ...params });
            return method === "pane.get"
              ? { pane_id: "w1:p1", agent_session: session }
              : {};
          },
        }),
      },
    );
    expect(calls[1]?.tokens).toMatchObject({ task_summary: "-not-an-option" });
  });
});
