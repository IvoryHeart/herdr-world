import { expect, test } from "bun:test";
import { createAgentWorktree } from "./worktree";
import {
  agentCheckoutSessionFingerprint,
  agentCheckoutTokens,
} from "../herdr/agent-checkout";
import type {
  AgentWorktreeObservation,
  AgentWorktreeSubject,
  AgentWorktreeTarget,
} from "../../../shared/agentWorktree";
import type { WorktreeGitRoot } from "./worktree-git";

function fixture(onInspect?: (path: string) => Promise<void>) {
  const session = {
    source: "herdr:codex",
    agent: "codex",
    kind: "id",
    value: "synthetic-session",
  };
  const subject: AgentWorktreeSubject = {
    connectionId: "alpha",
    generation: 7,
    paneId: "pane",
    terminalId: "terminal",
    sessionFingerprint: agentCheckoutSessionFingerprint(session),
  };
  const state = {
    pane: {
      pane_id: "pane",
      terminal_id: "terminal",
      workspace_id: "workspace",
      agent: "codex",
      agent_session: session,
      foreground_cwd: "/project/main",
      tokens: {} as Record<string, string | null>,
    },
    metadataUnavailable: false,
    metadata: {
      cwd: "/project/agent",
      branch: "agent/topic",
      sourceRef: "Codex rollout cwd",
    },
    roots: new Map<string, WorktreeGitRoot>(),
    lists: [
      { path: "/project/main", branch: "main" },
      { path: "/project/agent", branch: "agent/topic" },
    ],
  };
  for (const entry of state.lists)
    state.roots.set(entry.path, {
      canonicalRoot: entry.path,
      gitCommonDir: "/project/main/.git",
      branch: entry.branch,
      head: "abc123",
    });
  const model = createAgentWorktree({
    connectionId: "alpha",
    generation: 7,
    herdr: {
      async call(method) {
        if (method === "pane.get") return { pane: state.pane };
        if (method === "workspace.get")
          return { workspace: { cwd: "/project/main" } };
        throw new Error(method);
      },
    },
    inspect: async (path) => {
      await onInspect?.(path);
      return state.roots.get(path) ?? null;
    },
    list: async () => state.lists,
    readSessionMetadata: async () => {
      if (state.metadataUnavailable)
        throw new Error("Synthetic transcript read failure");
      return state.metadata;
    },
  });
  return { model, state, subject, session };
}
const target = (
  observation: AgentWorktreeObservation,
  candidateId = observation.selectedCandidateId!,
): AgentWorktreeTarget => ({
  subject: observation.subject,
  revision: observation.revision,
  candidateId,
});

test("live foreground evidence ranks first and own session conflict stays selectable", async () => {
  const { model, state, subject } = fixture();
  const observation = await model.get(subject);
  expect(observation.state).toBe("resolved");
  expect(
    observation.candidates.find(
      (candidate) => candidate.candidateId === observation.selectedCandidateId,
    ),
  ).toMatchObject({ canonicalRoot: "/project/main", source: "foreground_cwd" });
  const alternate = observation.candidates.find(
    (candidate) => candidate.canonicalRoot === state.metadata.cwd,
  )!;
  expect(alternate.source).toBe("session_cwd");
  expect(
    (await model.resolve(target(observation, alternate.candidateId))).root,
  ).toBe("/project/agent");
  expect((await model.get(subject)).selectedCandidateId).toBe(
    observation.selectedCandidateId,
  );
});

test("missing live cwd uses only own session/report evidence, including detached HEAD", async () => {
  const { model, state, subject, session } = fixture();
  state.pane.foreground_cwd = "/outside-git";
  state.roots.set("/project/agent", {
    canonicalRoot: "/project/agent",
    gitCommonDir: "/project/main/.git",
    branch: null,
  });
  state.pane.tokens = agentCheckoutTokens(session, "/project/agent");
  const observation = await model.get(subject);
  expect(observation.state).toBe("resolved");
  expect(
    (await model.resolve(target(observation))).candidate.branch,
  ).toBeNull();
  state.metadata.cwd = "";
  expect(
    (await model.get(subject)).candidates.find(
      (candidate) => candidate.source === "agent_report",
    )?.canonicalRoot,
  ).toBe("/project/agent");
});

test("branch matches are inferred only within a known repo, and duplicate matches are ambiguous", async () => {
  const { model, state, subject } = fixture();
  state.pane.foreground_cwd = "";
  state.metadata.cwd = "";
  let observation = await model.get(subject);
  expect(observation.state).toBe("resolved");
  expect(
    observation.candidates.find(
      (candidate) => candidate.candidateId === observation.selectedCandidateId,
    )?.source,
  ).toBe("branch_match");
  state.lists.push({ path: "/project/second", branch: "agent/topic" });
  state.roots.set("/project/second", {
    canonicalRoot: "/project/second",
    gitCommonDir: "/project/main/.git",
    branch: "agent/topic",
  });
  observation = await model.get(subject, { refresh: true });
  expect(observation.state).toBe("ambiguous");
  expect(observation.selectedCandidateId).toBeNull();
  const chosen = observation.candidates.find(
    (candidate) => candidate.canonicalRoot === "/project/second",
  )!;
  expect(
    (await model.resolve(target(observation, chosen.candidateId))).root,
  ).toBe("/project/second");
});

test("a repository list without an agent branch is never an automatic target", async () => {
  const { model, state, subject } = fixture();
  state.pane.foreground_cwd = state.metadata.cwd = state.metadata.branch = "";
  const observation = await model.get(subject);
  expect(observation.state).toBe("ambiguous");
  expect(observation.selectedCandidateId).toBeNull();
  expect(
    observation.candidates.every(
      (candidate) => candidate.source === "worktree_list",
    ),
  ).toBe(true);
});

