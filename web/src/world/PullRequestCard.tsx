import { ChevronRight, Copy, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  actionablePullRequest,
  confirmedAt,
  mergeCommand,
  mergeUnavailable,
  PULL_REQUEST_VERB_LABELS,
  pullRequestReadiness,
  REVIEWS_COME_FROM_COMMENTS,
  shortSha,
  verbConsequence,
  type PullRequestAttention,
  type PullRequestCheck,
  type PullRequestVerb,
  type ReadinessRule,
} from "../../../shared/pullRequests";
import { workBadgeText, type WorkItem } from "../../../shared/worldSources";
import { runPullRequestVerb } from "./worldSources";
import "./pullRequestCard.css";

/**
 * One pull request card for every view: CI on the head, reviewer results,
 * the owner's merge rules, and the verbs World runs for you (merge, close,
 * mark ready), each behind a sheet that says exactly what happens. The
 * outcome is GitHub's: the card shows it once the source refreshes.
 */

export type PullRequestCardAgent = { id: string; label: string };

const GLYPH: Record<ReadinessRule["state"], string> = {
  pass: "✓",
  fail: "✗",
  unknown: "?",
};
const RUNNING: Record<PullRequestVerb, string> = {
  merge: "Merging…",
  close: "Closing…",
  ready: "Marking ready…",
};
const DONE: Record<PullRequestVerb, string> = {
  merge: "Merged",
  close: "Closed",
  ready: "Marked ready",
};
const MAX_DOTS = 12;

