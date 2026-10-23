import { useState } from "react";
import type { Quest } from "../../../server/src/agent/quest";
import {
  QUEST_SOURCE_LABELS,
  questCurrentStep,
  questProgressText,
} from "../world/agentQuests";
import "./QuestLog.css";

const STEP_MARKS: Record<Quest["steps"][number]["status"], string> = {
  done: "✓",
  active: "▸",
  blocked: "!",
  pending: "·",
};

const STATUS_WORDS: Record<Quest["status"], string> = {
  active: "In progress",
  done: "Complete",
  blocked: "Blocked",
  paused: "Paused",
};

/** Where the quest came from, in the harness's own words. */
function questOrigin(quest: Quest) {
  const parts = [`${QUEST_SOURCE_LABELS[quest.source]} from ${quest.tool}`];
  if (quest.helpers)
    parts.push(`${quest.helpers} helper${quest.helpers === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/**
 * A small quest progress chip for a card or desk label: a flag, then "2/5"
 * or the quest's kind. Its title names the quest and the current step.
 */
export function QuestChip({ quest }: { quest: Quest }) {
  const step = questCurrentStep(quest);
  return (
    <span
      className={`quest-chip is-${quest.status}`}
      title={`${quest.title}${step ? ` · now: ${step.text}` : ""} (${STATUS_WORDS[quest.status]})`}
      aria-label={`Quest ${questProgressText(quest)}: ${quest.title}`}
      data-quest-source={quest.source}
    >
      <span aria-hidden="true">⚑</span>
      {questProgressText(quest)}
    </span>
  );
}

/**
 * The agent's quest in Mission Log style: title, progress bar and its
 * objectives, read from the agent's own todos, plan, goal or loop. It folds
 * to one line; nothing is shown when the transcript records no quest.
 */
export function QuestLog({ quest }: { quest: Quest | null | undefined }) {
  const [open, setOpen] = useState(true);
  if (!quest) return null;
  const { done, total } = quest.progress;
  const percent = total > 0 ? Math.round((done / total) * 100) : null;
  return (
    <section
      className={`quest-log is-${quest.status}`}
      aria-label="Quest"
      data-quest-source={quest.source}
    >
      <button
        type="button"
        className="quest-log-head"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="quest-log-flag" aria-hidden="true">
          ⚑
        </span>
        <span className="quest-log-title">{quest.title}</span>
        <span className="quest-log-count">{questProgressText(quest)}</span>
      </button>
      {percent !== null ? (
        <div
          className="quest-log-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-label={`${done} of ${total} objectives done`}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
      ) : null}
      {open ? (
        <>
          {quest.steps.length ? (
            <ol className="quest-log-steps">
              {quest.steps.map((step) => (
                <li key={step.id} className={`is-${step.status}`}>
                  <span className="quest-log-mark" aria-hidden="true">
                    {STEP_MARKS[step.status]}
                  </span>
                  <span>{step.text}</span>
                </li>
              ))}
            </ol>
          ) : null}
          <p className="quest-log-meta">
            {STATUS_WORDS[quest.status]} · {questOrigin(quest)}
          </p>
        </>
      ) : null}
    </section>
  );
}
