import { expect, test } from "bun:test";
import { createRuntimeUsage, usageDigest } from "./host";
import type { AgentSessionFileAccess } from "../agent/session-file-access";

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

test("runtime usage remains on the exact SSH host and revalidates pane continuity", async () => {
  let current = agent,
    collectedHost: string | undefined;
  const usage = createRuntimeUsage({
    sshHost: "operator@example.test",
    files: { remote: true } as AgentSessionFileAccess,
    herdrCall: async () => ({ agent: current }),
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
  current = { ...agent, terminal_id: "replacement" };
  expect((await usage([agent], Date.now())).bindings).toEqual([]);
});

test("unlinked Codex remains unattributed without cwd-based session guessing", async () => {
  let reads = 0;
  const usage = createRuntimeUsage({
    files: { remote: true } as AgentSessionFileAccess,
    herdrCall: async () => {
      reads++;
      throw new Error("must not infer");
    },
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
  expect(reads).toBe(0);
});

test("an unavailable SSH collector never retries through local files", async () => {
  const hosts: (string | undefined)[] = [];
  const usage = createRuntimeUsage({
    sshHost: "operator@example.test",
    files: { remote: true } as AgentSessionFileAccess,
    herdrCall: async () => ({ agent }),
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
  let current = true,
    reads = 0;
  const usage = createRuntimeUsage({
    files: { remote: true } as AgentSessionFileAccess,
    herdrCall: async () => {
      reads++;
      return { agent };
    },
    collect: async () => {
      current = false;
      return empty();
    },
  });
  await expect(usage([agent], Date.now(), () => current)).rejects.toThrow(
    "retired",
  );
  expect(reads).toBe(0);
});
