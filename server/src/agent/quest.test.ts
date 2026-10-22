import { describe, expect, test } from "bun:test";
import { questFromSession } from "./quest";
import { projectAgentTrajectory } from "./session-trajectory";

// Synthetic transcripts in each harness's own record format.
const file = { path: "/tmp/example/session.jsonl", mtimeMs: 1_790_000_000_000 };
const at = (second: number) =>
  new Date(Date.UTC(2026, 9, 22, 10, 0, second)).toISOString();

function quest(agent: string, records: Record<string, unknown>[]) {
  return questFromSession(
    agent,
    projectAgentTrajectory(agent, file, records),
    records,
  );
}

let uuid = 0;
const claudeUser = (second: number, text: string) => ({
  type: "user",
  uuid: `u${++uuid}`,
  timestamp: at(second),
  message: { role: "user", content: text },
});
const claudeTool = (
  second: number,
  id: string,
  name: string,
  input: Record<string, unknown>,
) => ({
  type: "assistant",
  uuid: `a${++uuid}`,
  timestamp: at(second),
  message: {
    role: "assistant",
    content: [{ type: "tool_use", id, name, input }],
  },
});
const claudeResult = (second: number, id: string, content: string) => ({
  type: "user",
  uuid: `r${++uuid}`,
  timestamp: at(second),
  message: {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: id, content }],
  },
});

const codexCall = (
  second: number,
  id: string,
  name: string,
  args: Record<string, unknown>,
) => ({
  type: "response_item",
  timestamp: at(second),
  payload: {
    type: "function_call",
    name,
    call_id: id,
    arguments: JSON.stringify(args),
  },
});
const codexUser = (second: number, text: string) => ({
  type: "response_item",
  timestamp: at(second),
  payload: {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
  },
});

