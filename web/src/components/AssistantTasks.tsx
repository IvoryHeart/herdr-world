import { TaskForm } from "./AssistantTaskForm";
import { ChevronLeft, LoaderCircle, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type AssistantSnapshot,
  type AssistantSource,
  type AssistantTaskDetail,
  type AssistantTaskProposal,
  type AssistantTaskSchedule,
  type AssistantWorkspace,
  type AssistantWorkspaceRef,
} from "../../../shared/assistant";
import { callAssistant, getAssistantTask } from "../assistant";
import type { RangerTaskNotificationTarget } from "../taskNotifications";
import { formatUiDateTime } from "../uiLocale";
import { ActionCard, AssistantMessageActivity } from "./AssistantPanel";
import { MarkdownPreview } from "./markdown";
import { AssistantThinking } from "./AssistantThinking";
import { ConfirmDialog } from "./ModalDialogs";
import { ThemedSelect } from "./ThemedSelect";
import "./AssistantTasks.css";

function workspaceKey(ref: AssistantWorkspaceRef) {
  return JSON.stringify([ref.connection_id, ref.workspace_id]);
}

export function taskScheduleLabel(schedule: AssistantTaskSchedule) {
  if (schedule.type === "once") return `Once: ${formatUiDateTime(schedule.at)}`;
  if (schedule.type === "daily")
    return `Daily at ${schedule.time} (${schedule.timezone})`;
  return `Every ${schedule.minutes} minute${schedule.minutes === 1 ? "" : "s"}`;
}

const liveRun = (status: string | undefined) =>
  !!status && ["queued", "running", "waiting"].includes(status);

