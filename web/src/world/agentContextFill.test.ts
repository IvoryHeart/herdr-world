import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { UsageContext, WorldUsageSnapshot } from "../../../shared/usage";
import { ContextFillBar } from "../components/ContextFillBar";
import { WorkspaceInspectorAgentIdentity } from "../components/WorkspaceInspectorAgentIdentity";
import {
  agentContextFill,
  CONTEXT_TIRED_PERCENT,
  contextTokens,
} from "./agentContextFill";
import { TownTiredMark } from "./town/TownTiredMark";
import type { TownUsageState } from "./town/townPlaceUsage";

/** Synthetic connections, panes and readings only. */
const context = (
  used: number,
  window: number | null,
  pane = "pane-a",
): UsageContext => ({
  connection_id: "local",
  connection_generation: 3,
  workspace_id: "workspace-a",
  tab_id: "tab-a",
  pane_id: pane,
  harness: "claude",
  model: "claude-opus-4-6",
  used_tokens: used,
  window_tokens: window,
  observed_at: 1,
});
const ready = (contexts?: UsageContext[]): TownUsageState => ({
  status: "ready",
  snapshot: { version: 1, contexts } as unknown as WorldUsageSnapshot,
});
const pane = { connectionId: "local", generation: 3, paneId: "pane-a" };

test("a fill reads the newest prompt against the model's window", () => {
  expect(agentContextFill(ready([context(144_000, 200_000)]), pane)).toEqual({
    percent: 72,
    usedTokens: 144_000,
    windowTokens: 200_000,
    model: "claude-opus-4-6",
    tired: false,
    text: "Context 72% · 144k of 200k tokens · claude-opus-4-6",
  });
  const tired = agentContextFill(ready([context(180_000, 200_000)]), pane);
  expect(tired).toMatchObject({ percent: 90, tired: true });
  expect(CONTEXT_TIRED_PERCENT).toBe(85);
  // A prompt past a reported window reads full, never more.
  expect(
    agentContextFill(ready([context(300_000, 258_400)]), pane)?.percent,
  ).toBe(100);
});

test("no evidence shows nothing, never zero", () => {
  for (const state of [
    { status: "idle" },
    { status: "loading" },
    { status: "failed" },
    // An older service sends no contexts.
    ready(undefined),
    ready([]),
    // An unknown model has no window.
    ready([context(10, null)]),
    // Another pane, or the same pane on a replaced runtime.
    ready([context(10, 200_000, "pane-b")]),
  ] as TownUsageState[])
    expect(agentContextFill(state, pane)).toBeNull();
  expect(
    agentContextFill(ready([context(10, 200_000)]), {
      ...pane,
      generation: 4,
    }),
  ).toBeNull();
  expect(agentContextFill(ready([context(10, 200_000)]), null)).toBeNull();
});

test("token counts read short", () => {
  expect(
    [999, 1_400, 144_000, 999_499, 1_000_000, 1_048_576].map(contextTokens),
  ).toEqual(["999", "1k", "144k", "999k", "1M", "1M"]);
});

test("the peek's bar shows the percent with the reading as its tooltip", () => {
  const fill = agentContextFill(ready([context(144_000, 200_000)]), pane)!;
  const html = renderToStaticMarkup(
    createElement(ContextFillBar, { fill, variant: "inline" }),
  );
  expect(html).toContain('title="Context 72% · 144k of 200k tokens');
  expect(html).toContain("width:72%");
  expect(html).toContain(">72%<");
  expect(html).toContain('data-level="low"');
});

test("the window bar's icon carries the bar and its reading, no new row", () => {
  const fill = agentContextFill(ready([context(180_000, 200_000)]), pane)!;
  const render = (contextFill: typeof fill | null) =>
    renderToStaticMarkup(
      createElement(WorkspaceInspectorAgentIdentity, {
        context: {
          kind: "agent",
          label: "otter",
          stateLabel: "Working",
          locationLabel: "room · desk",
          contextFill,
        },
        location: null,
      }),
    );
  const html = render(fill);
  expect(html).toMatch(
    /class="workspace-inspector-agent-avatar"[^>]*title="Working · Context 90%/,
  );
  expect(html).toContain('class="context-fill context-fill-edge"');
  expect(html).toContain('data-level="tired"');
  expect(render(null)).not.toContain("context-fill");
});

test("an agent at 90% looks tired at its desk", () => {
  const fill = agentContextFill(ready([context(180_000, 200_000)]), pane)!;
  const html = renderToStaticMarkup(
    createElement(TownTiredMark, {
      fill,
      agentKey: "agent-a",
      agentLabel: "otter",
      top: true,
      x: 20,
      renderer: { current: null },
      marks: new Set<HTMLElement>(),
    }),
  );
  expect(html).toContain('class="town-tired town-tired-top"');
  expect(html).toContain('data-agent="agent-a"');
  expect(html).toContain('aria-label="otter is tired: Context 90%');
});
