import { useState } from "react";
import type { WorldSourceStatus } from "../../../shared/worldSources";
import { ThemedSelect } from "../components/ThemedSelect";
import { updateWorldSource } from "./worldSources";

const MERGED_WINDOWS = [1, 3, 7, 14, 30, 90];

/** The offered windows, plus a saved one that is not among them. */
const mergedWindows = (current: number) =>
  MERGED_WINDOWS.includes(current)
    ? MERGED_WINDOWS
    : [...MERGED_WINDOWS, current].sort((a, b) => a - b);

/** Runs one save and reports its outcome in the Integrations screen. */
export type RunIntegrationTask = (
  key: string,
  task: () => Promise<unknown>,
  done: string,
) => Promise<boolean>;

export function GitHubSourceFields({
  source,
  busy,
  run,
}: {
  source: WorldSourceStatus;
  busy: boolean;
  run: RunIntegrationTask;
}) {
  if (source.config.kind !== "github") return null;
  return (
    <div className="integration-fields">
      <p className="integration-field-help">
        Uses the GitHub CLI signed in as the user that runs World: pull requests
        you opened, were asked to review or are assigned, every one you opened
        that was merged in the window below, and issues assigned to you. Each
        agent's desk shows the pull request for its branch.
      </p>
      <label className="form-field">
        <span>Merged pull requests</span>
        <ThemedSelect
          aria-label="Merged pull requests"
          value={String(source.config.mergedDays)}
          disabled={busy}
          options={mergedWindows(source.config.mergedDays).map((days) => ({
            value: String(days),
            label: days === 1 ? "Last day" : `Last ${days} days`,
          }))}
          onChange={(value) => {
            const mergedDays = Number(value);
            void run(
              "source:github",
              () => updateWorldSource("github", { mergedDays }),
              "GitHub settings saved.",
            );
          }}
        />
      </label>
    </div>
  );
}

/**
 * Jira's site, account and filter, with its API token. The token is
 * write-only: World keeps it in its vault and never shows it again. Saving
 * switches Jira on.
 */
export function JiraSourceFields({
  source,
  busy,
  run,
}: {
  source: WorldSourceStatus;
  busy: boolean;
  run: RunIntegrationTask;
}) {
  const config = source.config.kind === "jira" ? source.config : null;
  const [jira, setJira] = useState(() => ({
    site: config?.site?.replace(/^https:\/\//u, "") ?? "",
    email: config?.email ?? "",
    jql: config?.jql ?? "",
    token: "",
  }));
  if (!config) return null;
  return (
    <form
      className="integration-fields"
      aria-label="Jira settings"
      onSubmit={(event) => {
        event.preventDefault();
        void run(
          "source:jira",
          async () => {
            await updateWorldSource("jira", {
              enabled: true,
              site: jira.site,
              email: jira.email,
              jql: jira.jql,
              ...(jira.token ? { token: jira.token } : {}),
            });
            setJira((value) => ({ ...value, token: "" }));
          },
          "Jira settings saved.",
        );
      }}
    >
      <label className="form-field">
        <span>Site</span>
        <input
          value={jira.site}
          placeholder="example.atlassian.net"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            const site = event.currentTarget.value;
            setJira((value) => ({ ...value, site }));
          }}
        />
      </label>
      <label className="form-field">
        <span>Account email</span>
        <input
          type="email"
          value={jira.email}
          placeholder="you@example.com"
          autoComplete="off"
          onChange={(event) => {
            const email = event.currentTarget.value;
            setJira((value) => ({ ...value, email }));
          }}
        />
      </label>
      <label className="form-field">
        <span>API token</span>
        <input
          type="password"
          value={jira.token}
          placeholder={
            config.tokenSet
              ? "Saved; type to replace"
              : "From id.atlassian.com, Security, API tokens"
          }
          autoComplete="new-password"
          onChange={(event) => {
            const token = event.currentTarget.value;
            setJira((value) => ({ ...value, token }));
          }}
        />
      </label>
      <label className="form-field">
        <span>Filter (JQL)</span>
        <textarea
          rows={3}
          value={jira.jql}
          spellCheck={false}
          onChange={(event) => {
            const jql = event.currentTarget.value;
            setJira((value) => ({ ...value, jql }));
          }}
        />
      </label>
      <p className="integration-field-help">
        Leave the filter empty for tickets assigned to you or that you watch.
        The token is kept in World's vault on the service and is never shown
        again.
      </p>
      <div className="modal-actions integration-field-actions">
        <button
          type="button"
          className="ghost"
          disabled={busy || !config.tokenSet}
          onClick={() =>
            void run(
              "source:jira",
              () => updateWorldSource("jira", { token: null }),
              "Jira API token removed.",
            )
          }
        >
          Remove token
        </button>
        <button type="submit" disabled={busy}>
          Save Jira
        </button>
      </div>
    </form>
  );
}