describe("Claude Code", () => {
  test("TodoWrite becomes a checklist quest titled by the prompt", () => {
    const result = quest("claude", [
      claudeUser(0, "Add retry to the example client"),
      claudeTool(1, "call_1", "TodoWrite", {
        todos: [
          { content: "Read the client", status: "in_progress" },
          { content: "Add retry", status: "pending" },
          { content: "Run tests", status: "pending" },
        ],
      }),
      claudeTool(2, "call_2", "Read", { file_path: "/tmp/example/a.ts" }),
      claudeTool(3, "call_3", "TodoWrite", {
        todos: [
          { content: "Read the client", status: "completed" },
          { content: "Add retry", status: "in_progress" },
          { content: "Run tests", status: "pending" },
        ],
      }),
      claudeTool(4, "call_4", "Edit", { file_path: "/tmp/example/a.ts" }),
    ]);
    expect(result).toMatchObject({
      source: "todo",
      tool: "TodoWrite",
      title: "Add retry to the example client",
      status: "active",
      progress: { done: 1, total: 3 },
      set_by: "call_3",
      started_at: at(1),
      updated_at: at(3),
    });
    expect(result!.steps.map((step) => [step.text, step.status])).toEqual([
      ["Read the client", "done"],
      ["Add retry", "active"],
      ["Run tests", "pending"],
    ]);
    // Steps link to the tool calls made while they were active.
    expect(result!.steps[0]!.step_ids).toEqual(["call_2"]);
    expect(result!.steps[1]!.step_ids).toEqual(["call_4"]);
  });

  test("a list sharing nothing with a finished one starts a new quest", () => {
    const result = quest("claude", [
      claudeUser(0, "First task"),
      claudeTool(1, "c1", "TodoWrite", {
        todos: [{ content: "Old step", status: "completed" }],
      }),
      claudeUser(2, "Second task"),
      claudeTool(3, "c2", "TodoWrite", {
        todos: [{ content: "New step", status: "pending" }],
      }),
    ]);
    expect(result).toMatchObject({ title: "Second task", started_at: at(3) });
  });

  test("TaskCreate and TaskUpdate keep the harness's task IDs", () => {
    const result = quest("claude", [
      claudeUser(0, "Ship the example feature"),
      claudeTool(1, "t1", "TaskCreate", { subject: "Write the parser" }),
      claudeResult(1, "t1", "Task #1 created successfully: Write the parser"),
      claudeTool(2, "t2", "TaskCreate", { subject: "Write the view" }),
      claudeResult(2, "t2", "Task #2 created successfully: Write the view"),
      claudeTool(3, "t3", "TaskUpdate", { taskId: "2", addBlockedBy: ["1"] }),
      claudeTool(4, "t4", "TaskUpdate", { taskId: "1", status: "in_progress" }),
      claudeTool(5, "t5", "TaskUpdate", { taskId: "1", status: "completed" }),
    ]);
    expect(result).toMatchObject({
      source: "todo",
      tool: "TaskCreate",
      progress: { done: 1, total: 2 },
      set_by: "t5",
    });
    expect(result!.steps.map((step) => [step.id, step.status])).toEqual([
      ["1", "done"],
      ["2", "pending"],
    ]);
  });

  test("a pending task waiting on an unfinished one is blocked", () => {
    const result = quest("claude", [
      claudeTool(1, "t1", "TaskCreate", { subject: "First" }),
      claudeResult(1, "t1", "Task #1 created successfully: First"),
      claudeTool(2, "t2", "TaskCreate", { subject: "Second" }),
      claudeResult(2, "t2", "Task #2 created successfully: Second"),
      claudeTool(3, "t3", "TaskUpdate", { taskId: "2", addBlockedBy: ["1"] }),
    ]);
    expect(result!.steps.map((step) => step.status)).toEqual([
      "pending",
      "blocked",
    ]);
    // A pending step can still be worked, so the quest is not blocked.
    expect(result!.status).toBe("active");
    const deleted = quest("claude", [
      claudeTool(1, "t1", "TaskCreate", { subject: "First" }),
      claudeResult(1, "t1", "Task #1 created successfully: First"),
      claudeTool(2, "t2", "TaskCreate", { subject: "Second" }),
      claudeResult(2, "t2", "Task #2 created successfully: Second"),
      claudeTool(3, "t3", "TaskUpdate", { taskId: "2", addBlockedBy: ["1"] }),
      claudeTool(4, "t4", "TaskUpdate", { taskId: "1", status: "deleted" }),
    ]);
    // A deleted blocker no longer blocks.
    expect(deleted!.steps.map((step) => [step.id, step.status])).toEqual([
      ["2", "pending"],
    ]);
  });

  test("parallel TaskCreate calls in a later quest keep the harness's IDs", () => {
    const done = (second: number, id: string, taskId: string) =>
      claudeTool(second, id, "TaskUpdate", { taskId, status: "completed" });
    const result = quest("claude", [
      claudeTool(1, "a1", "TaskCreate", { subject: "Old one" }),
      claudeResult(1, "a1", "Task #1 created successfully: Old one"),
      claudeTool(2, "a2", "TaskCreate", { subject: "Old two" }),
      claudeResult(2, "a2", "Task #2 created successfully: Old two"),
      done(3, "u1", "1"),
      done(4, "u2", "2"),
      // A new quest creates three tasks in one turn; results follow.
      claudeTool(5, "b1", "TaskCreate", { subject: "A" }),
      claudeTool(5, "b2", "TaskCreate", { subject: "B" }),
      claudeTool(5, "b3", "TaskCreate", { subject: "C" }),
      claudeResult(6, "b1", "Task #3 created successfully: A"),
      claudeResult(6, "b2", "Task #4 created successfully: B"),
      claudeResult(6, "b3", "Task #5 created successfully: C"),
      done(7, "u3", "3"),
    ]);
    expect(
      result!.steps.map((step) => [step.id, step.text, step.status]),
    ).toEqual([
      ["3", "A", "done"],
      ["4", "B", "pending"],
      ["5", "C", "pending"],
    ]);
  });

  test("clearing the checklist ends its quest", () => {
    expect(
      quest("claude", [
        claudeTool(1, "c1", "TodoWrite", {
          todos: [{ content: "Only step", status: "completed" }],
        }),
        claudeTool(2, "c2", "TodoWrite", { todos: [] }),
      ]),
    ).toBeNull();
  });

  test("repeated step text stays two steps", () => {
    const result = quest("claude", [
      claudeTool(1, "c1", "TodoWrite", {
        todos: [
          { content: "Run tests", status: "completed" },
          { content: "Fix", status: "completed" },
          { content: "Run tests", status: "pending" },
        ],
      }),
    ]);
    expect(result).toMatchObject({ progress: { done: 2, total: 3 } });
    expect(result!.steps.map((step) => step.text)).toEqual([
      "Run tests",
      "Fix",
      "Run tests",
    ]);
  });

  test("an injected interruption never titles a quest", () => {
    expect(
      quest("claude", [
        claudeUser(0, "Real request"),
        claudeUser(1, "[Request interrupted by user]"),
        claudeTool(2, "c1", "TodoWrite", {
          todos: [{ content: "Step", status: "pending" }],
        }),
      ]),
    ).toMatchObject({ title: "Real request" });
  });

  test("an approved plan is a quest, and titles the checklist after it", () => {
    const plan = [
      "# Example migration",
      "",
      "1. Back up the data",
      "2. Run the migration",
      "   - nested detail",
      "3. Verify",
    ].join("\n");
    const planned = quest("claude", [
      claudeTool(1, "p1", "ExitPlanMode", { plan }),
    ]);
    expect(planned).toMatchObject({
      source: "plan",
      title: "Example migration",
      progress: { done: 0, total: 3 },
      set_by: "p1",
    });
    const working = quest("claude", [
      claudeUser(0, "Plan the migration"),
      claudeTool(1, "p1", "ExitPlanMode", { plan }),
      claudeTool(2, "c1", "TodoWrite", {
        todos: [{ content: "Back up the data", status: "in_progress" }],
      }),
    ]);
    expect(working).toMatchObject({
      source: "todo",
      title: "Example migration",
    });
    // A new prompt after the plan starts other work with its own title.
    expect(
      quest("claude", [
        claudeTool(1, "p1", "ExitPlanMode", { plan }),
        claudeUser(2, "Something else entirely"),
        claudeTool(3, "c1", "TodoWrite", {
          todos: [{ content: "Other step", status: "pending" }],
        }),
      ]),
    ).toMatchObject({ source: "todo", title: "Something else entirely" });
  });

  test("ScheduleWakeup is a loop that counts its iterations", () => {
    const wake = (second: number, id: string, extra = {}) =>
      claudeTool(second, id, "ScheduleWakeup", {
        delaySeconds: 1200,
        prompt: "/babysit example PRs",
        reason: "waiting on CI",
        ...extra,
      });
    expect(
      quest("claude", [wake(1, "w1"), wake(2, "w2"), wake(3, "w3")]),
    ).toMatchObject({
      source: "loop",
      title: "/babysit example PRs",
      status: "active",
      iterations: 3,
      started_at: at(1),
      steps: [],
    });
    expect(
      quest("claude", [
        wake(1, "w1"),
        claudeTool(2, "w2", "ScheduleWakeup", { stop: true }),
      ]),
    ).toMatchObject({ source: "loop", status: "done", set_by: "w2" });
  });

  test("counts spawned helper agents", () => {
    const result = quest("claude", [
      claudeTool(1, "c1", "TodoWrite", {
        todos: [{ content: "Survey", status: "in_progress" }],
      }),
      claudeTool(2, "a1", "Agent", { description: "Survey A", prompt: "x" }),
      claudeTool(3, "a2", "Agent", { description: "Survey B", prompt: "y" }),
    ]);
    expect(result).toMatchObject({ helpers: 2 });
    expect(result!.steps[0]!.step_ids).toEqual(["a1", "a2"]);
  });

  test("a transcript with no todos, plan or loop has no quest", () => {
    expect(
      quest("claude", [
        claudeUser(0, "Hello"),
        claudeTool(1, "b1", "Bash", { command: "ls" }),
      ]),
    ).toBeNull();
  });

  test("subagent sidechains do not set the quest", () => {
    expect(
      quest("claude", [
        {
          ...claudeTool(1, "s1", "TodoWrite", {
            todos: [{ content: "Sidechain step", status: "pending" }],
          }),
          isSidechain: true,
        },
      ]),
    ).toBeNull();
  });
});

