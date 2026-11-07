import { ChevronLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  ASSISTANT_MAX_WORKSPACES,
  type AssistantTask,
  type AssistantTaskInput,
  type AssistantTaskSchedule,
  type AssistantWorkspace,
  type AssistantWorkspaceRef,
  isAssistantTaskInput,
} from "../../../shared/assistant";
import { ThemedSelect } from "./ThemedSelect";
import "./AssistantTasks.css";

export function workspaceKey(ref: AssistantWorkspaceRef) {
  return JSON.stringify([ref.connection_id, ref.workspace_id]);
}

export function localDateTime(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function TaskForm({
  active,
  task,
  workspaces,
  busy,
  ready,
  highPermission = false,
  allWorkspacesAllowed = false,
  onSave,
  onCancel,
  onOpenSettings,
}: {
  active: boolean;
  task?: AssistantTask;
  workspaces: AssistantWorkspace[];
  busy: boolean;
  ready: boolean;
  highPermission?: boolean;
  allWorkspacesAllowed?: boolean;
  onSave: (input: AssistantTaskInput) => Promise<void>;
  onCancel: () => void;
  onOpenSettings: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [prompt, setPrompt] = useState(task?.prompt ?? "");
  const [notificationMode, setNotificationMode] = useState<"status" | "agent">(
    task?.notification_mode ?? "status",
  );
  const [scope, setScope] = useState<AssistantWorkspaceRef[]>(
    task?.scope ?? [],
  );
  // Every workspace when it runs, new ones too: the list is then theirs.
  const [allWorkspaces, setAllWorkspaces] = useState(!!task?.all_workspaces);
  const [kind, setKind] = useState<AssistantTaskSchedule["type"]>(
    task?.schedule.type ?? "once",
  );
  const [at, setAt] = useState(
    localDateTime(
      task?.schedule.type === "once"
        ? task.schedule.at
        : new Date(Date.now() + 60_000).toISOString(),
    ),
  );
  const [minutes, setMinutes] = useState(
    task?.schedule.type === "interval" ? String(task.schedule.minutes) : "60",
  );
  const [time, setTime] = useState(
    task?.schedule.type === "daily" ? task.schedule.time : "09:00",
  );
  const [timezone, setTimezone] = useState(
    task?.schedule.type === "daily"
      ? task.schedule.timezone
      : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (active) nameRef.current?.focus({ preventScroll: true });
  }, [active]);
  const choices = workspaces;
  const everyChoice = choices
    .slice(0, ASSISTANT_MAX_WORKSPACES)
    .map(({ connection_id, workspace_id, runtime_generation }) => ({
      connection_id,
      workspace_id,
      runtime_generation,
    }));
  const unavailableScope = (allWorkspaces ? [] : scope).filter(
    (ref) =>
      !workspaces.some(
        (workspace) => workspaceKey(ref) === workspaceKey(workspace),
      ),
  );
  return (
    <form
      className="assistant-task-form"
      aria-label={task ? "Edit task" : "Create task"}
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || !ready || unavailableScope.length) return;
        const date = new Date(at);
        const schedule: AssistantTaskSchedule =
          kind === "once"
            ? {
                type: "once",
                at: Number.isFinite(date.getTime()) ? date.toISOString() : "",
              }
            : kind === "daily"
              ? { type: "daily", time, timezone: timezone.trim() }
              : { type: "interval", minutes: Number(minutes) };
        const chosen = allWorkspaces ? everyChoice : scope;
        const input = {
          title: title.trim(),
          prompt: prompt.trim(),
          scope: chosen.map((ref) => {
            const current = workspaces.find(
              (candidate) => workspaceKey(candidate) === workspaceKey(ref),
            );
            return {
              connection_id: ref.connection_id,
              workspace_id: ref.workspace_id,
              runtime_generation:
                current?.runtime_generation ?? ref.runtime_generation,
            };
          }),
          ...(allWorkspaces ? { all_workspaces: true as const } : {}),
          ...(task?.mentions
            ? {
                mentions: task.mentions.filter((mention) =>
                  chosen.some(
                    (ref) => workspaceKey(ref) === workspaceKey(mention),
                  ),
                ),
              }
            : {}),
          schedule,
          ...(notificationMode === "agent" ||
          task?.notification_mode !== undefined
            ? { notification_mode: notificationMode }
            : {}),
        };
        if (!isAssistantTaskInput(input)) {
          setError(
            "Enter a name, prompt, valid schedule and at least one workspace.",
          );
          return;
        }
        setError(null);
        await onSave(input);
      }}
    >
      <div className="assistant-section-heading">
        <h3>{task ? "Edit task" : "New task"}</h3>
        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={onCancel}
        >
          <ChevronLeft size={13} /> Back
        </button>
      </div>
      <p className="assistant-hint">
        Tasks run on the bridge in their own conversations. Saving uses the
        current permission mode:{" "}
        {highPermission
          ? "high permission. Supported workspace operations execute automatically while the global mode stays enabled."
          : "manual. Workspace operations need your confirmation."}
      </p>
      {!ready ? (
        <div className="assistant-setup-notice">
          <span>
            Connect a provider and choose a model before saving a task.
          </span>
          <button type="button" className="ghost" onClick={onOpenSettings}>
            Model settings
          </button>
        </div>
      ) : null}
      <fieldset disabled={busy}>
        <label className="form-field">
          <span>Name</span>
          <input
            ref={nameRef}
            aria-label="Task name"
            required
            maxLength={100}
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </label>
        <label className="form-field">
          <span>Prompt</span>
          <textarea
            aria-label="Task prompt"
            required
            rows={5}
            maxLength={32_000}
            value={prompt}
            onChange={(event) => setPrompt(event.currentTarget.value)}
          />
          {task?.mentions?.length ? (
            <small className="assistant-hint">
              References:{" "}
              {task.mentions
                .filter((mention) =>
                  scope.some(
                    (ref) => workspaceKey(ref) === workspaceKey(mention),
                  ),
                )
                .map(
                  (mention) => `${mention.label} (${mention.connection_label})`,
                )
                .join(", ") || "None in the selected workspaces"}
              .
            </small>
          ) : null}
        </label>
        <div className="form-field">
          <span>Notifications</span>
          <ThemedSelect
            aria-label="Task notifications"
            value={notificationMode}
            options={[
              { value: "status", label: "Notify when each run finishes" },
              { value: "agent", label: "Let Ranger decide" },
            ]}
            disabled={busy}
            onChange={(value) =>
              setNotificationMode(value as "status" | "agent")
            }
          />
          <small className="assistant-hint">
            Ranger can send a custom notice when needed. Let Ranger decide keeps
            routine checks quiet; failed runs and action confirmations still
            notify.
          </small>
        </div>
        <div className="form-field">
          <span>Schedule</span>
          <ThemedSelect
            aria-label="Task schedule"
            value={kind}
            options={[
              { value: "once", label: "Once" },
              { value: "daily", label: "Daily" },
              { value: "interval", label: "Interval" },
            ]}
            disabled={busy}
            onChange={(value) =>
              setKind(value as AssistantTaskSchedule["type"])
            }
          />
        </div>
        {kind === "once" ? (
          <label className="form-field">
            <span>Run at (your local time)</span>
            <input
              type="datetime-local"
              aria-label="Run at"
              required
              value={at}
              onChange={(event) => setAt(event.currentTarget.value)}
            />
          </label>
        ) : kind === "daily" ? (
          <>
            <label className="form-field">
              <span>Time</span>
              <input
                type="time"
                aria-label="Daily time"
                required
                value={time}
                onChange={(event) => setTime(event.currentTarget.value)}
              />
            </label>
            <label className="form-field">
              <span>Timezone</span>
              <input
                aria-label="Task timezone"
                required
                value={timezone}
                placeholder="Europe/London"
                onChange={(event) => setTimezone(event.currentTarget.value)}
              />
            </label>
          </>
        ) : (
          <label className="form-field">
            <span>Minutes between runs</span>
            <input
              type="number"
              aria-label="Interval minutes"
              required
              min={1}
              max={525600}
              step={1}
              value={minutes}
              onChange={(event) => setMinutes(event.currentTarget.value)}
            />
          </label>
        )}
        <fieldset className="assistant-task-scope">
          <legend>Workspaces</legend>
          {allWorkspacesAllowed ? (
            <p className="assistant-hint">
              All available workspaces are allowed. Choose the workspaces this
              task should use; its scope stays fixed when new workspaces appear,
              unless it covers all of them.
            </p>
          ) : null}
          {unavailableScope.length ? (
            <div className="assistant-setup-notice" role="alert">
              <span>
                {unavailableScope.length} selected workspace
                {unavailableScope.length === 1 ? " is" : "s are"} unavailable or
                no longer allowed. The saved scope is unchanged. Reconnect or
                refresh workspace settings, or remove these selections before
                saving.
              </span>
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  setScope(
                    scope.filter((ref) => !unavailableScope.includes(ref)),
                  )
                }
              >
                Remove unavailable selections
              </button>
            </div>
          ) : null}
          <label className="assistant-workspace-all">
            <input
              type="checkbox"
              checked={allWorkspaces}
              onChange={(event) =>
                setAllWorkspaces(event.currentTarget.checked)
              }
            />
            <span>
              All workspaces, new ones too
              <small>
                Each run covers every workspace Ranger may use at that time.
              </small>
            </span>
          </label>
          {allWorkspaces ? null : (
            <div className="assistant-workspace-bulk">
              <button
                type="button"
                className="ghost"
                disabled={!choices.length}
                onClick={() => setScope(everyChoice)}
              >
                Select all
              </button>
              <button
                type="button"
                className="ghost"
                disabled={!scope.length}
                onClick={() => setScope([])}
              >
                Clear
              </button>
            </div>
          )}
          <div
            className={`assistant-workspaces${allWorkspaces ? " is-all" : ""}`}
          >
            {choices.map((workspace) => {
              const checked =
                allWorkspaces ||
                scope.some(
                  (ref) => workspaceKey(ref) === workspaceKey(workspace),
                );
              return (
                <label
                  key={workspaceKey(workspace)}
                  className="assistant-workspace-choice"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={
                      allWorkspaces ||
                      (!checked && scope.length >= ASSISTANT_MAX_WORKSPACES)
                    }
                    onChange={() =>
                      setScope(
                        checked
                          ? scope.filter(
                              (ref) =>
                                workspaceKey(ref) !== workspaceKey(workspace),
                            )
                          : [
                              ...scope,
                              {
                                connection_id: workspace.connection_id,
                                workspace_id: workspace.workspace_id,
                                runtime_generation:
                                  workspace.runtime_generation,
                              },
                            ],
                      )
                    }
                  />
                  <span>
                    {workspace.label}
                    <small>{workspace.connection_label}</small>
                  </span>
                </label>
              );
            })}
            {!choices.length ? (
              <span className="assistant-hint">
                {allWorkspacesAllowed
                  ? "No connected workspaces available. Reconnect or refresh in Ranger settings."
                  : "Allow connected workspaces in Ranger settings first."}
              </span>
            ) : null}
          </div>
        </fieldset>
      </fieldset>
      {error ? (
        <p className="assistant-task-error" role="alert">
          {error}
        </p>
      ) : null}
      {task?.status === "paused" ? (
        <p className="assistant-hint">
          This task will stay paused after saving.
        </p>
      ) : null}
      <div className="assistant-task-buttons">
        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={
            busy ||
            !ready ||
            !title.trim() ||
            !prompt.trim() ||
            !(allWorkspaces ? everyChoice : scope).length ||
            !!unavailableScope.length
          }
        >
          {task ? "Save changes" : "Save and enable"}
        </button>
      </div>
    </form>
  );
}
