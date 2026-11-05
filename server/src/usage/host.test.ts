import { expect, test } from "bun:test";
import { createRuntimeUsage, usageDigest } from "./host";

const agent = {
  agent: "claude",
  pane_id: "p1",
  tab_id: "t1",
  workspace_id: "w1",
  terminal_id: "term1",
  agent_session: { kind: "id", value: "synthetic-session" },
};
const empty = () => ({
  rows: [],
  sources: ["claude", "codex", "pi", "gemini"].map((harness) => ({
    harness,
    state: "missing" as const,
  })),
  truncated: false,
});

test("runtime usage stays on the exact SSH host and prepares a qualified binding", async () => {
  let collectedHost: string | undefined;
  const usage = createRuntimeUsage({
    sshHost: "operator@example.test",
    collect: async (_options, host) => {
      collectedHost = host;
      return empty();
    },
  });
  const result = await usage([agent], Date.now());
  expect(collectedHost).toBe("operator@example.test");
  expect(result.bindings[0]).toMatchObject({
    session_key: usageDigest("claude\0synthetic-session"),
    pane_id: "p1",
  });
  await usage.close();
});

test("unlinked Codex remains unattributed without cwd-based session guessing", async () => {
  const usage = createRuntimeUsage({
    collect: async () => empty(),
  });
  const result = await usage(
    [
      {
        ...agent,
        agent: "codex",
        agent_session: null,
        cwd: "/synthetic/project",
      },
    ],
    Date.now(),
  );
  expect(result.bindings).toEqual([]);
});

test("an unavailable SSH collector never retries through local files", async () => {
  const hosts: (string | undefined)[] = [];
  const usage = createRuntimeUsage({
    sshHost: "operator@example.test",

    collect: async (_options, host) => {
      hosts.push(host);
      throw new Error("missing remote tooling");
    },
  });
  await expect(usage([agent], Date.now())).rejects.toThrow(
    "missing remote tooling",
  );
  expect(hosts).toEqual(["operator@example.test"]);
});

test("retiring a runtime during collection prevents further pane reads", async () => {
  let current = true;
  const usage = createRuntimeUsage({
    collect: async () => {
      current = false;
      return empty();
    },
  });
  await expect(usage([agent], Date.now(), () => current)).rejects.toThrow(
    "retired",
  );
});

test("claims after the 128-agent resolution budget cannot establish unique attribution", async () => {
  const agents = Array.from({ length: 129 }, (_, i) => ({
    ...agent,
    pane_id: `p${i}`,
    terminal_id: `term${i}`,
    agent_session: {
      kind: "id",
      value: i === 128 ? "session-0" : `session-${i}`,
    },
  }));
  const usage = createRuntimeUsage({
    collect: async () => empty(),
  });
  const result = await usage(agents, Date.now());
  expect(result.truncated).toBe(true);
  expect(result.bindings).toEqual([]);
});

test("the connection runtime owns cancellation of its unreleased collector", async () => {
  const started = Promise.withResolvers<void>();
  let cancelled = false;
  const usage = createRuntimeUsage({
    collect: async (_options, _host, signal) =>
      new Promise((_resolve, reject) => {
        started.resolve();
        signal!.addEventListener(
          "abort",
          () => {
            cancelled = true;
            reject(new Error("cancelled"));
          },
          { once: true },
        );
      }),
  });
  const work = usage([agent], Date.now());
  await started.promise;
  const closed = usage.close();
  await expect(work).rejects.toThrow("cancelled");
  await closed;
  expect(cancelled).toBe(true);
});
