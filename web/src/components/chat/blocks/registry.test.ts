import { expect, test } from "bun:test";
import type { WorkItem } from "../../../../../shared/worldSources";
import type { HistoryEntry } from "../../agentHistory";
import { chatBlockTokens, decorateChat, type ChatBlockInput } from "./registry";
import type { ReactElement } from "react";
import type { PullRequestCard } from "../../../world/PullRequestCard";
import type { ConversationStep } from "./steps";

const pr: WorkItem = {
  key: "github:pr:example/project#42",
  source: "github",
  kind: "pull_request",
  ref: "example/project#42",
  title: "Fix Chat",
  number: 42,
  repo: "example/project",
  url: "https://github.com/example/project/pull/42",
  lane: "review",
  status: "OPEN",
  roles: ["author"],
  updatedAt: 1,
};
const entry = (text: string, id = "message"): HistoryEntry => ({
  id,
  text,
  kind: "message",
  role: "assistant",
  sent_at: "2026-01-01T00:00:00Z",
});
const owner = {
  connectionId: "alpha",
  generation: 7,
  paneId: "pane-a",
  sessionFingerprint: "session-a",
  label: "Mira-Claude",
};
const onAskAuthor = () => {};
const input = (text: string): ChatBlockInput => ({
  entries: [entry(text)],
  steps: new Map(),
  items: [pr],
  links: [],
  owner,
  onAskAuthor,
});

test("only a known PR with an explicit announcement or current work claim decorates a message", () => {
  for (const text of [
    "READY #42",
    "Opened PR #42",
    "opened https://github.com/example/project/pull/42",
  ]) {
    expect(chatBlockTokens(new Map(), input(text)).has("entry:message")).toBe(
      true,
    );
  }
  for (const text of ["I read #42", "READY #99", "READY other/project#42"]) {
    expect(chatBlockTokens(new Map(), input(text)).size).toBe(0);
  }
  const claimed = input("I repaired #42");
  claimed.links = [
    {
      ...owner,
      itemKey: pr.key,
      via: "reported",
      sessionFingerprint: "session-a",
    },
  ];
  expect(chatBlockTokens(new Map(), claimed).has("entry:message")).toBe(true);
  expect(
    chatBlockTokens(new Map(), {
      ...claimed,
      owner: { ...owner, generation: null },
    }).size,
  ).toBe(0);
  for (const change of [
    { connectionId: "beta" },
    { generation: 8 },
    { paneId: "pane-b" },
    { sessionFingerprint: "retired" },
  ]) {
    expect(
      chatBlockTokens(new Map(), {
        ...claimed,
        links: [{ ...claimed.links[0]!, ...change }],
      }).size,
    ).toBe(0);
  }
});

test("ambiguous short PR numbers require a repository or one current claim", () => {
  const request = input("READY #42");
  request.items = [
    pr,
    {
      ...pr,
      key: "github:pr:other/project#42",
      repo: "other/project",
      ref: "other/project#42",
    },
  ];
  expect(chatBlockTokens(new Map(), request).size).toBe(0);
  expect(
    chatBlockTokens(new Map(), {
      ...request,
      entries: [entry("READY example/project#42")],
    }).size,
  ).toBe(1);
});

test("Ask author is offered only for this conversation's qualified author claim", () => {
  const request = input("READY #42");
  const asked: string[] = [];
  request.onAskAuthor = (item) => asked.push(`↳ #${item.number}`);
  const render = () => {
    const tokens = chatBlockTokens(new Map(), request);
    return (
      decorateChat(
        { type: "message", entry: request.entries[0]! },
        tokens.get("entry:message"),
      )!.after as ReactElement<Parameters<typeof PullRequestCard>[0]>[]
    )[0]!;
  };
  expect(render().props.onAskAuthor).toBeUndefined();
  request.links = [
    {
      ...owner,
      itemKey: pr.key,
      via: "reported",
      sessionFingerprint: "session-a",
    },
  ];
  const card = render();
  card.props.onAskAuthor!(pr);
  expect(asked).toEqual(["↳ #42"]);
  expect(card.props.agents).toEqual([{ id: "pane-a", label: "Mira-Claude" }]);
});

test("unchanged message and paired tool-step tokens keep identity and eviction prunes them", () => {
  const call = {
    ...entry("{}", "call"),
    role: "tool" as const,
    kind: "tool_call" as const,
    source_call_id: "run-1",
  };
  const result = { ...call, id: "result", kind: "tool_result" as const };
  const step: ConversationStep = {
    id: "step",
    call_id: "run-1",
    tool: "Bash",
    label: "Tests",
    input_summary: null,
    state: "ok",
    started_at: call.sent_at,
    ended_at: call.sent_at,
    result_tail: null,
    diff: null,
    test: { runner: "bun", passed: 3, failed: 0, first_failure: null },
  };
  const request = {
    ...input("READY #42"),
    entries: [entry("READY #42"), call, result],
    steps: new Map([["run-1", step]]),
  };
  const first = chatBlockTokens(new Map(), request);
  expect(first.size).toBe(2);
  const next = chatBlockTokens(first, {
    ...request,
    entries: [...request.entries, entry("More work", "next")],
  });
  expect(next.get("entry:message")).toBe(first.get("entry:message"));
  expect(next.get("step:run-1")).toBe(first.get("step:run-1"));
  const changed = chatBlockTokens(next, {
    ...request,
    steps: new Map([["run-1", { ...step, state: "failed" as const }]]),
  });
  expect(changed.get("entry:message")).toBe(first.get("entry:message"));
  expect(changed.get("step:run-1")).not.toBe(first.get("step:run-1"));
  expect(chatBlockTokens(changed, { ...request, entries: [] }).size).toBe(0);
});
