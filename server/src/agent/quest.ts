import type { AtifTrajectory } from "./session-types";
import { isRecord, stringValue } from "./session-utils";

// The quest read model: what an agent is working through, read from its own
// transcript without an LLM. A quest comes from what the harness records:
// a checklist (Claude TodoWrite or TaskCreate/TaskUpdate, Codex update_plan,
// Kimi SetTodoList), an approved plan (Claude ExitPlanMode, a Codex plan
// item), a Codex thread goal, or a loop (Claude ScheduleWakeup or CronCreate).
// Steps link to Chat's step cards by the harness's tool-call ID.

export type QuestSource = "todo" | "plan" | "goal" | "loop";
export type QuestStepStatus = "pending" | "active" | "done" | "blocked";

export type QuestStep = {
  /** The harness's task ID, or the step's text when it has none. */
  id: string;
  text: string;
  status: QuestStepStatus;
  /** Tool-call IDs made while this step was active, newest last. */
  step_ids: string[];
};

export type Quest = {
  quest_version: 1;
  source: QuestSource;
  /** The harness tool or record the quest was read from. */
  tool: string;
  title: string;
  status: "active" | "done" | "blocked" | "paused";
  steps: QuestStep[];
  progress: { done: number; total: number };
  started_at: string;
  updated_at: string;
  /** Tool-call ID of the call that last set the quest, when it has one. */
  set_by: string | null;
  /** Wake-ups a loop has scheduled so far. */
  iterations?: number;
  /** Helper agents the agent spawned for this session. */
  helpers: number;
};

/** One agent's quest, as Town and Board show it for every desk and card. */
export type AgentQuest = {
  pane_id: string;
  agent: string | null;
  /** How the session is tied to the pane; see ConversationBinding. */
  session_binding: "reported" | "title" | "guessed" | null;
  /**
   * The bound session's fingerprint (as in Conversation), or null when no
   * session is bound or it is not known.
   */
  session_fingerprint: string | null;
  quest: Quest | null;
  /**
   * The quest could not be read just now, for example while the transcript
   * was being written. A browser keeps the last one only for the same
   * session: this reply's `session_fingerprint`, when it has one, names it.
   */
  read_failed?: true;
};

const CHECKLIST_TOOLS = new Set([
  "todowrite",
  "settodolist",
  "update_plan",
  "write_todos",
  "todo_write",
]);
const HELPER_TOOLS = new Set(["Agent", "Task", "spawn_agent"]);
const LOOP_TOOLS = new Set(["ScheduleWakeup", "CronCreate"]);
const TASK_TOOLS = new Set(["TaskCreate", "TaskUpdate"]);
/** Enough links for a step card list; older ones are dropped. */
const STEP_LINKS = 20;
const TITLE_LENGTH = 120;
const PLAN_STEPS = 12;