test("host/generation, session replacement, unknown revision and forged roots cannot admit files", async () => {
  const { model, state, subject } = fixture();
  const observation = await model.get(subject);
  await expect(model.get({ ...subject, connectionId: "beta" })).rejects.toThrow(
    "connection and generation",
  );
  await expect(
    model.resolve({
      ...target(observation),
      subject: { ...subject, generation: 8 },
    }),
  ).rejects.toThrow("connection and generation");
  await expect(
    model.resolve({ ...target(observation), candidateId: "/arbitrary/root" }),
  ).rejects.toThrow("expired");
  await expect(
    model.resolve({ ...target(observation), revision: "older" }),
  ).rejects.toThrow("expired");
  state.pane.agent_session = {
    ...state.pane.agent_session,
    value: "replacement-session",
  };
  await expect(model.resolve(target(observation))).rejects.toThrow(
    "session changed",
  );
  expect((await model.get(subject)).state).toBe("unavailable");
});

test("moved, relinked and unlisted roots refuse instead of falling back to the workspace", async () => {
  const { model, state, subject } = fixture();
  const observation = await model.get(subject);
  state.roots.set("/project/main", {
    canonicalRoot: "/another/root",
    gitCommonDir: "/another/root/.git",
    branch: "main",
  });
  await expect(model.resolve(target(observation))).rejects.toThrow(
    "moved or changed",
  );
  state.roots.delete("/project/main");
  await expect(model.resolve(target(observation))).rejects.toThrow(
    "moved or changed",
  );
});

test("all sixteen source-presence combinations preserve owner ranking and explicit ambiguity", async () => {
  for (let bits = 0; bits < 16; bits++) {
    const { model, state, subject, session } = fixture();
    const live = !!(bits & 1),
      transcript = !!(bits & 2),
      report = !!(bits & 4),
      branch = !!(bits & 8);
    state.pane.foreground_cwd = live ? "/project/main" : "/outside-git";
    state.metadata.cwd = transcript ? "/project/agent" : "";
    state.metadata.branch = branch ? "agent/topic" : "";
    state.roots.set("/project/reported", {
      canonicalRoot: "/project/reported",
      gitCommonDir: "/project/main/.git",
      branch: "reported/topic",
    });
    state.lists.push({ path: "/project/reported", branch: "reported/topic" });
    if (report)
      state.pane.tokens = agentCheckoutTokens(session, "/project/reported");
    const observation = await model.get(subject);
    const expected = live
      ? "/project/main"
      : transcript && !report
        ? "/project/agent"
        : report && !transcript
          ? "/project/reported"
          : !transcript && !report && branch
            ? "/project/agent"
            : null;
    if (expected) {
      expect(observation.state).toBe("resolved");
      expect((await model.resolve(target(observation))).root).toBe(expected);
    } else {
      expect(observation.state).toBe("ambiguous");
      expect(observation.selectedCandidateId).toBeNull();
    }
  }
});

test("a late observation cannot replace a newer worktree binding", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let first = true;
  const { model, state, subject } = fixture(async () => {
    if (first) {
      first = false;
      entered.resolve();
      await release.promise;
    }
  });
  const old = model.get(subject);
  await entered.promise;
  state.pane.foreground_cwd = "/project/agent";
  const current = await model.get(subject);
  release.resolve();
  expect((await old).state).toBe("stale");
  expect((await model.resolve(target(current))).root).toBe("/project/agent");
});

test("a replaced root incarnation or new equal-rank branch candidate expires admission", async () => {
  const { model, state, subject } = fixture();
  state.roots.get("/project/main")!.gitIdentity = "root:old";
  const observed = await model.get(subject);
  state.roots.get("/project/main")!.gitIdentity = "root:new";
  await expect(model.resolve(target(observed))).rejects.toThrow(
    "moved or changed",
  );
  const replaced = await model.get(subject, { refresh: true });
  expect(replaced.selectedCandidateId).not.toBe(observed.selectedCandidateId);
  state.pane.foreground_cwd = state.metadata.cwd = "";
  const inferred = await model.get(subject);
  state.lists.push({ path: "/project/second", branch: "agent/topic" });
  state.roots.set("/project/second", {
    canonicalRoot: "/project/second",
    gitCommonDir: "/project/main/.git",
    branch: "agent/topic",
  });
  await expect(model.resolve(target(inferred))).rejects.toThrow(
    "branch matches changed",
  );
});

test("unavailable transcript evidence cannot veto live or own reported worktrees", async () => {
  const { model, state, subject, session } = fixture();
  state.metadataUnavailable = true;
  const live = await model.get(subject);
  expect(live.state).toBe("resolved");
  expect(
    live.candidates.find(
      (candidate) => candidate.candidateId === live.selectedCandidateId,
    )?.source,
  ).toBe("foreground_cwd");
  expect((await model.resolve(target(live))).root).toBe("/project/main");
  state.pane.foreground_cwd = "/outside-git";
  state.pane.tokens = agentCheckoutTokens(session, "/project/agent");
  const reported = await model.get(subject, { refresh: true });
  expect(reported.state).toBe("resolved");
  expect(
    reported.candidates.find(
      (candidate) => candidate.candidateId === reported.selectedCandidateId,
    )?.source,
  ).toBe("agent_report");
  expect((await model.resolve(target(reported))).root).toBe("/project/agent");
  state.pane.agent_session = { ...session, value: "replacement-session" };
  expect((await model.get(subject)).state).toBe("unavailable");
  await expect(model.resolve(target(reported))).rejects.toThrow();
});
