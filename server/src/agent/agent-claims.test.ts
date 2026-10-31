import { expect, test } from "bun:test";
import { AgentClaims } from "./agent-claims";

const native = {
  source: "synthetic",
  agent: "fixture",
  kind: "id",
  value: "session-a",
};
const pane = {
  terminal_id: "terminal-a",
  agent: "fixture",
  agent_status: "idle",
  agent_session: native,
  state_change_seq: 42,
};
const transcript = {
  status: "working",
  session: { ...native, source: "synthetic-transcript" },
  revision: "file-revision",
};

test("agent claims preserve disagreement, provenance and transcript evidence through another source's silence", () => {
  let now = 100;
  const claims = new AgentClaims(() => now++);
  const capture = claims.observe(claims.begin("pane-a"), pane);
  const both = claims.transcript(capture, transcript);
  expect(both.agent_status.claims.map((claim) => claim.value)).toEqual([
    "idle",
    "working",
  ]);
  expect(both.agent_status.display.map((claim) => claim.value)).toEqual([
    "idle",
  ]);
  expect(both.agent_status.claims[0]).toMatchObject({
    source: "herdr.agent",
    basis: "reported",
    source_revision: 42,
    observed_at: 100,
  });
  expect(both.session.claims).toHaveLength(2);
  expect(both.session.claims[1]).toMatchObject({
    source: "world.transcript",
    basis: "inferred",
    source_revision: "file-revision",
  });
  const silent = { ...pane, agent_status: undefined, agent_session: undefined };
  const next = claims.observe(claims.begin("pane-a"), silent);
  expect(
    claims.project(next).agent_status.claims.map((claim) => claim.value),
  ).toEqual(["working"]);
  const ended = claims.transcript(next, {
    status: null,
    session: null,
    revision: "empty-file",
  });
  expect(ended.agent_status.claims).toEqual([]);
  expect(ended.session.claims).toEqual([]);
});

test("exhaustive overlapping read orderings cannot lend old transcript claims to a newer native observation", () => {
  for (const replaced of [false, true])
    for (const oldFinishesFirst of [false, true])
      for (const observeNewFirst of [false, true]) {
        const claims = new AgentClaims(() => 100);
        const old = claims.observe(claims.begin("pane-a"), pane);
        const ticket = claims.begin("pane-a");
        let next = observeNewFirst
          ? claims.observe(
              ticket,
              replaced ? { ...pane, terminal_id: "terminal-b" } : pane,
            )
          : undefined;
        if (oldFinishesFirst) claims.transcript(old, transcript);
        next ??= claims.observe(
          ticket,
          replaced ? { ...pane, terminal_id: "terminal-b" } : pane,
        );
        const current = claims.transcript(next, {
          ...transcript,
          status: "idle",
          revision: "new-file",
        });
        if (!oldFinishesFirst) claims.transcript(old, transcript);
        const after = claims.project(
          claims.observe(
            claims.begin("pane-a"),
            replaced ? { ...pane, terminal_id: "terminal-b" } : pane,
          ),
        );
        expect(after.agent_status).toEqual(current.agent_status);
        expect(
          after.agent_status.claims.find(
            (claim) => claim.source === "world.transcript",
          )?.source_revision,
        ).toBe("new-file");
      }
});

test("runtime disposal, complete agent absence and native occupant replacement retire their own read model", () => {
  const claims = new AgentClaims(() => 100);
  const capture = claims.observe(claims.begin("pane-a"), pane);
  claims.transcript(capture, transcript);
  const fresh = claims.observe(claims.begin("pane-a"), {
    ...pane,
    agent_session: { ...native, value: "session-b" },
  });
  expect(claims.project(fresh).agent_status.claims).toHaveLength(1);
  claims.completePanes(new Set());
  claims.transcript(fresh, transcript);
  expect(
    claims.project(claims.observe(claims.begin("pane-a"), pane)).agent_status
      .claims,
  ).toHaveLength(1);
  claims.clear();
  claims.transcript(capture, transcript);
  expect(
    claims.project(claims.observe(claims.begin("pane-a"), pane)).agent_status
      .claims,
  ).toHaveLength(1);
});

test("missing title evidence preserves transcript claims until another thread is positively named", () => {
  const claims = new AgentClaims(() => 100);
  const capture = claims.observe(claims.begin("pane-a"), {
    ...pane,
    agent_session: null,
  });
  claims.title(capture, "thread-a");
  claims.transcript(capture, transcript);
  const silent = claims.observe(claims.begin("pane-a"), {
    ...pane,
    agent_session: null,
  });
  const retained = claims.title(silent, null);
  expect(
    retained.agent_status.claims.some(
      (claim) => claim.source === "world.transcript",
    ),
  ).toBe(true);
  const next = claims.observe(claims.begin("pane-a"), {
    ...pane,
    agent_session: null,
  });
  const replaced = claims.title(next, "thread-b");
  expect(replaced.agent_status.claims.map((claim) => claim.source)).toEqual([
    "herdr.agent",
  ]);
  expect(replaced.session.claims.map((claim) => claim.value.value)).toEqual([
    "thread-b",
  ]);
});

test("a resolved Codex transcript supplies the prior thread witness independently of a title", () => {
  for (const next of [null, "thread-a", "thread-b"]) {
    const claims = new AgentClaims(() => 100);
    const info = { ...pane, agent: "codex", agent_session: null };
    const first = claims.observe(claims.begin("pane-a"), info);
    claims.title(first, null);
    claims.transcript(first, {
      ...transcript,
      session: { ...native, agent: "codex", value: "thread-a" },
    });
    const second = claims.observe(claims.begin("pane-a"), info);
    const result = claims.title(second, next);
    expect(
      result.session.claims
        .filter((claim) => claim.source === "world.transcript")
        .map((claim) => claim.value.value),
    ).toEqual(next === "thread-b" ? [] : ["thread-a"]);
    expect(
      result.agent_status.claims
        .filter((claim) => claim.source === "world.transcript")
        .map((claim) => claim.value),
    ).toEqual(next === "thread-b" ? [] : ["working"]);
  }
});