describe("Codex", () => {
  test("update_plan becomes a checklist quest", () => {
    const result = quest("codex", [
      codexUser(0, "Fix the example flake"),
      codexCall(1, "u1", "update_plan", {
        explanation: "Reproduce, then fix",
        plan: [
          { step: "Reproduce", status: "completed" },
          { step: "Fix", status: "in_progress" },
          { step: "Verify", status: "pending" },
        ],
      }),
      codexCall(2, "e1", "exec_command", { cmd: "bun test" }),
    ]);
    expect(result).toMatchObject({
      source: "todo",
      tool: "update_plan",
      title: "Reproduce, then fix",
      progress: { done: 1, total: 3 },
      set_by: "u1",
    });
    expect(result!.steps[1]).toMatchObject({
      text: "Fix",
      status: "active",
      step_ids: ["e1"],
    });
  });

  test("a thread goal titles the quest and keeps the plan's steps", () => {
    const goal = (second: number, status: string) => ({
      type: "event_msg",
      timestamp: at(second),
      payload: {
        type: "thread_goal_updated",
        threadId: "thread-example",
        goal: {
          threadId: "thread-example",
          objective: "Make the example suite green",
          status,
          createdAt: Date.parse(at(0)) / 1000,
        },
      },
    });
    const records = [
      goal(0, "active"),
      codexCall(1, "u1", "update_plan", {
        plan: [
          { step: "Find failures", status: "completed" },
          { step: "Fix them", status: "in_progress" },
        ],
      }),
    ];
    expect(quest("codex", records)).toMatchObject({
      source: "goal",
      tool: "thread_goal",
      title: "Make the example suite green",
      status: "active",
      progress: { done: 1, total: 2 },
    });
    expect(quest("codex", [...records, goal(5, "complete")])).toMatchObject({
      status: "done",
      started_at: at(0),
    });
    expect(
      quest("codex", [...records, goal(5, "budget_limited")]),
    ).toMatchObject({ status: "blocked" });
    // Work begun after a completed goal is the quest again.
    expect(
      quest("codex", [
        ...records,
        goal(5, "complete"),
        codexCall(6, "u2", "update_plan", {
          explanation: "Next task",
          plan: [{ step: "New work", status: "in_progress" }],
        }),
      ]),
    ).toMatchObject({ source: "todo", title: "Next task", status: "active" });
    expect(quest("codex", [goal(0, "paused")])).toMatchObject({
      status: "paused",
      steps: [],
    });
  });

  test("a plan-mode plan item is a plan quest", () => {
    expect(
      quest("codex", [
        {
          type: "event_msg",
          timestamp: at(1),
          payload: {
            type: "item_completed",
            item: {
              type: "Plan",
              id: "turn-plan",
              text: "# Example rollout\n\n## Prepare\n\n## Deploy\n\n## Check",
            },
          },
        },
      ]),
    ).toMatchObject({
      source: "plan",
      tool: "plan",
      title: "Example rollout",
      progress: { done: 0, total: 3 },
    });
  });

  test("counts spawned helper agents", () => {
    expect(
      quest("codex", [
        codexCall(1, "u1", "update_plan", {
          plan: [{ step: "Audit", status: "in_progress" }],
        }),
        codexCall(2, "s1", "spawn_agent", { task_name: "example_audit" }),
      ]),
    ).toMatchObject({ helpers: 1 });
  });
});

