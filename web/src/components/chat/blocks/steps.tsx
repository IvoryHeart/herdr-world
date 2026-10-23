import { memo } from "react";
import "./steps.css";

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

function duration(step: ConversationStep) {
  if (!step.ended_at) return null;
  const ms = Date.parse(step.ended_at) - Date.parse(step.started_at);
  // Under a tenth of a second is not worth a label.
  if (!Number.isFinite(ms) || ms < 100) return null;
  return ms < 60_000
    ? `${(ms / 1000).toFixed(1)}s`
    : `${Math.floor(ms / 60_000)}m ${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}s`;
}

/**
 * What a tool call's History row adds from Chat's step model: the test badge
 * and how long the call took.
 */
export const StepRowEvidence = memo(function StepRowEvidence({
  step,
}: {
  step: ConversationStep;
}) {
  const took = duration(step);
  return (
    <>
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
    </>
  );
});

/**
 * An opened row's evidence: the pass and fail counts of a test run with its
 * first failure, or the diff of an edit. History's row already shows the
 * call's arguments and output below it. Nothing when the step has neither.
 */
export const StepDetailEvidence = memo(function StepDetailEvidence({
  step,
}: {
  step: ConversationStep;
}) {
  if (!step.diff && !step.test) return null;
  return (
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
    </div>
  );
});