export function TaskProposalCard({
  proposal,
  busy,
  run,
}: {
  proposal: AssistantTaskProposal;
  busy: boolean;
  run: (action: string, params?: Record<string, unknown>) => Promise<boolean>;
}) {
  const operation = proposal.operation ?? "create";
  const operationLabel = {
    create: "Create task",
    update: "Edit task",
    pause: "Pause task",
    resume: "Resume task",
    cancel: "Cancel task",
    delete: "Delete task",
  }[operation];
  const confirmedLabel = {
    create: "Enabled",
    update: "Updated",
    pause: "Paused",
    resume: "Resumed",
    cancel: "Task cancelled",
    delete: "Deleted",
  }[operation];
  const explanation = {
    create:
      "Confirm to enable this task. Workspace actions still need your confirmation.",
    update:
      "Confirm to update this task. Its scope, model and Agent references stay the same. Existing runs keep their instructions; future workspace actions require confirmation. A paused task stays paused.",
    pause:
      "Confirm to pause future scheduled runs. An already-started run will continue.",
    resume: "Confirm to resume scheduled runs of this task.",
    cancel:
      "Confirm to permanently cancel this task and stop its active run. Its history will be kept.",
    delete:
      "Confirm to permanently delete this cancelled task and its private run history. This cannot be undone.",
  }[operation];
  return (
    <div
      className="assistant-task-proposal assistant-action-card"
      role="group"
      aria-label="Task proposal"
      tabIndex={-1}
    >
      <div className="assistant-action-head">
        <strong>{proposal.title}</strong>
        <span>
          {proposal.status === "pending"
            ? "Needs confirmation"
            : proposal.status === "confirmed"
              ? confirmedLabel
              : "Preview cancelled"}
        </span>
      </div>
      {operation !== "create" ? (
        <>
          <p>{operationLabel}</p>
          <span className="assistant-hint">Task ID: {proposal.task_id}</span>
        </>
      ) : null}
      <p>{taskScheduleLabel(proposal.schedule)}</p>
      <span className="assistant-hint">
        {proposal.all_workspaces
          ? `Every workspace Ranger may use when it runs (${proposal.scope.length} now)`
          : `${proposal.scope.length} authorized workspace${proposal.scope.length === 1 ? "" : "s"}`}
      </span>
      <details className="assistant-task-prompt">
        <summary>Task prompt</summary>
        <p>{proposal.prompt}</p>
      </details>
      <span className="assistant-hint">
        {proposal.notification_mode === "agent"
          ? "Ranger decides when to notify"
          : "Notify when each run finishes"}
      </span>
      {proposal.detail ? (
        <p className="assistant-hint">{proposal.detail}</p>
      ) : null}
      {proposal.status === "pending" ? (
        <>
          <p className="assistant-hint">{explanation}</p>
          <div className="assistant-action-buttons">
            <button
              type="button"
              disabled={busy}
              onClick={(event) => {
                event.currentTarget
                  .closest<HTMLElement>(".assistant-task-proposal")
                  ?.focus({ preventScroll: true });
                void run("task.confirm_proposal", { proposal_id: proposal.id });
              }}
            >
              {operation === "create" ? "Confirm task" : `Confirm ${operation}`}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={(event) => {
                event.currentTarget
                  .closest<HTMLElement>(".assistant-task-proposal")
                  ?.focus({ preventScroll: true });
                void run("task.cancel_proposal", { proposal_id: proposal.id });
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function AssistantTasks({
  active = true,
  requestedTask,
  onRequestedTaskHandled,
  snapshot,
  connected,
  workspaces,
  onOpenSettings,
  onOpenSource,
}: {
  active?: boolean;
  requestedTask?: RangerTaskNotificationTarget | null;
  onRequestedTaskHandled?: () => void;
  snapshot: AssistantSnapshot;
  connected: boolean;
  workspaces: AssistantWorkspace[];
  onOpenSettings: () => void;
  onOpenSource: (source: AssistantSource) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | undefined>();
  const [detail, setDetail] = useState<AssistantTaskDetail | null>(null);
  const [editor, setEditor] = useState<"new" | "edit" | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<"cancel" | "delete" | null>(
    null,
  );
  const [showCancelled, setShowCancelled] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const pending = useRef(false);
  const cancelDetailRequest = useRef<(() => void) | null>(null);
  const creationRequest = useRef<{ key: string; id: string } | null>(null);
  const tasks = snapshot.tasks ?? [];
  const visibleTasks = tasks.filter(
    (item) => showCancelled || item.status !== "cancelled",
  );
  const summary = tasks.find((task) => task.id === selectedId);
  const selectedAvailable = !!summary;
  const requestedTaskAvailable =
    !!requestedTask && tasks.some((task) => task.id === requestedTask.taskId);
  useEffect(() => {
    if (!requestedTask) return;
    cancelDetailRequest.current?.();
    setSelectedId(null);
    setRunId(undefined);
    setDetail(null);
    setEditor(null);
    setConfirmation(null);
    onRequestedTaskHandled?.();
    if (!requestedTaskAvailable) {
      setError("This Ranger task is no longer available.");
      return;
    }
    setSelectedId(requestedTask.taskId);
    setRunId(requestedTask.runId);
    setError(null);
    setRefresh((value) => value + 1);
  }, [requestedTask, requestedTaskAvailable, onRequestedTaskHandled]);
  const signature = summary
    ? JSON.stringify([
        summary.updated_at,
        summary.status,
        summary.current_run?.id,
        summary.current_run?.status,
        summary.last_run?.id,
        summary.last_run?.status,
      ])
    : "";
  const ready =
    connected &&
    !!snapshot.config.provider &&
    !!snapshot.config.model &&
    snapshot.providers.some(
      (provider) =>
        provider.id === snapshot.config.provider && provider.configured,
    ) &&
    snapshot.models.some(
      (model) =>
        model.provider === snapshot.config.provider &&
        model.id === snapshot.config.model,
    ) &&
    !["waiting", "working"].includes(snapshot.auth?.status ?? "");
  useEffect(() => {
    if (selectedId && !selectedAvailable && !busy) {
      setSelectedId(null);
      setRunId(undefined);
      setDetail(null);
      setEditor(null);
      setError(null);
      setConfirmation(null);
    }
  }, [selectedId, selectedAvailable, busy]);
  useEffect(() => {
    if (
      !active ||
      !selectedId ||
      !selectedAvailable ||
      !connected ||
      editor ||
      busy
    )
      return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let poll = liveRun(summary?.current_run?.status);
    setLoading(true);
    const load = async () => {
      try {
        const value = await getAssistantTask(selectedId, runId);
        if (cancelled) return;
        setDetail(value);
        setError(null);
        if (!runId && !value.run && value.runs.length)
          setRunId(
            value.task.current_run?.id ??
              value.task.last_run?.id ??
              value.runs[0].id,
          );
        poll =
          liveRun(value.task.current_run?.status) || liveRun(value.run?.status);
      } catch (cause) {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) {
          setLoading(false);
          if (poll) timer = setTimeout(() => void load(), 1000);
        }
      }
    };
    const cancel = () => {
      cancelled = true;
      clearTimeout(timer);
    };
    cancelDetailRequest.current = cancel;
    void load();
    return cancel;
  }, [
    active,
    selectedId,
    selectedAvailable,
    runId,
    connected,
    snapshot.instance_id,
    signature,
    summary?.current_run?.status,
    refresh,
    editor,
    busy,
  ]);
  const select = (id: string | null) => {
    cancelDetailRequest.current?.();
    setSelectedId(id);
    setRunId(undefined);
    setDetail(null);
    setEditor(null);
    setError(null);
    creationRequest.current = null;
  };
  const mutate = async (action: string, params: Record<string, unknown>) => {
    if (pending.current || !connected) return null;
    cancelDetailRequest.current?.();
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const value = (await callAssistant(
        `task.${action}`,
        params,
      )) as AssistantSnapshot;
      setRefresh((value) => value + 1);
      return value;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const task = detail?.task ?? summary;
  const selectedRun = detail?.run;
  const runBusy =
    ["queued", "running"].includes(selectedRun?.status ?? "") ||
    !!selectedRun?.messages.some((message) =>
      message.actions?.some((action) => action.status === "executing"),
    );
  return (
    <div className="assistant-tasks" aria-label="Ranger tasks" hidden={!active}>
      {error ? (
        <p className="assistant-task-error" role="alert">
          {error}
        </p>
      ) : null}
      {editor ? (
        <TaskForm
          active={active}
          key={editor === "edit" ? task?.id : "new"}
          task={editor === "edit" ? task : undefined}
          workspaces={workspaces}
          busy={busy || !connected}
          ready={ready}
          highPermission={snapshot.config.approval_mode === "auto"}
          allWorkspacesAllowed={
            snapshot.config.approval_mode === "auto" &&
            snapshot.config.workspace_scope === "all"
          }
          onOpenSettings={onOpenSettings}
          onCancel={() => setEditor(null)}
          onSave={async (input) => {
            const key = JSON.stringify(input);
            if (editor === "new" && creationRequest.current?.key !== key)
              creationRequest.current = { key, id: crypto.randomUUID() };
            const result = await mutate(
              editor === "edit" ? "update" : "create",
              {
                ...input,
                ...(editor === "edit"
                  ? { task_id: selectedId }
                  : { request_id: creationRequest.current!.id }),
              },
            );
            if (!result) return;
            const id =
              editor === "edit"
                ? selectedId
                : result.tasks?.find(
                    (item) =>
                      !tasks.some((previous) => previous.id === item.id),
                  )?.id;
            select(id ?? null);
          }}
        />
      ) : !selectedId ? (
        <>
          <div className="assistant-section-heading">
            <h3>Tasks</h3>
            <button
              type="button"
              className="ghost"
              disabled={!connected || snapshot.tasks === undefined}
              onClick={() => {
                creationRequest.current = null;
                setEditor("new");
              }}
            >
              <Plus size={13} /> New task
            </button>
          </div>
          <p className="assistant-hint">
            Runs continue in the background. Open a task to see its history and
            results.
          </p>
          {tasks.some((item) => item.status === "cancelled") ? (
            <label className="assistant-task-filter">
              <button
                type="button"
                role="switch"
                aria-label="Show cancelled"
                aria-checked={showCancelled}
                className={`settings-switch${showCancelled ? " is-on" : ""}`}
                onClick={() => setShowCancelled((current) => !current)}
              >
                <span />
              </button>
              Show cancelled
            </label>
          ) : null}
          {visibleTasks.length ? (
            <ul className="assistant-task-list">
              {visibleTasks.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="assistant-task-row"
                    onClick={() => select(item.id)}
                  >
                    <div>
                      <strong>{item.title}</strong>
                      <span
                        className={`assistant-task-state is-${item.status}`}
                      >
                        {item.status}
                      </span>
                    </div>
                    <span>{taskScheduleLabel(item.schedule)}</span>
                    <small>
                      {item.current_run
                        ? `Current: ${item.current_run.status}`
                        : item.last_run
                          ? `Last: ${item.last_run.status}`
                          : "No runs yet"}
                    </small>
                    <small>
                      {item.next_run_at
                        ? `Next: ${formatUiDateTime(item.next_run_at)}`
                        : "No upcoming run"}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="assistant-panel-empty">
              <strong>
                {snapshot.tasks === undefined
                  ? "Update the bridge to use tasks"
                  : tasks.length
                    ? "No active tasks"
                    : "No tasks yet"}
              </strong>
              <span>
                Create a task for a one-time or recurring workspace check.
              </span>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="assistant-section-heading">
            <button
              type="button"
              className="ghost"
              onClick={() => select(null)}
            >
              <ChevronLeft size={13} /> All tasks
            </button>
            {task ? (
              <button
                type="button"
                className="ghost"
                disabled={busy || !connected || task.status === "cancelled"}
                onClick={() => setEditor("edit")}
              >
                Edit
              </button>
            ) : null}
          </div>
          {task ? (
            <>
              <section
                className="assistant-task-overview"
                aria-label="Task overview"
              >
                <div className="assistant-task-heading">
                  <h3>{task.title}</h3>
                  <span className={`assistant-task-state is-${task.status}`}>
                    {task.status}
                  </span>
                </div>
                <dl className="assistant-task-schedule">
                  <div>
                    <dt>Schedule</dt>
                    <dd>{taskScheduleLabel(task.schedule)}</dd>
                  </div>
                  <div>
                    <dt>Next run</dt>
                    <dd>
                      {task.next_run_at
                        ? formatUiDateTime(task.next_run_at)
                        : "No upcoming run"}
                    </dd>
                  </div>
                </dl>
                <div className="assistant-task-buttons">
                  <button
                    type="button"
                    className="assistant-task-primary"
                    disabled={
                      busy ||
                      !connected ||
                      task.status === "cancelled" ||
                      liveRun(task.current_run?.status)
                    }
                    onClick={() => void mutate("run_now", { task_id: task.id })}
                  >
                    Run now
                  </button>
                  {task.status !== "cancelled" ? (
                    <>
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy || !connected}
                        onClick={() =>
                          void mutate(
                            task.status === "paused" ? "resume" : "pause",
                            { task_id: task.id },
                          )
                        }
                      >
                        {task.status === "paused" ? "Resume" : "Pause"}
                      </button>
                      <button
                        type="button"
                        className="ghost danger-text"
                        disabled={busy || !connected}
                        onClick={() => setConfirmation("cancel")}
                      >
                        Cancel task
                      </button>
                    </>
                  ) : null}
                  {task.status === "cancelled" && !task.current_run ? (
                    <button
                      type="button"
                      className="ghost danger-text"
                      disabled={busy || !connected}
                      onClick={() => setConfirmation("delete")}
                    >
                      Delete task
                    </button>
                  ) : null}
                  {liveRun(task.current_run?.status) ? (
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy || !connected}
                      onClick={() => void mutate("stop", { task_id: task.id })}
                    >
                      Stop run
                    </button>
                  ) : null}
                </div>
              </section>
              <section
                className="assistant-task-details"
                aria-label="Task details"
              >
                <details className="assistant-task-prompt" open>
                  <summary>Task prompt</summary>
                  <p>{task.prompt}</p>
                </details>
                <dl className="assistant-task-metadata">
                  <div>
                    <dt>Workspaces</dt>
                    <dd>
                      {task.all_workspaces ? (
                        <p className="assistant-hint">
                          All, new ones too. As of the last run:
                        </p>
                      ) : null}
                      <ul className="assistant-task-workspaces">
                        {task.workspaces.map((ref) => (
                          <li key={workspaceKey(ref)}>
                            <span>{ref.connection_label} / </span>
                            {ref.label}
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                  <div>
                    <dt>Model</dt>
                    <dd>{task.model.id}</dd>
                  </div>
                  <div>
                    <dt>Permissions</dt>
                    <dd>
                      {task.approval_mode === "auto"
                        ? snapshot.config.approval_mode === "auto"
                          ? "High permission: supported operations execute automatically"
                          : "High permission saved; global mode is off, so operations need confirmation"
                        : "Manual permission: operations need confirmation"}
                    </dd>
                  </div>
                  <div>
                    <dt>Notifications</dt>
                    <dd>
                      {task.notification_mode === "agent"
                        ? "Ranger decides when to notify"
                        : "Notify when each run finishes"}
                    </dd>
                  </div>
                </dl>
              </section>
            </>
          ) : null}
          {loading && (!detail || (runId && !selectedRun)) ? (
            <p className="assistant-hint" role="status">
              <LoaderCircle size={13} className="assistant-spinner" /> Loading
              {runId ? " run history" : " task history"}
            </p>
          ) : null}
          {detail ? (
            <section
              className="assistant-task-history"
              aria-label="Run history"
            >
              <h4>Run history</h4>
              {detail.runs.length ? (
                <ThemedSelect
                  aria-label="Task run"
                  value={runId ?? selectedRun?.id ?? ""}
                  options={detail.runs.map((run) => ({
                    value: run.id,
                    label: `${formatUiDateTime(run.scheduled_at)} / ${run.status}`,
                  }))}
                  onChange={(id) => {
                    if (id === runId) return;
                    setRunId(id);
                    setDetail({ ...detail, run: undefined });
                  }}
                />
              ) : (
                <p className="assistant-task-history-empty">No runs yet.</p>
              )}
              {selectedRun ? (
                <div
                  className="assistant-task-run"
                  aria-label="Task run output"
                  aria-busy={liveRun(selectedRun.status)}
                >
                  <div className="assistant-task-run-status" role="status">
                    Run {selectedRun.status}
                    {selectedRun.started_at
                      ? ` / Started ${formatUiDateTime(selectedRun.started_at)}`
                      : ""}
                  </div>
                  {selectedRun.notice ? (
                    <p className="assistant-hint">{selectedRun.notice}</p>
                  ) : null}
                  {selectedRun.error ? (
                    <p className="assistant-task-error" role="alert">
                      {selectedRun.error}
                    </p>
                  ) : null}
                  {selectedRun.messages.map((message) => (
                    <section
                      className={`assistant-message is-${message.role}`}
                      key={message.id}
                      aria-label={`${message.role === "assistant" ? "Ranger" : "Task"} message`}
                    >
                      <div className="assistant-message-head">
                        <strong>
                          {message.role === "assistant"
                            ? "Ranger"
                            : "Task prompt"}
                        </strong>
                        <time dateTime={message.sent_at}>
                          {formatUiDateTime(message.sent_at)}
                        </time>
                      </div>
                      {message.role === "assistant" &&
                      message.thinking?.length ? (
                        <AssistantThinking
                          message={message}
                          active={
                            !message.text &&
                            selectedRun.status === "running" &&
                            message ===
                              selectedRun.messages[
                                selectedRun.messages.length - 1
                              ]
                          }
                        />
                      ) : null}
                      {message.role === "assistant" ? (
                        message.text ? (
                          <MarkdownPreview
                            text={message.text}
                            className="assistant-markdown"
                            breaks
                            imageUrlResolver={() => null}
                          />
                        ) : liveRun(selectedRun.status) ? (
                          // The open reasoning block already reports progress.
                          selectedRun.status === "running" &&
                          message.thinking?.length ? null : (
                            <span className="assistant-hint">Working...</span>
                          )
                        ) : (
                          <span className="assistant-hint">
                            No response text was received.
                          </span>
                        )
                      ) : (
                        <p className="assistant-user-text">{message.text}</p>
                      )}
                      {message.actions?.map((action) => (
                        <ActionCard
                          key={action.id}
                          action={action}
                          busy={busy || !connected}
                          running={runBusy}
                          run={async (name, params) =>
                            !!(await mutate(name, {
                              ...params,
                              task_id: detail.task.id,
                              run_id: selectedRun.id,
                            }))
                          }
                        />
                      ))}
                      {message.task_proposals?.map((proposal) => (
                        <TaskProposalCard
                          key={proposal.id}
                          proposal={proposal}
                          busy={busy || !connected}
                          run={async (name, params) =>
                            !!(await mutate(
                              name.replace(/^task\./, ""),
                              params ?? {},
                            ))
                          }
                        />
                      ))}
                      {message.tools.length || message.sources.length ? (
                        <AssistantMessageActivity
                          message={message}
                          running={
                            selectedRun.status === "running" &&
                            message ===
                              selectedRun.messages[
                                selectedRun.messages.length - 1
                              ]
                          }
                          onOpenSource={onOpenSource}
                        />
                      ) : null}
                    </section>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
          <ConfirmDialog
            open={active && confirmation !== null}
            title={
              confirmation === "delete"
                ? "Delete this task?"
                : "Cancel this task?"
            }
            message={
              confirmation === "delete"
                ? "Permanently delete this task and all of its run history."
                : "Stop its current run and cancel future runs. Run history will stay available."
            }
            confirmLabel={
              confirmation === "delete" ? "Delete task" : "Cancel task"
            }
            danger
            onClose={() => setConfirmation(null)}
            onConfirm={() => {
              const action = confirmation;
              setConfirmation(null);
              if (task && action)
                void (async () => {
                  const result = await mutate(action, { task_id: task.id });
                  if (result && action === "delete") select(null);
                })();
            }}
          />
        </>
      )}
    </div>
  );
}