describe("Kimi Code", () => {
  test("SetTodoList becomes a checklist quest", () => {
    const event = (
      second: number,
      value: Record<string, unknown>,
    ): Record<string, unknown> => ({
      type: "context.append_loop_event",
      timestamp: Date.parse(at(second)) / 1000,
      event: value,
    });
    const result = quest("kimi", [
      {
        type: "context.append_message",
        message: { role: "user", content: "Tidy the example docs" },
      },
      event(1, {
        type: "tool.call",
        toolCallId: "k1",
        name: "SetTodoList",
        args: {
          todos: [
            { title: "List pages", status: "Done" },
            { title: "Fix links", status: "In Progress" },
          ],
        },
      }),
    ]);
    expect(result).toMatchObject({
      source: "todo",
      tool: "SetTodoList",
      title: "Tidy the example docs",
      progress: { done: 1, total: 2 },
    });
    expect(result!.steps[1]!.status).toBe("active");
  });
});

describe("Pi", () => {
  test("a transcript with only built-in tools has no quest", () => {
    expect(
      quest("pi", [
        { type: "session", id: "pi-example", timestamp: at(0) },
        {
          type: "message",
          timestamp: at(1),
          message: { role: "user", content: "List the example files" },
        },
        {
          type: "message",
          timestamp: at(2),
          message: {
            role: "assistant",
            content: [
              { type: "toolCall", id: "p1", name: "ls", arguments: {} },
            ],
          },
        },
      ]),
    ).toBeNull();
  });

  test("a todo tool from an extension that writes the whole list is read", () => {
    expect(
      quest("pi", [
        {
          type: "message",
          timestamp: at(1),
          message: {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "p1",
                name: "todo_write",
                arguments: {
                  todos: [{ content: "Example step", status: "pending" }],
                },
              },
            ],
          },
        },
      ]),
    ).toMatchObject({ source: "todo", progress: { done: 0, total: 1 } });
  });
});