function questTitle(text: string) {
  const line =
    text
      .split("\n")
      .map((value) => value.replace(/^#+\s*/, "").trim())
      .find(Boolean) ?? "";
  return line.length > TITLE_LENGTH
    ? `${line.slice(0, TITLE_LENGTH - 1).trimEnd()}…`
    : line;
}

/** Harness statuses, by their own spelling, as quest step statuses. */
function stepStatus(value: unknown): QuestStepStatus | "removed" {
  const status = stringValue(value)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (["completed", "complete", "done", "finished"].includes(status))
    return "done";
  if (["in_progress", "active", "running", "doing"].includes(status))
    return "active";
  if (status === "blocked") return "blocked";
  if (["deleted", "cancelled", "canceled", "removed"].includes(status))
    return "removed";
  return "pending";
}

type Checklist = {
  tool: string;
  /** How many user prompts came before it started. */
  prompts: number;
  set_by: string | null;
  started_at: string;
  updated_at: string;
  title: string;
  steps: Map<string, QuestStep & { blocked_by: string[] }>;
};

type Plan = {
  tool: string;
  /** How many user prompts came before it was approved. */
  prompts: number;
  set_by: string | null;
  at: string;
  title: string;
  steps: string[];
};

/** A plan's title and its top-level steps: sections, else list items. */
function planOf(text: string) {
  const lines = text.split("\n");
  const pick = (pattern: RegExp) =>
    lines.flatMap((line) => {
      const match = pattern.exec(line);
      return match?.[1]?.trim() ? [questTitle(match[1])] : [];
    });
  const sections = pick(/^#{2,3}\s+(.+)$/);
  const numbered = pick(/^\d+[.)]\s+(.+)$/);
  const bullets = pick(/^[-*]\s+(.+)$/);
  const steps =
    sections.length >= 2 ? sections : numbered.length >= 2 ? numbered : bullets;
  return { title: questTitle(text), steps: steps.slice(0, PLAN_STEPS) };
}

function checklistItems(args: Record<string, unknown>) {
  const list = [args.todos, args.plan, args.items].find(Array.isArray) ?? [];
  return list.filter(isRecord).flatMap((item) => {
    const text = questTitle(
      stringValue(item.content) ||
        stringValue(item.step) ||
        stringValue(item.title) ||
        stringValue(item.description) ||
        stringValue(item.subject),
    );
    const status = stepStatus(item.status);
    return text && status !== "removed" ? [{ text, status }] : [];
  });
}

type Loop = {
  tool: string;
  set_by: string;
  started_at: string;
  at: string;
  title: string;
  iterations: number;
  stopped: boolean;
  /**
   * When a ScheduleWakeup is due; null for a recurring CronCreate. A wake-up
   * fires once: a user turn at or after it is that wake-up arriving.
   */
  due: number | null;
  /** Whether the wake-up has arrived. */
  woke: boolean;
  /** Prompts after the wake-up arrived; the loop ended if one came. */
  after: number;
};

type Goal = {
  objective: string;
  status: string;
  at: string;
  started_at: string;
};

const timeOf = (value: string) => Date.parse(value) || 0;

/** User turns the harness writes itself, which never title a quest. */
const INJECTED_PROMPT =
  /^(?:\[Request interrupted\b|<[a-z_ -]+>|Caveat: The messages below\b)/;

/**
 * The agent's current quest, or null when its transcript records none.
 * `records` are the transcript's raw records, for what the trajectory does
 * not keep (Codex goals and plan items).
 */
export function questFromSession(
  agent: string,
  trajectory: AtifTrajectory,
  records: readonly Record<string, unknown>[] = [],
): Quest | null {
  let prompt = "";
  let prompts = 0;
  let checklist = null as Checklist | null;
  let plan = null as Plan | null;
  let loop = null as Loop | null;
  let helpers = 0;
  // Claude Code numbers tasks across the session, not per list.
  let nextTask = 1;
  // TaskCreate call IDs, so a result naming the harness's task ID renames it.
  const created = new Map<string, string>();
  /** Replace one step's key in place, keeping the steps' order. */
  const rekey = (list: Checklist, from: string, to: string) => {
    list.steps = new Map(
      [...list.steps].map(([key, item]) =>
        key === from ? [to, { ...item, id: to }] : [key, item],
      ),
    );
  };

  const startChecklist = (tool: string, id: string | null, at: string) => {
    checklist = {
      tool,
      prompts,
      set_by: id,
      started_at: at,
      updated_at: at,
      title: questTitle(prompt),
      steps: new Map(),
    };
    return checklist;
  };

  for (const step of trajectory.steps) {
    const at = step.timestamp ?? "";
    if (step.source === "user" && !step.tool_calls?.length) {
      const current = loop as Loop | null;
      if (current?.woke) current.after += 1;
      else if (current && current.due !== null && timeOf(at) >= current.due)
        current.woke = true;
    }
    if (
      step.source === "user" &&
      !step.tool_calls?.length &&
      !step.extra?.notice &&
      !INJECTED_PROMPT.test(step.message.trimStart())
    ) {
      prompt = step.message;
      prompts += 1;
    }
    for (const result of step.observation?.results ?? []) {
      const callId = result.source_call_id ?? "";
      const key = created.get(callId);
      const list = checklist as Checklist | null;
      if (!key || !list?.steps.has(key)) continue;
      created.delete(callId);
      // The harness's own ID, else the next number in creation order.
      const id = /#(\d+)/.exec(result.content ?? "")?.[1] ?? String(nextTask);
      nextTask = Math.max(nextTask, Number(id) + 1);
      if (!list.steps.has(id)) rekey(list, key, id);
    }
    for (const call of step.tool_calls ?? []) {
      const name = call.function_name;
      const args = call.arguments;
      const id = call.tool_call_id;
      if (CHECKLIST_TOOLS.has(name.toLowerCase())) {
        // Repeated text keeps its own step: "Run tests", "Run tests #2".
        const seen = new Map<string, number>();
        const items = checklistItems(args).map((item) => {
          const count = (seen.get(item.text) ?? 0) + 1;
          seen.set(item.text, count);
          return {
            ...item,
            key: count > 1 ? `${item.text} #${count}` : item.text,
          };
        });
        const old = checklist as Checklist | null;
        // Clearing the list ends its quest.
        if (items.length === 0) {
          checklist = null;
          continue;
        }
        // A list sharing no step with an unfinished last one is a new quest.
        const same =
          old !== null &&
          items.some((item) => old.steps.has(item.key)) &&
          [...old.steps.values()].some((item) => item.status !== "done");
        const list = same && old ? old : startChecklist(name, id, at);
        const steps = new Map<string, QuestStep & { blocked_by: string[] }>();
        for (const item of items)
          steps.set(item.key, {
            id: item.key,
            text: item.text,
            status: item.status,
            step_ids: list.steps.get(item.key)?.step_ids ?? [],
            blocked_by: [],
          });
        list.steps = steps;
        list.tool = name;
        list.set_by = id;
        list.updated_at = at;
        if (name === "update_plan" && stringValue(args.explanation) && !same)
          list.title = questTitle(stringValue(args.explanation));
        continue;
      }
      if (TASK_TOOLS.has(name)) {
        let list = checklist as Checklist | null;
        if (name === "TaskCreate") {
          const subject = questTitle(
            stringValue(args.subject) || stringValue(args.description),
          );
          if (!subject) continue;
          // Tasks created after every earlier one finished start a new quest.
          if (
            !list ||
            !TASK_TOOLS.has(list.tool) ||
            (list.steps.size > 0 &&
              [...list.steps.values()].every((item) => item.status === "done"))
          )
            list = startChecklist(name, id, at);
          // A local key until the result names the harness's task ID, so
          // parallel creations never take each other's numbers.
          const key = `call:${id}`;
          list.steps.set(key, {
            id: key,
            text: subject,
            status: "pending",
            step_ids: [],
            blocked_by: [],
          });
          created.set(id, key);
        } else {
          const item = list?.steps.get(stringValue(args.taskId));
          if (!list || !item) continue;
          const status =
            args.status === undefined ? item.status : stepStatus(args.status);
          if (status === "removed") list.steps.delete(item.id);
          else {
            item.status = status;
            const subject = questTitle(stringValue(args.subject));
            if (subject) item.text = subject;
            if (Array.isArray(args.addBlockedBy))
              item.blocked_by.push(...args.addBlockedBy.map(String));
          }
        }
        list.set_by = id;
        list.updated_at = at;
        continue;
      }
      if (name === "ExitPlanMode") {
        const text = stringValue(args.plan);
        if (text)
          plan = { tool: name, prompts, set_by: id, at, ...planOf(text) };
        continue;
      }
      if (LOOP_TOOLS.has(name)) {
        const stop = args.stop === true;
        const title = questTitle(
          stringValue(args.prompt) || stringValue(args.reason),
        );
        const current: Loop | null = loop;
        if (stop) {
          if (current)
            Object.assign(current, { stopped: true, at, set_by: id });
          continue;
        }
        const same: Loop | null =
          current && !current.stopped && current.title === title
            ? current
            : null;
        const delay = Number(args.delaySeconds);
        loop = {
          tool: name,
          set_by: id,
          started_at: same ? same.started_at : at,
          at,
          title: title || "Loop",
          iterations: same ? same.iterations + 1 : 1,
          stopped: false,
          due:
            name === "ScheduleWakeup" && Number.isFinite(delay)
              ? timeOf(at) + delay * 1000
              : null,
          woke: false,
          after: 0,
        };
        continue;
      }
      if (HELPER_TOOLS.has(name)) helpers += 1;
      // Link this call to the step cards of every active step.
      const list = checklist as Checklist | null;
      for (const item of list?.steps.values() ?? [])
        if (item.status === "active") {
          item.step_ids.push(id);
          if (item.step_ids.length > STEP_LINKS) item.step_ids.shift();
        }
    }
  }

  let goal = null as Goal | null;
  if (agent === "codex")
    for (const record of records) {
      const payload = isRecord(record.payload) ? record.payload : null;
      if (record.type !== "event_msg" || !payload) continue;
      const at = stringValue(record.timestamp);
      if (payload.type === "thread_goal_updated" && isRecord(payload.goal)) {
        const objective = questTitle(stringValue(payload.goal.objective));
        if (!objective) continue;
        const createdAt = Number(payload.goal.createdAt);
        const previous: Goal | null = goal;
        goal = {
          objective,
          status: stringValue(payload.goal.status),
          at,
          started_at:
            previous?.objective === objective
              ? previous.started_at
              : Number.isFinite(createdAt) && createdAt > 0
                ? new Date(createdAt * 1000).toISOString()
                : at,
        };
      } else if (
        payload.type === "item_completed" &&
        isRecord(payload.item) &&
        payload.item.type === "Plan"
      ) {
        const text = stringValue(payload.item.text);
        // Codex records no prompt count here; its plan item ends a turn.
        if (text)
          plan = {
            tool: "plan",
            prompts: Number.POSITIVE_INFINITY,
            set_by: null,
            at,
            ...planOf(text),
          };
      }
    }

  const finish = (
    quest: Omit<Quest, "quest_version" | "status" | "progress" | "helpers">,
    status?: Quest["status"],
  ): Quest => {
    const done = quest.steps.filter((item) => item.status === "done").length;
    const total = quest.steps.length;
    return {
      quest_version: 1,
      ...quest,
      status:
        status ??
        (total > 0 && done === total
          ? "done"
          : // Blocked only when every unfinished step is blocked.
            quest.steps.some(
                (item) => item.status === "active" || item.status === "pending",
              ) || !quest.steps.some((item) => item.status === "blocked")
            ? "active"
            : "blocked"),
      progress: { done, total },
      helpers,
    };
  };
  const list = checklist as Checklist | null;
  const listSteps = (): QuestStep[] =>
    list
      ? [...list.steps.values()].map(({ blocked_by, ...item }) => ({
          ...item,
          status:
            item.status === "pending" &&
            blocked_by.some((id) => {
              // A blocker that was deleted no longer blocks.
              const blocker = list.steps.get(id);
              return blocker !== undefined && blocker.status !== "done";
            })
              ? "blocked"
              : item.status,
          step_ids: [...item.step_ids],
        }))
      : [];

  // A completed goal gives way to work begun after it.
  const goalCurrent =
    goal !== null &&
    !(
      goal.status === "complete" &&
      [list?.updated_at, plan?.at, loop?.at].some(
        (at) => at !== undefined && timeOf(at) > timeOf(goal!.at),
      )
    );
  if (goal && goalCurrent) {
    // A completed goal is authoritative: the plan it carried may have been
    // left unfinished, and showing "Complete" beside 1/2 and a step still
    // active would contradict it. It keeps no steps.
    const withSteps =
      goal.status !== "complete" &&
      list &&
      timeOf(list.updated_at) >= timeOf(goal.started_at);
    return finish(
      {
        source: "goal",
        tool: "thread_goal",
        title: goal.objective,
        steps: withSteps ? listSteps() : [],
        started_at: goal.started_at,
        updated_at:
          withSteps && timeOf(list.updated_at) > timeOf(goal.at)
            ? list.updated_at
            : goal.at,
        set_by: withSteps ? list.set_by : null,
      },
      goal.status === "complete"
        ? "done"
        : goal.status === "paused"
          ? "paused"
          : ["blocked", "usage_limited", "budget_limited"].includes(goal.status)
            ? "blocked"
            : undefined,
    );
  }

  const latest = [
    list && { kind: "todo" as const, at: list.updated_at },
    plan && { kind: "plan" as const, at: (plan as Plan).at },
    loop && {
      kind: "loop" as const,
      at: (loop as NonNullable<typeof loop>).at,
    },
  ]
    .filter((value) => !!value)
    .reduce<{ kind: QuestSource; at: string } | null>(
      (best, value) =>
        !best || timeOf(value.at) >= timeOf(best.at) ? value : best,
      null,
    );
  if (!latest) return null;
  if (latest.kind === "todo" && list) {
    const approved = plan as Plan | null;
    // A list made after an approved plan, with no new prompt between them,
    // carries out that plan.
    const title =
      approved &&
      timeOf(approved.at) <= timeOf(list.started_at) &&
      (approved.prompts === Number.POSITIVE_INFINITY ||
        approved.prompts === list.prompts)
        ? approved.title
        : list.title;
    return finish({
      source: "todo",
      tool: list.tool,
      title: title || "Checklist",
      steps: listSteps(),
      started_at: list.started_at,
      updated_at: list.updated_at,
      set_by: list.set_by,
    });
  }
  if (latest.kind === "plan" && plan) {
    const approved = plan as Plan;
    return finish(
      {
        source: "plan",
        tool: approved.tool,
        title: approved.title || "Plan",
        steps: approved.steps.map((text, index) => ({
          id: String(index + 1),
          text,
          status: "pending",
          step_ids: [],
        })),
        started_at: approved.at,
        updated_at: approved.at,
        set_by: approved.set_by,
      },
      "active",
    );
  }
  const running = loop as Loop | null;
  if (!running) return null;
  // A wake-up that arrived and was not scheduled again ended the loop once
  // that turn finished: a final answer, or another prompt after it.
  const last = trajectory.steps[trajectory.steps.length - 1];
  const ended =
    running.woke &&
    (running.after > 0 ||
      (last?.source === "agent" && !last.tool_calls?.length));
  return finish(
    {
      source: "loop",
      tool: running.tool,
      title: running.title,
      steps: [],
      started_at: running.started_at,
      updated_at: running.at,
      set_by: running.set_by,
      iterations: running.iterations,
    },
    running.stopped || ended ? "done" : "active",
  );
}
