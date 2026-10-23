import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AgentWorktreeGate,
  AgentWorktreeLine,
  AgentWorktreePicker,
} from "./AgentWorktreePicker";
import type { AgentWorktreeView } from "../useAgentWorktree";

const view: AgentWorktreeView = {
  selected: null,
  target: null,
  loading: false,
  refresh() {},
  select() {},
  observation: {
    subject: {
      connectionId: "alpha",
      generation: 7,
      paneId: "pane",
      sessionFingerprint: null,
    },
    revision: "r",
    observedAt: "2026-01-01T00:00:00Z",
    state: "ambiguous",
    selectedCandidateId: null,
    candidates: ["one", "two"].map((name) => ({
      candidateId: name,
      canonicalRoot: `/project/${name}`,
      gitCommonDir: "/project/.git",
      branch: "agent/topic",
      source: "branch_match",
      evidence: {
        sourceRef: "Own branch",
        observedAt: "2026-01-01T00:00:00Z",
        basis: "inferred",
      },
    })),
  },
};
test("ambiguous worktrees use one short line and native radio choices in the popover", () => {
  expect(
    renderToStaticMarkup(createElement(AgentWorktreeLine, { view })),
  ).toContain("2 worktrees · choose");
  const html = renderToStaticMarkup(
    createElement(AgentWorktreePicker, { view }),
  );
  expect(html).toContain("<legend>Worktree</legend>");
  expect(html.match(/type="radio"/g)?.length).toBe(2);
  expect(html).toContain("Branch match");
  expect(html).toContain("ambiguous");
  expect(html).not.toContain("checked=");
});
test("a stale view keeps attributed candidates visible without mounting resource consumers", () => {
  const stale: AgentWorktreeView = {
    ...view,
    selected: view.observation!.candidates[0]!,
    observation: { ...view.observation!, state: "stale" },
  };
  const html = renderToStaticMarkup(
    createElement(AgentWorktreePicker, { view: stale }),
  );
  expect(html).toContain("Viewing /project/one");
  expect(html.match(/disabled=""/g)?.length).toBe(2);
  let resourceReads = 0;
  const Resource = () => {
    resourceReads++;
    return createElement("p", null, "Files");
  };
  const empty = renderToStaticMarkup(
    createElement(AgentWorktreeGate, {
      view: stale,
      onChoose() {},
      children: createElement(Resource),
    }),
  );
  expect(empty).toContain("Choose a worktree");
  expect(resourceReads).toBe(0);
  const selected = {
    ...view,
    selected: view.observation!.candidates[0]!,
    target: {
      subject: view.observation!.subject,
      revision: "r",
      candidateId: "one",
    },
  };
  expect(
    renderToStaticMarkup(
      createElement(AgentWorktreeGate, {
        view: selected,
        onChoose() {},
        children: createElement(Resource),
      }),
    ),
  ).toContain("Files");
  expect(resourceReads).toBe(1);
});

test("a truncated candidate keeps the full path in its accessible radio name", () => {
  const path =
    "/project/lantern-notes/.agents/worktrees/agent-worktree-with-a-long-name";
  const long = {
    ...view,
    observation: {
      ...view.observation!,
      candidates: [
        { ...view.observation!.candidates[0]!, canonicalRoot: path },
      ],
    },
  };
  const html = renderToStaticMarkup(
    createElement(AgentWorktreePicker, { view: long }),
  );
  expect(html).toContain(`aria-label="${path} · Branch match"`);
  expect(html).toContain(`title="${path}"`);
});
