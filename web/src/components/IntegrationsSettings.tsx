import {
  CircleCheck,
  CircleDashed,
  CircleOff,
  KeyRound,
  RefreshCw,
  Search,
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
  INTEGRATION_KIND_LABELS,
  INTEGRATION_KINDS,
  INTEGRATION_PROVISION_LABELS,
  INTEGRATION_STATE_LABELS,
  type IntegrationEntry,
  type IntegrationKind,
  integrationMatches,
  integrationsChanged,
  searchTerms,
  useIntegrations,
} from "../integrations";
import { withIntegrationsFixture } from "../integrationsFixture";
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

/**
 * One tab per kind the registry reports, in the registry's order; a kind
 * with no rows has no tab unless it is `always` shown. A new kind needs only
 * its label in the shared registry: it gets a tab, a count and the generic
 * row list. These entries add help, empty text or a panel of its own.
 */
const PANELS: Partial<
  Record<
    IntegrationKind,
    { help?: string; empty?: string; always?: true; custom?: true }
  >
> = {
  runtime: {
    always: true,
    help: "Herdr and herdr-core give World its terminals, agents and files.",
    empty:
      "No runtime yet. Add this computer or an SSH host to see terminals and agents.",
  },
  source: {
    help: "Pull requests, tickets and usage beside your agents, on Board's Work lens and Town.",
  },
  // Agents keep their per-host install flow (the host picked in Connection).
  harness: { always: true, custom: true },
  ide: { help: "Editors World opens files and folders in." },
};

/** The tab a focused row sits in: `source:github` is in Sources. */
/** The tab last opened on this page: Integrations reopens where it was. */
let lastKind: IntegrationKind | null = null;

function kindOf(focus: string | undefined): IntegrationKind | null {
  const prefix = focus?.split(":", 1)[0];
  return INTEGRATION_KINDS.find((kind) => kind === prefix) ?? null;
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
 * use, one tab per kind, with its status and one Connect or Disconnect. The
 * search box narrows every tab at once and each tab counts its matches, so a
 * list of dozens stays usable on a phone. Each row acts through
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
  /** The Agents tab; `query` is the search box, for its own list. */
  agents: (query: string) => ReactNode;
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
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<IntegrationKind>(
    () => kindOf(focus) ?? lastKind ?? INTEGRATION_KINDS[0],
  );
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

  const rows = snapshot ? withIntegrationsFixture(snapshot.integrations) : [];
  const terms = searchTerms(query);
  const matching = rows.filter((entry) => integrationMatches(entry, terms));
  const kinds = INTEGRATION_KINDS.filter(
    (kind) => PANELS[kind]?.always || rows.some((entry) => entry.kind === kind),
  );
  const active = kinds.includes(kind) ? kind : kinds[0];
  const panel = PANELS[active] ?? {};
  const listed = matching.filter((entry) => entry.kind === active);
  const count = (of: IntegrationKind) =>
    PANELS[of]?.custom
      ? null
      : matching.filter((entry) => entry.kind === of).length;
  const elsewhere = kinds.filter(
    (other) => other !== active && terms.length && count(other),
  );
  const select = (next: IntegrationKind, focusTab = false) => {
    setKind(next);
    lastKind = next;
    const tab = root.current?.querySelector<HTMLElement>(
      `[role="tab"][data-kind="${next}"]`,
    );
    tab?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    if (focusTab) tab?.focus();
  };

  const rowFor = (entry: IntegrationEntry) => {
    const settingsFor = entry.kind === "source" && entry.control !== "none";
    return (
      <IntegrationRow
        key={entry.id}
        entry={entry}
        action={
          entry.kind === "runtime"
            ? runtimeAction(entry)
            : settingsFor
              ? sourceAction(entry)
              : null
        }
        busy={busy !== null}
        onAction={(action) => act(entry, action)}
        expanded={settingsFor && open.has(entry.id)}
        onToggleSettings={settingsFor ? () => toggle(entry.id) : undefined}
      >
        {settingsFor ? sourceFields(entry) : null}
      </IntegrationRow>
    );
  };

  const kindLabel = INTEGRATION_KIND_LABELS[active];
  let body: ReactNode;
  if (active === "harness") body = agents(query);
  else if (!snapshot)
    body = listError ? null : (
      <p className="settings-helper">Checking integrations…</p>
    );
  else if (listed.length)
    body = <ul className="integrations-list">{listed.map(rowFor)}</ul>;
  else if (terms.length)
    body = (
      <div className="integrations-empty" role="status">
        <p>
          No {kindLabel.toLowerCase()} match “{query.trim()}”.
          {elsewhere.length ? " Found in:" : ""}
        </p>
        <span className="integrations-empty-actions">
          {elsewhere.map((other) => (
            <button
              key={other}
              type="button"
              className="ghost"
              onClick={() => select(other)}
            >
              {INTEGRATION_KIND_LABELS[other]} ({count(other)})
            </button>
          ))}
          <button type="button" className="ghost" onClick={() => setQuery("")}>
            Clear search
          </button>
        </span>
      </div>
    );
  else
    body = (
      <p className="integrations-empty">
        {panel.empty ?? `No ${kindLabel.toLowerCase()} yet.`}
      </p>
    );

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
      <label className="integrations-search">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          value={query}
          aria-label="Search integrations"
          placeholder="Search by name, status or what it gives"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div
        className="integrations-tabs"
        role="tablist"
        aria-label="Kinds of integration"
      >
        {kinds.map((each, index) => {
          const n = count(each);
          const failing = rows.some(
            (entry) => entry.kind === each && entry.state === "error",
          );
          const label = INTEGRATION_KIND_LABELS[each];
          return (
            <button
              key={each}
              type="button"
              role="tab"
              data-kind={each}
              id={`integrations-tab-${each}`}
              aria-controls="integrations-panel"
              aria-selected={each === active}
              aria-label={
                n === null
                  ? label
                  : `${label}, ${n}${terms.length ? " matching" : ""}${failing ? ", has errors" : ""}`
              }
              tabIndex={each === active ? 0 : -1}
              onClick={() => select(each)}
              onKeyDown={(event) => {
                const next =
                  event.key === "ArrowRight"
                    ? (index + 1) % kinds.length
                    : event.key === "ArrowLeft"
                      ? (index + kinds.length - 1) % kinds.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? kinds.length - 1
                          : null;
                if (next === null) return;
                event.preventDefault();
                select(kinds[next], true);
              }}
            >
              {label}
              {n === null ? null : (
                <span className="integrations-tab-count" aria-hidden="true">
                  {n}
                </span>
              )}
              {failing ? (
                <TriangleAlert
                  className="integrations-tab-alert"
                  size={12}
                  aria-hidden="true"
                />
              ) : null}
            </button>
          );
        })}
      </div>
      <section
        className="integrations-group"
        role="tabpanel"
        id="integrations-panel"
        aria-labelledby={`integrations-tab-${active}`}
        data-kind={active}
      >
        {panel.help ? <p className="settings-helper">{panel.help}</p> : null}
        {body}
        {active === "runtime" ? (
          <button
            type="button"
            className="ghost integrations-hosts"
            onClick={() => setHostsOpen(true)}
          >
            Add or edit hosts…
          </button>
        ) : null}
        {active === "source" && snapshot ? (
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
        ) : null}
      </section>

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

      {snapshot ? (
        <section className="integrations-vault" aria-label="Vault">
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
