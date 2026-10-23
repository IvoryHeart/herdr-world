import { memo, useEffect, useRef, useState } from "react";

// Mirrors server/src/agent/conversation-steps.ts.
export type ConversationStep = {
  id: string;
  call_id: string | null;
  tool: string;
  label: string;
  input_summary: string | null;
  state: "running" | "ok" | "failed" | "interrupted";
  started_at: string;
  ended_at: string | null;
  result_tail: string | null;
  diff: {
    file: string;
    removed: string[];
    added: string[];
    truncated: boolean;
    omitted: number;
  } | null;
  test: {
    runner: string;
    passed: number;
    failed: number;
    first_failure: string | null;
  } | null;
};

const ICON: Record<ConversationStep["state"], string> = {
  running: "",
  ok: "✓",
  failed: "✗",
  interrupted: "■",
};

const STATE_WORD: Record<ConversationStep["state"], string> = {
  running: "Running",
  ok: "Done",
  failed: "Failed",
  interrupted: "Interrupted",
};

function duration(step: ConversationStep) {
  if (!step.ended_at) return null;
  const ms = Date.parse(step.ended_at) - Date.parse(step.started_at);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms < 60_000
    ? `${(ms / 1000).toFixed(1)}s`
    : `${Math.floor(ms / 60_000)}m ${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}s`;
}

/** Whether a step reads files, so a run of them folds into one card. */
export const readsFiles = (step: ConversationStep) =>
  step.state === "ok" &&
  /^(read|view|read_file|glob|grep|search)$/i.test(step.tool);

/**
 * One tool call: its label, what it names and how long it took. Opened, it
 * shows its evidence: the diff of an edit, the pass and fail counts of a test
 * run, or the end of its output. Running and failed steps start open; the
 * rest fold to one line.
 */
export const StepCard = memo(function StepCard({
  step,
}: {
  step: ConversationStep;
}) {
  // Open follows the step's state (running and failed open, the rest fold)
  // until the reader opens or folds it themselves.
  const opensByDefault = step.state === "running" || step.state === "failed";
  const [open, setOpen] = useState(opensByDefault);
  const toggled = useRef(false);
  useEffect(() => {
    if (!toggled.current) setOpen(opensByDefault);
  }, [opensByDefault]);
  const hasBody = Boolean(step.diff || step.test || step.result_tail);
  const took = duration(step);
  return (
    <article
      className={`agent-chat-step is-${step.state}`}
      data-step-id={step.id}
      data-role="tool"
    >
      <button
        type="button"
        className="agent-chat-step-head"
        aria-expanded={hasBody ? open : undefined}
        // A step with nothing to show yet stays at full strength; it simply
        // does not open.
        aria-disabled={hasBody ? undefined : true}
        onClick={() => {
          if (!hasBody) return;
          toggled.current = true;
          setOpen((value) => !value);
        }}
      >
        <span
          className="agent-chat-step-icon"
          aria-label={STATE_WORD[step.state]}
        >
          {step.state === "running" ? (
            <span className="agent-chat-spinner" aria-hidden="true" />
          ) : (
            ICON[step.state]
          )}
        </span>
        <span className="agent-chat-step-label">
          <b>{step.label}</b>
          {step.input_summary && !step.label.includes(step.input_summary) ? (
            <code>{step.input_summary}</code>
          ) : null}
        </span>
        {step.test ? (
          <span
            className={`agent-chat-step-badge ${step.test.failed ? "is-red" : "is-green"}`}
          >
            {step.test.failed
              ? `${step.test.failed} failed`
              : `${step.test.passed} passed`}
          </span>
        ) : null}
        {took ? <span className="agent-chat-step-time">{took}</span> : null}
      </button>
      {open && hasBody ? (
        <div className="agent-chat-step-body">
          {step.test ? (
            <div
              className={`agent-chat-step-strip ${step.test.failed ? "is-red" : "is-green"}`}
            >
              <span>
                {step.test.failed ? "✗" : "✓"} {step.test.passed} passed
                {step.test.failed ? ` · ${step.test.failed} failed` : ""}
              </span>
              <span className="agent-chat-step-bar" aria-hidden="true">
                <i
                  style={{
                    width: `${(100 * step.test.passed) / Math.max(1, step.test.passed + step.test.failed)}%`,
                  }}
                />
              </span>
            </div>
          ) : null}
          {step.test?.first_failure ? (
            <p className="agent-chat-step-failure">{step.test.first_failure}</p>
          ) : null}
          {step.diff ? (
            <pre
              className="agent-chat-step-diff"
              aria-label={`Changes to ${step.diff.file}`}
            >
              <span className="is-head">{step.diff.file}</span>
              {step.diff.removed.map((line, index) => (
                <span key={`r${index}`} className="is-removed">
                  - {line}
                </span>
              ))}
              {step.diff.added.map((line, index) => (
                <span key={`a${index}`} className="is-added">
                  + {line}
                </span>
              ))}
              {step.diff.truncated ? (
                <span className="is-head">
                  … {step.diff.omitted} more{" "}
                  {step.diff.omitted === 1 ? "line" : "lines"}; see Changes
                </span>
              ) : null}
            </pre>
          ) : null}
          {step.result_tail && !step.diff ? (
            <pre className="agent-chat-step-tail">{step.result_tail}</pre>
          ) : null}
        </div>
      ) : null}
    </article>
  );
});

/** A run of file reads, folded into one card with the files as chips. */
export function StepGroup({ steps }: { steps: readonly ConversationStep[] }) {
  return (
    <article
      className="agent-chat-step is-ok is-group"
      data-step-id={steps[0]!.id}
      data-role="tool"
    >
      <div className="agent-chat-step-head">
        <span className="agent-chat-step-icon" aria-label="Done">
          ✓
        </span>
        <span className="agent-chat-step-label">
          <b>
            {steps.every((step) => /^(read|view|read_file)$/i.test(step.tool))
              ? `Read ${steps.length} files`
              : `${steps.length} lookups`}
          </b>
          <span className="agent-chat-step-files">
            {steps.map((step) => (
              <code key={step.id}>{step.input_summary ?? step.label}</code>
            ))}
          </span>
        </span>
      </div>
    </article>
  );
}
