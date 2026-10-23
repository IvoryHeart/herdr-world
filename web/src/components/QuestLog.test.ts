import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Quest } from "../../../server/src/agent/quest";
import {
  questCurrentStep,
  questMark,
  questProgressText,
} from "../world/agentQuests";
import { QuestChip, QuestLog } from "./QuestLog";

const quest: Quest = {
  quest_version: 1,
  source: "todo",
  tool: "TodoWrite",
  title: "Add retry to the example client",
  status: "active",
  steps: [
    { id: "a", text: "Read the client", status: "done", step_ids: ["c1"] },
    { id: "b", text: "Add retry", status: "active", step_ids: ["c2", "c3"] },
    { id: "c", text: "Run tests", status: "pending", step_ids: [] },
  ],
  progress: { done: 1, total: 3 },
  started_at: "2026-10-22T10:00:00.000Z",
  updated_at: "2026-10-22T10:05:00.000Z",
  set_by: "c0",
  helpers: 1,
};

test("progress text, mark and current step", () => {
  expect(questProgressText(quest)).toBe("1/3");
  expect(questMark(quest)).toEqual({ done: 1, total: 3, status: "active" });
  expect(questCurrentStep(quest)?.text).toBe("Add retry");
  const loop: Quest = {
    ...quest,
    source: "loop",
    steps: [],
    progress: { done: 0, total: 0 },
    iterations: 4,
  };
  expect(questProgressText(loop)).toBe("Loop ×4");
  expect(questCurrentStep(loop)).toBeNull();
  expect(
    questProgressText({ ...loop, source: "goal", iterations: undefined }),
  ).toBe("Goal");
});

test("the quest log lists objectives with their state", () => {
  const html = renderToStaticMarkup(createElement(QuestLog, { quest }));
  expect(html).toContain("Add retry to the example client");
  expect(html).toContain('aria-valuenow="1"');
  expect(html).toContain('aria-valuemax="3"');
  expect(html).toContain('<li class="is-active">');
  expect(html).toContain('<li class="is-done">');
  expect(html).toContain("Checklist from TodoWrite · 1 helper");
  expect(renderToStaticMarkup(createElement(QuestLog, { quest: null }))).toBe(
    "",
  );
});

test("the chip names the quest and its current step", () => {
  const html = renderToStaticMarkup(createElement(QuestChip, { quest }));
  expect(html).toContain('class="quest-chip is-active"');
  expect(html).toContain("1/3");
  expect(html).toContain("now: Add retry");
});