export function PullRequestCard({
  item,
  agents = [],
  attention = null,
  compact = false,
  onSelectAgent,
  onAskAuthor,
}: {
  item: WorkItem;
  agents?: PullRequestCardAgent[];
  attention?: PullRequestAttention | null;
  /** One line and Open, Details and Merge…, for Chat and popovers. */
  compact?: boolean;
  onSelectAgent?(id: string): void;
  /** Ask the agent on it to fix, as a Chat message; absent where there is no Chat. */
  onAskAuthor?(item: WorkItem): void;
}) {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<PullRequestVerb | null>(null);
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "running"; verb: PullRequestVerb }
    | { kind: "done"; verb: PullRequestVerb; seen: string }
    | { kind: "failed"; detail: string }
  >({ kind: "idle" });
  const rules = pullRequestReadiness(item);
  const failing = rules.filter((rule) => rule.state === "fail");
  const ready = rules.every((rule) => rule.state === "pass");
  const actionable = actionablePullRequest(item);
  const blocked = mergeUnavailable(item);
  // GitHub's answer replaces "Merged" once the source shows the change.
  const seen = `${item.lane}|${item.draft}|${item.headSha}`;
  useEffect(() => {
    if (state.kind === "done" && seen !== state.seen)
      setState({ kind: "idle" });
  }, [seen, state]);

  const run = async (verb: PullRequestVerb, comment?: string) => {
    setSheet(null);
    setState({ kind: "running", verb });
    try {
      const action = await runPullRequestVerb(item, verb, { comment });
      setState(
        action.outcome === "done"
          ? { kind: "done", verb, seen }
          : { kind: "failed", detail: action.detail ?? "GitHub refused." },
      );
    } catch (cause) {
      setState({
        kind: "failed",
        detail: cause instanceof Error ? cause.message : "Could not run it.",
      });
    }
  };

  const running = state.kind === "running";
  const mergeControl = !actionable ? null : blocked ? (
    <MergeCommand item={item} reason={blocked} />
  ) : (
    <button
      type="button"
      className="pr-card-primary"
      disabled={running}
      onClick={() => setSheet("merge")}
    >
      {running && state.verb === "merge" ? RUNNING.merge : "Merge…"}
    </button>
  );

  return (
    <article
      className={`pr-card${compact ? " pr-card-compact" : ""}`}
      aria-label={`Pull request ${item.ref}`}
      data-ready={ready || undefined}
    >
      <header className="pr-card-head">
        <a
          className="pr-card-ref"
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${item.ref} on GitHub`}
        >
          {item.repo ? `${item.repo} ` : ""}
          {workBadgeText(item)}
          <ExternalLink size={12} aria-hidden="true" />
        </a>
        <p className="pr-card-title">{item.title}</p>
      </header>
      <p className="pr-card-summary">
        <CheckDots item={item} />
        {item.pr?.reviewers.map((entry) => (
          <span key={entry.reviewer} data-outcome={entry.outcome}>
            {entry.reviewer}{" "}
            {entry.outcome === "confirmed"
              ? entry.commitsSince === 0
                ? "confirmed"
                : "confirmed earlier"
              : entry.outcome === "open"
                ? "open"
                : "?"}
          </span>
        ))}
        {actionable ? (
          <span
            data-state={ready ? "pass" : failing.length ? "fail" : "unknown"}
          >
            {ready
              ? "Ready ✓"
              : failing.length
                ? `${failing.length} rule${failing.length === 1 ? "" : "s"} ✗`
                : "Readiness ?"}
          </span>
        ) : null}
      </p>
      {attention ? (
        <p className="pr-card-attention" data-reason={attention.reason}>
          {attention.reason === "stalled"
            ? `Stalled: ${attention.label}`
            : attention.label}
        </p>
      ) : null}
      {state.kind === "failed" ? (
        <p className="pr-card-failed" role="alert">
          {state.detail}
        </p>
      ) : state.kind === "done" ? (
        <p className="pr-card-done" role="status">
          {DONE[state.verb]} · waiting for GitHub
        </p>
      ) : null}
      {sheet ? (
        <ConfirmSheet
          item={item}
          verb={sheet}
          failing={sheet === "merge" ? failing : []}
          onCancel={() => setSheet(null)}
          onConfirm={(comment) => void run(sheet, comment)}
        />
      ) : (
        <div className="pr-card-actions">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronRight size={14} aria-hidden="true" />
            Details
          </button>
          {compact || !open ? mergeControl : null}
        </div>
      )}
      {open ? (
        <div className="pr-card-detail">
          <Readiness rules={rules} />
          <Checks
            checks={item.pr?.checks}
            truncated={item.pr?.checksTruncated}
          />
          <section aria-label="Reviews">
            <h4>Reviews</h4>
            {item.pr?.reviewers.length ? (
              <ul>
                {item.pr.reviewers.map((entry) => (
                  <li key={entry.reviewer} data-outcome={entry.outcome}>
                    <b>{entry.reviewer}</b> {entry.line}
                    <small>
                      {entry.outcome === "confirmed"
                        ? `${confirmedAt(entry)} · `
                        : ""}
                      {entry.url ? (
                        <a
                          href={entry.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          per {entry.reviewer}'s comment
                        </a>
                      ) : (
                        `per ${entry.reviewer}'s comment`
                      )}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{item.pr ? "No reviewer result yet." : "Not read yet."}</p>
            )}
            <p className="pr-card-note">{REVIEWS_COME_FROM_COMMENTS}</p>
          </section>
          <p className="pr-card-facts">
            {item.headSha ? (
              <>
                Head <code>{shortSha(item.headSha)}</code>
              </>
            ) : null}
            {item.pr?.behindBy !== undefined && item.pr.behindBy !== null
              ? ` · ${item.pr.behindBy} behind ${item.pr.baseRef}`
              : ""}
          </p>
          {agents.length ? (
            <div className="pr-card-agents">
              {agents.map((agent) =>
                onSelectAgent ? (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => onSelectAgent(agent.id)}
                    aria-label={`Show agent ${agent.label}`}
                  >
                    {agent.label}
                  </button>
                ) : (
                  <span key={agent.id}>{agent.label}</span>
                ),
              )}
            </div>
          ) : null}
          {actionable && !sheet ? (
            <div className="pr-card-actions">
              {compact ? null : mergeControl}
              {item.draft ? (
                <button
                  type="button"
                  disabled={running}
                  onClick={() => setSheet("ready")}
                >
                  {running && state.verb === "ready"
                    ? RUNNING.ready
                    : "Mark ready…"}
                </button>
              ) : null}
              <button
                type="button"
                disabled={running}
                onClick={() => setSheet("close")}
              >
                {running && state.verb === "close" ? RUNNING.close : "Close…"}
              </button>
              {onAskAuthor && agents.length ? (
                <button type="button" onClick={() => onAskAuthor(item)}>
                  Ask the author to fix
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function CheckDots({ item }: { item: WorkItem }) {
  const checks = item.pr?.checks;
  if (!checks?.length)
    return item.checks && item.checks !== "none" ? (
      <span data-state={item.checks}>CI {item.checks}</span>
    ) : null;
  const order = { fail: 0, pending: 1, pass: 2, skipped: 3 } as const;
  const sorted = [...checks].sort((a, b) => order[a.state] - order[b.state]);
  const counts = (state: PullRequestCheck["state"]) =>
    checks.filter((check) => check.state === state).length;
  const label = [
    `${counts("pass")} passed`,
    counts("fail") ? `${counts("fail")} failing` : "",
    counts("pending") ? `${counts("pending")} running` : "",
    counts("skipped") ? `${counts("skipped")} skipped` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <span className="pr-card-dots" aria-label={`CI: ${label}`} role="img">
      CI{" "}
      {sorted.slice(0, MAX_DOTS).map((check, index) => (
        <i key={index} data-state={check.state} />
      ))}
      {sorted.length > MAX_DOTS ? `+${sorted.length - MAX_DOTS}` : ""}
    </span>
  );
}

function Readiness({ rules }: { rules: ReadinessRule[] }) {
  return (
    <section aria-label="Readiness">
      <h4>Readiness</h4>
      <ul>
        {rules.map((rule) => (
          <li key={rule.id} data-state={rule.state}>
            <span aria-hidden="true">{GLYPH[rule.state]}</span> {rule.label}
            <small>{rule.detail}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Checks({
  checks,
  truncated,
}: {
  checks: PullRequestCheck[] | undefined;
  truncated: boolean | undefined;
}) {
  if (!checks) return null;
  const failing = checks.filter((check) => check.state === "fail");
  const running = checks.filter((check) => check.state === "pending");
  const rest = checks.filter(
    (check) => check.state === "pass" || check.state === "skipped",
  );
  const row = (check: PullRequestCheck, index: number) => (
    <li key={`${check.name}-${index}`} data-state={check.state}>
      {check.url ? (
        <a href={check.url} target="_blank" rel="noopener noreferrer">
          {check.name}
        </a>
      ) : (
        check.name
      )}
      {check.required ? <small>required</small> : null}
    </li>
  );
  return (
    <section aria-label="Checks">
      <h4>CI on head</h4>
      {checks.length ? null : <p>No checks reported.</p>}
      {failing.length || running.length ? (
        <ul>{[...failing, ...running].map(row)}</ul>
      ) : null}
      {rest.length ? (
        <details>
          <summary>
            {rest.length} passed or skipped
            {truncated ? " (more on GitHub)" : ""}
          </summary>
          <ul>{rest.map(row)}</ul>
        </details>
      ) : null}
    </section>
  );
}

function MergeCommand({ item, reason }: { item: WorkItem; reason: string }) {
  const [copied, setCopied] = useState(false);
  const command = mergeCommand(item);
  return (
    <div className="pr-card-command">
      <p>{reason}</p>
      <code>{command}</code>
      <span>
        <a
          className="pr-card-primary"
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open on GitHub
        </a>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(command)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          <Copy size={13} aria-hidden="true" />
          {copied ? "Copied" : "Copy merge command"}
        </button>
      </span>
    </div>
  );
}

function ConfirmSheet({
  item,
  verb,
  failing,
  onCancel,
  onConfirm,
}: {
  item: WorkItem;
  verb: PullRequestVerb;
  failing: ReadinessRule[];
  onCancel(): void;
  onConfirm(comment?: string): void;
}) {
  const [comment, setComment] = useState("");
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => confirmRef.current?.focus(), []);
  const label =
    verb === "merge" && failing.length
      ? `Merge despite ${failing.length} failing rule${failing.length === 1 ? "" : "s"}`
      : PULL_REQUEST_VERB_LABELS[verb];
  return (
    <div
      className="pr-card-sheet"
      role="group"
      aria-label={`${PULL_REQUEST_VERB_LABELS[verb]} #${item.number}`}
      data-verb={verb}
    >
      <p>{verbConsequence(item, verb)}</p>
      {failing.length ? (
        <ul>
          {failing.map((rule) => (
            <li key={rule.id}>
              ✗ {rule.label}: {rule.detail}
            </li>
          ))}
        </ul>
      ) : null}
      {verb === "close" ? (
        <label>
          Comment (optional)
          <textarea
            value={comment}
            maxLength={4_000}
            rows={2}
            onChange={(event) => setComment(event.target.value)}
          />
        </label>
      ) : null}
      <div className="pr-card-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          ref={confirmRef}
          type="button"
          className={verb === "close" ? "pr-card-danger" : "pr-card-primary"}
          onClick={() => onConfirm(verb === "close" ? comment : undefined)}
        >
          {label}
        </button>
      </div>
    </div>
  );
}
