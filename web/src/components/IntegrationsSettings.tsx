import {
  CircleCheck,
  CircleDashed,
  CircleOff,
  KeyRound,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { bridge } from "../api";
import {
  fetchIntegrations,
  INTEGRATION_PROVISION_LABELS,
  INTEGRATION_STATE_LABELS,
  type IntegrationEntry,
  integrationsChanged,
  useIntegrations,
} from "../integrations";
import {
  GitHubSourceFields,
  JiraSourceFields,
  type RunIntegrationTask,
} from "../world/SourceFields";
import {
  saveUsageMetrics,
  UsageMetricsFields,
} from "../world/UsageMetricsFields";
import {
  updateWorldSource,
  useWorldSources,
  worldSourcesStore,
} from "../world/worldSources";
import { ConnectionManagerDialog } from "./ConnectionSwitcher";
import "./IntegrationsSettings.css";

type Action = {
  label: string;
  /** Opens the row's settings instead of acting. */
  opens?: true;
  run?: () => Promise<unknown>;
  done?: string;
};

function StateIcon({ state }: { state: IntegrationEntry["state"] }) {
  if (state === "connected")
    return <CircleCheck size={14} aria-hidden="true" />;
  if (state === "error") return <TriangleAlert size={14} aria-hidden="true" />;
  if (state === "available")
    return <CircleDashed size={14} aria-hidden="true" />;
  return <CircleOff size={14} aria-hidden="true" />;
}

function IntegrationRow({
  entry,
  action,
  busy,
  onAction,
  expanded,
  onToggleSettings,
  children,
}: {
  entry: IntegrationEntry;
  action: Action | null;
  busy: boolean;
  onAction(action: Action): void;
  expanded: boolean;
  onToggleSettings?: () => void;
  children?: ReactNode;
}) {
  const provides = entry.provides
    .map((provision) => INTEGRATION_PROVISION_LABELS[provision])
    .join(", ");
  return (
    <li
      className="integration-row"
      data-integration={entry.id}
      data-state={entry.state}
      aria-label={entry.label}
    >
      <div className="integration-row-head">
        <span className="integration-row-title">
          <strong>{entry.label}</strong>
          <span className="integration-state" data-state={entry.state}>
            <StateIcon state={entry.state} />
            {INTEGRATION_STATE_LABELS[entry.state]}
          </span>
        </span>
        <span className="integration-row-actions">
          {onToggleSettings ? (
            <button
              type="button"
              className="ghost"
              aria-expanded={expanded}
              aria-label={`${entry.label} settings`}
              onClick={onToggleSettings}
            >
              Settings
            </button>
          ) : null}
          {action ? (
            <button
              type="button"
              disabled={busy}
              aria-label={`${action.label} ${entry.label}`}
              onClick={() => onAction(action)}
            >
              {action.label}
            </button>
          ) : null}
        </span>
      </div>
      <p className="integration-row-detail">{entry.detail}</p>
      {provides ? (
        <p className="integration-row-provides">Gives World {provides}.</p>
      ) : null}
      {expanded ? children : null}
    </li>
  );
}

function runtimeAction(entry: IntegrationEntry): Action | null {
  const connection = entry.connection;
  if (!connection) return null;
  const { lifecycle } = connection;
  if (lifecycle === "disconnected" || lifecycle === "error")
    return {
      label: "Connect",
      run: () => bridge.call("connections.connect", { id: connection.id }),
      done: `Connecting ${entry.label}.`,
    };
  if (lifecycle === "stopping") return null;
  return {
    label: "Disconnect",
    run: () => bridge.call("connections.disconnect", { id: connection.id }),
    done: `${entry.label} disconnected.`,
  };
}

/**
 * Configuration → Integrations: every runtime, source and agent World can
 * use, with its status and one Connect or Disconnect. Each row acts through
 * the owner that already holds it (connection verbs, source settings, the
 * metrics connector, World's skill installer); this screen holds no state of
 * its own beyond what is open. `agents` is the harness section, which keeps
 * its per-host install flow.
 */
export function IntegrationsSettings({
  focus,
  agents,
}: {
  focus?: string;
  agents: ReactNode;
}) {
  const { snapshot, error: listError, refresh } = useIntegrations();
  const sources = useWorldSources();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(focus ? [focus] : []),
  );
  const [hostsOpen, setHostsOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const focused = useRef(false);

  useEffect(() => {
    void worldSourcesStore.refresh();
  }, []);

  useEffect(() => {
    if (!focus || focused.current || !snapshot) return;
    focused.current = true;
    root.current
      ?.querySelector<HTMLElement>(`[data-integration="${CSS.escape(focus)}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [focus, snapshot]);

  const toggle = useCallback((id: string, value?: boolean) => {
    setOpen((current) => {
      const next = new Set(current);
      if (value ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const run: RunIntegrationTask = useCallback(
    async (key, task, done) => {
      setBusy(key);
      setError(null);
      setMessage(null);
      try {
        await task();
        setMessage(done);
        return true;
      } catch (cause) {
        setError(
          cause instanceof Error && cause.message
            ? cause.message
            : "World could not change this integration",
        );
        return false;
      } finally {
        setBusy(null);
        integrationsChanged();
        void refresh();
      }
    },
    [refresh],
  );

  const act = (entry: IntegrationEntry, action: Action) => {
    if (action.opens) {
      toggle(entry.id, true);
      return;
    }
    if (!action.run) return;
    const task = action.run;
    void run(
      entry.id,
      async () => {
        // A runtime row acts on the exact connection it showed. If that
        // connection was replaced since, show the new one instead of acting.
        if (entry.connection) {
          const current = (await fetchIntegrations()).integrations.find(
            (other) => other.id === entry.id,
          );
          if (current?.connection?.generation !== entry.connection.generation)
            throw new Error(
              `${entry.label} changed since this list was read. Check it again.`,
            );
        }
        await task();
      },
      action.done ?? "Saved.",
    );
  };

  const sourceStatus = (type: string) =>
    sources.sources.find((source) => source.id === type);

  const sourceAction = (entry: IntegrationEntry): Action | null => {
    if (entry.control === "metrics")
      return entry.state === "needs_connect"
        ? { label: "Connect", opens: true }
        : {
            label: "Disconnect",
            run: () => saveUsageMetrics(null),
            done: "Usage metrics off.",
          };
    const status = sourceStatus(entry.type);
    if (!status) return null;
    if (status.enabled)
      return {
        label: "Disconnect",
        run: () => updateWorldSource(status.id, { enabled: false }),
        done: `${status.label} switched off.`,
      };
    if (entry.state === "needs_connect")
      return { label: "Connect", opens: true };
    return {
      label: "Connect",
      run: () => updateWorldSource(status.id, { enabled: true }),
      done: `${status.label} switched on.`,
    };
  };

  const sourceFields = (entry: IntegrationEntry) => {
    const pending = busy !== null;
    if (entry.control === "metrics")
      return (
        <UsageMetricsFields
          busy={pending}
          run={run}
          autoFocus={entry.id === focus}
        />
      );
    const status = sourceStatus(entry.type);
    if (!status) return null;
    return status.id === "github" ? (
      <GitHubSourceFields source={status} busy={pending} run={run} />
    ) : (
      <JiraSourceFields source={status} busy={pending} run={run} />
    );
  };

  const rows = snapshot?.integrations ?? [];
  const runtimes = rows.filter((entry) => entry.kind === "runtime");
  const sourceRows = rows.filter((entry) => entry.kind === "source");
  const editors = rows.filter((entry) => entry.kind === "ide");

  return (
    <div ref={root} className="integrations-settings">
      <p className="integrations-intro">
        What World reads from and works through. Nothing here is required: each
        one adds to what World shows, and the World service makes every request;
        the browser never contacts these services.
      </p>
      {listError ? (
        <p className="modal-error" role="alert">
          {listError}
        </p>
      ) : null}
      {!snapshot && !listError ? (
        <p className="settings-helper">Checking integrations…</p>
      ) : null}

      {snapshot ? (
        <section className="integrations-group" aria-label="Runtimes">
          <h3>Runtimes</h3>
          <p className="settings-helper">
            Herdr and herdr-core give World its terminals, agents and files.
          </p>
          {runtimes.length ? (
            <ul className="integrations-list">
              {runtimes.map((entry) => (
                <IntegrationRow
                  key={entry.id}
                  entry={entry}
                  action={runtimeAction(entry)}
                  busy={busy !== null}
                  onAction={(action) => act(entry, action)}
                  expanded={false}
                />
              ))}
            </ul>
          ) : (
            <p className="integrations-empty">
              No runtime yet. Add this computer or an SSH host to see terminals
              and agents.
            </p>
          )}
          <button
            type="button"
            className="ghost integrations-hosts"
            onClick={() => setHostsOpen(true)}
          >
            Add or edit hosts…
          </button>
        </section>
      ) : null}

      {snapshot ? (
        <section className="integrations-group" aria-label="Sources">
          <h3>Sources</h3>
          <p className="settings-helper">
            Pull requests, tickets and usage beside your agents, on Board's Work
            lens and Town.
          </p>
          <ul className="integrations-list">
            {sourceRows.map((entry) => (
              <IntegrationRow
                key={entry.id}
                entry={entry}
                action={sourceAction(entry)}
                busy={busy !== null}
                onAction={(action) => act(entry, action)}
                expanded={open.has(entry.id)}
                onToggleSettings={() => toggle(entry.id)}
              >
                {sourceFields(entry)}
              </IntegrationRow>
            ))}
          </ul>
          <button
            type="button"
            className="ghost"
            disabled={busy !== null}
            onClick={() =>
              void run(
                "refresh",
                () => worldSourcesStore.refresh(true),
                "Sources refreshed.",
              )
            }
          >
            <RefreshCw size={14} aria-hidden="true" /> Refresh Sources
          </button>
        </section>
      ) : null}

      {error ? (
        <p className="modal-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="modal-message" role="status">
          {message}
        </p>
      ) : null}

      <section className="integrations-group" aria-label="Agents">
        <h3>Agents</h3>
        {agents}
      </section>

      {editors.length ? (
        <section className="integrations-group" aria-label="Editors">
          <h3>Editors</h3>
          <ul className="integrations-list">
            {editors.map((entry) => (
              <IntegrationRow
                key={entry.id}
                entry={entry}
                action={null}
                busy={busy !== null}
                onAction={() => undefined}
                expanded={false}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {snapshot ? (
        <section className="integrations-group" aria-label="Vault">
          <h3>
            <KeyRound size={14} aria-hidden="true" /> Vault
          </h3>
          <p className="settings-helper">
            {snapshot.vault.label}. {snapshot.vault.detail}
          </p>
          <p className="integrations-vault-secrets">
            {snapshot.vault.secrets.length
              ? `Holds: ${snapshot.vault.secrets.map((secret) => secret.label).join(", ")}.`
              : "Holds no tokens."}
          </p>
        </section>
      ) : null}

      {hostsOpen
        ? createPortal(
            <ConnectionManagerDialog
              onClose={() => {
                setHostsOpen(false);
                void refresh();
              }}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
