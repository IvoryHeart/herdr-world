import githubIcon from "@lobehub/icons-static-svg/icons/github.svg?raw";
import {
  Bot,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Gauge,
  Inbox,
  KeyRound,
  LayoutGrid,
  type LucideIcon,
  RefreshCw,
  Search,
  Server,
  Settings2,
  SquareCode,
  SquareTerminal,
  Ticket,
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
  matchesTerms,
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
import {
  WeatherConsent,
  WeatherSourceSettings,
} from "../world/WeatherSourceSettings";
import type { AgentMatches } from "./AgentIntegrationsSettings";
import { ConnectionManagerDialog } from "./ConnectionSwitcher";
import { RuntimeHosts } from "./IntegrationsHosts";
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
    return <CircleCheck size={12} aria-hidden="true" />;
  if (state === "error") return <TriangleAlert size={12} aria-hidden="true" />;
  if (state === "available")
    return <CircleDashed size={12} aria-hidden="true" />;
  return <CircleAlert size={12} aria-hidden="true" />;
}

/** Each kind's icon: on its tab, its heading in All and rows without a mark. */
const KIND_ICONS: Record<IntegrationKind, LucideIcon> = {
  runtime: SquareTerminal,
  source: Inbox,
  harness: Bot,
  ide: SquareCode,
};

function TabIcon({ tab }: { tab: Tab }) {
  const Icon =
    tab === "all" ? LayoutGrid : tab === "vault" ? KeyRound : KIND_ICONS[tab];
  return <Icon size={14} aria-hidden="true" />;
}

/**
 * The product's own mark where World ships one (Herdr, GitHub); otherwise a
 * plain symbol for what it is (tickets, usage), then the kind's icon. An
 * unknown type never borrows another product's mark.
 */
function IntegrationIcon({ entry }: { entry: IntegrationEntry }) {
  let mark: ReactNode;
  if (
    entry.kind === "runtime" &&
    (entry.type === "herdr" || entry.type === "herdr-core")
  )
    mark = <img src="/herdr-icon.png" alt="" width={26} height={26} />;
  else if (entry.kind === "source" && entry.type === "github")
    mark = (
      <span
        className="integration-icon-svg"
        // A bundled brand mark, not data from the service.
        dangerouslySetInnerHTML={{ __html: githubIcon }}
      />
    );
  else {
    const Icon =
      entry.kind === "source" && entry.type === "jira"
        ? Ticket
        : entry.control === "metrics"
          ? Gauge
          : entry.kind === "runtime" && entry.connection?.transport === "ssh"
            ? Server
            : KIND_ICONS[entry.kind];
    mark = <Icon size={16} aria-hidden="true" />;
  }
  return (
    <span
      className="integration-icon"
      data-type={entry.type}
      aria-hidden="true"
    >
      {mark}
    </span>
  );
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
      <IntegrationIcon entry={entry} />
      <div className="integration-row-copy">
        <span className="integration-row-title">
          <strong>{entry.label}</strong>
          <span className="integration-state" data-state={entry.state}>
            <StateIcon state={entry.state} />
            {INTEGRATION_STATE_LABELS[entry.state]}
          </span>
        </span>
        <p className="integration-row-detail">{entry.detail}</p>
        {provides ? (
          <p className="integration-row-provides">Gives World {provides}.</p>
        ) : null}
        {entry.type === "weather" ? <WeatherConsent /> : null}
      </div>
      <span className="integration-row-actions">
        {onToggleSettings ? (
          <button
            type="button"
            className="integration-icon-button"
            aria-expanded={expanded}
            aria-label={`${entry.label} settings`}
            title={`${entry.label} settings`}
            onClick={onToggleSettings}
          >
            <Settings2 size={15} aria-hidden="true" />
          </button>
        ) : null}
        {action ? (
          <button
            type="button"
            className="integration-action"
            data-action={action.label === "Connect" ? "connect" : "disconnect"}
            disabled={busy}
            aria-label={`${action.label} ${entry.label}`}
            aria-describedby={
              entry.type === "weather" ? "weather-consent" : undefined
            }
            onClick={() => onAction(action)}
          >
            {action.label}
          </button>
        ) : null}
      </span>
      {expanded && children ? (
        <div className="integration-row-settings">{children}</div>
      ) : null}
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
    help: "Pull requests, tickets and usage beside your agents, plus optional local weather.",
  },
  // Agents keep their per-host install flow (the host picked in Connection).
  harness: { always: true, custom: true },
  ide: { help: "Editors World opens files and folders in." },
};

/**
 * The screen's tabs: All first, then one per kind, then the Vault, which
 * holds tokens for integrations rather than being one.
 */
type Tab = "all" | IntegrationKind | "vault";

const TAB_LABELS: Record<"all" | "vault", string> = {
  all: "All",
  vault: "Vault",
};

const tabLabel = (tab: Tab) =>
  tab === "all" || tab === "vault"
    ? TAB_LABELS[tab]
    : INTEGRATION_KIND_LABELS[tab];

/** The tab last opened on this page: Integrations reopens where it was. */
let lastTab: Tab | null = null;

/**
 * The tab a focused row sits in: `source:github` is in Sources, a host
 * (`host:<id>`) in Runtimes.
 */
function kindOf(focus: string | undefined): IntegrationKind | null {
  const prefix = focus?.split(":", 1)[0];
  if (prefix === "host") return "runtime";
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
 * use, with its status and one Connect or Disconnect. All lists every kind
 * under its heading, each kind has its own tab, and the Vault tab names the
 * tokens World keeps. The search box always searches everything: typing
 * opens All, and each tab counts its matches, so a list of dozens stays
 * usable on a phone. Each row acts through
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
  /**
   * The Agents list, on its tab and in All; `query` is the search box, for
   * its own list, which reports how many agents it lists and matches.
   */
  agents: (
    query: string,
    onMatches: (matches: AgentMatches | null) => void,
  ) => ReactNode;
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
  const [agentMatches, setAgentMatches] = useState<AgentMatches | null>(null);
  const [tab, setTab] = useState<Tab>(() => kindOf(focus) ?? lastTab ?? "all");
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
    if (status.config.kind === "weather")
      return (
        <WeatherSourceSettings
          settings={status.config}
          weather={sources.weather}
          busy={pending}
          run={run}
        />
      );
    return status.id === "github" ? (
      <GitHubSourceFields source={status} busy={pending} run={run} />
    ) : (
      <JiraSourceFields source={status} busy={pending} run={run} />
    );
  };

  const rows = snapshot ? withIntegrationsFixture(snapshot.integrations) : [];
  const terms = searchTerms(query);
  // Search always covers every integration and the vault; a tab only
  // narrows what is listed.
  const matching = rows.filter((entry) => integrationMatches(entry, terms));
  const vault = snapshot?.vault;
  const vaultMatches = vault
    ? matchesTerms(terms, [
        TAB_LABELS.vault,
        "tokens secrets",
        vault.label,
        vault.detail,
        ...vault.secrets.map((secret) => secret.label),
      ])
    : false;
  const secrets = vault
    ? vaultMatches
      ? vault.secrets
      : vault.secrets.filter((secret) => matchesTerms(terms, [secret.label]))
    : [];
  const kinds = INTEGRATION_KINDS.filter(
    (kind) => PANELS[kind]?.always || rows.some((entry) => entry.kind === kind),
  );
  const tabs: Tab[] = ["all", ...kinds, "vault"];
  const active = tabs.includes(tab) ? tab : "all";
  const ofKind = (kind: IntegrationKind) =>
    matching.filter((entry) => entry.kind === kind);
  // Agents list their own rows (per host); the registry's harness rows are
  // not shown twice.
  const agentCount = agentMatches?.listed ?? 0;
  const count = (of: Tab): number | null =>
    of === "all"
      ? matching.filter((entry) => !PANELS[entry.kind]?.custom).length +
        agentCount
      : of === "vault"
        ? vault
          ? secrets.length
          : null
        : PANELS[of]?.custom
          ? (agentMatches?.listed ?? null)
          : ofKind(of).length;
  const vaultListed = !!vault && (vaultMatches || secrets.length > 0);
  const agentsListed = !terms.length || agentMatches?.any !== false;
  const found = (other: Tab) =>
    other === "vault"
      ? vaultListed
      : other === "harness"
        ? !!agentMatches?.any
        : !!count(other);
  const elsewhere = tabs.filter(
    (other) => other !== active && terms.length && found(other),
  );
  const select = (next: Tab, focusTab = false) => {
    setTab(next);
    lastTab = next;
    const button = root.current?.querySelector<HTMLElement>(
      `[role="tab"][data-kind="${next}"]`,
    );
    button?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    if (focusTab) button?.focus();
  };
  const search = (value: string) => {
    // Typing a search opens All, so it finds every integration; picking a
    // tab afterwards narrows the results to that kind.
    if (!terms.length && searchTerms(value).length && active !== "all")
      select("all");
    setQuery(value);
  };

  const rowFor = (entry: IntegrationEntry) => {
    const settingsFor = entry.kind === "source" && entry.control !== "none";
    const action: Action | null =
      entry.kind === "runtime"
        ? runtimeAction(entry)
        : settingsFor
          ? sourceAction(entry)
          : null;
    return (
      <IntegrationRow
        key={entry.id}
        entry={entry}
        action={action}
        busy={busy !== null}
        onAction={(next) => act(entry, next)}
        expanded={settingsFor && open.has(entry.id)}
        onToggleSettings={settingsFor ? () => toggle(entry.id) : undefined}
      >
        {settingsFor ? sourceFields(entry) : null}
      </IntegrationRow>
    );
  };

  const kindExtras = (kind: IntegrationKind) =>
    kind === "runtime" ? (
      <button
        type="button"
        className="ghost integrations-extra integrations-hosts"
        onClick={() => setHostsOpen(true)}
      >
        Add or edit hosts…
      </button>
    ) : kind === "source" && snapshot ? (
      <button
        type="button"
        className="ghost integrations-extra"
        disabled={busy !== null}
        onClick={() =>
          void run(
            "refresh",
            () => worldSourcesStore.refresh(true),
            "Sources refreshed.",
          )
        }
      >
        <RefreshCw size={13} aria-hidden="true" /> Refresh Sources
      </button>
    ) : null;

  const vaultBody = vault ? (
    <>
      <p className="integrations-help">
        {vault.label}. {vault.detail} Each token is entered in its integration's
        settings; World never shows one back.
      </p>
      {secrets.length ? (
        <ul className="integrations-list" aria-label="Tokens in the vault">
          {secrets.map((secret) => (
            <li
              key={secret.name}
              className="integration-row"
              data-secret={secret.name}
            >
              <span className="integration-icon" aria-hidden="true">
                <KeyRound size={15} aria-hidden="true" />
              </span>
              <div className="integration-row-copy">
                <span className="integration-row-title">
                  <strong>{secret.label}</strong>
                </span>
                <p className="integration-row-detail">
                  Used by{" "}
                  {rows.find((entry) => entry.id === secret.usedBy)?.label ??
                    secret.usedBy}
                  .
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="integrations-empty">
          {vault.secrets.length
            ? `No token matches “${query.trim()}”.`
            : "Holds no tokens."}
        </p>
      )}
    </>
  ) : null;

  const noMatch = (label: string) => (
    <div className="integrations-empty" role="status">
      <p>
        {label} “{query.trim()}”.
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
            {tabLabel(other)}
            {count(other) === null ? "" : ` (${count(other)})`}
          </button>
        ))}
        <button type="button" className="ghost" onClick={() => search("")}>
          Clear search
        </button>
      </span>
    </div>
  );

  const heading = (kind: IntegrationKind) => (
    <div className="integrations-kind-head">
      <h3>
        <TabIcon tab={kind} />
        {INTEGRATION_KIND_LABELS[kind]}
        {count(kind) === null ? null : (
          <span className="integrations-tab-count">{count(kind)}</span>
        )}
      </h3>
      {terms.length ? null : kindExtras(kind)}
    </div>
  );
  // Runtimes read per machine once the service names its hosts.
  const hostsListed = !!snapshot?.hosts?.length;
  const runtimeHosts = () => (
    <RuntimeHosts
      hosts={snapshot?.hosts ?? []}
      rows={ofKind("runtime")}
      terms={terms}
      rowFor={rowFor}
      open={open}
      toggle={toggle}
      busy={busy !== null}
      run={run}
    />
  );
  const group = (kind: IntegrationKind) => (
    <section
      key={kind}
      className="integrations-kind"
      data-kind={kind}
      aria-label={INTEGRATION_KIND_LABELS[kind]}
    >
      {heading(kind)}
      {kind === "runtime" && hostsListed ? (
        runtimeHosts()
      ) : ofKind(kind).length ? (
        <ul className="integrations-list">{ofKind(kind).map(rowFor)}</ul>
      ) : (
        <p className="integrations-empty">{PANELS[kind]?.empty}</p>
      )}
    </section>
  );

  // The Agents list keeps one place in the panel on every tab (hidden where
  // it is not shown), so it keeps its counts current for the search and
  // moving between tabs never reloads it.
  const agentsKind = kinds.find((kind) => PANELS[kind]?.custom);
  let agentsShown: "tab" | "group" | "hidden" = "hidden";
  let before: ReactNode = null;
  let after: ReactNode = null;
  if (active === "harness") agentsShown = "tab";
  else if (!snapshot)
    before = listError ? null : (
      <p className="integrations-help">Checking integrations…</p>
    );
  else if (active === "vault") before = vaultBody;
  else if (active === "all") {
    // A kind that is always shown keeps its place (and its empty text) in
    // All until a search leaves it with nothing.
    const groups = kinds.filter(
      (kind) =>
        !PANELS[kind]?.custom &&
        (ofKind(kind).length > 0 || (!terms.length && PANELS[kind]?.always)),
    );
    const split = agentsKind ? kinds.indexOf(agentsKind) : kinds.length;
    if (agentsKind && agentsListed) agentsShown = "group";
    before = groups.filter((kind) => kinds.indexOf(kind) < split).map(group);
    after = (
      <>
        {groups.filter((kind) => kinds.indexOf(kind) > split).map(group)}
        {vaultListed ? (
          <section
            className="integrations-kind"
            data-kind="vault"
            aria-label={TAB_LABELS.vault}
          >
            <div className="integrations-kind-head">
              <h3>
                <TabIcon tab="vault" />
                {TAB_LABELS.vault}
                <span className="integrations-tab-count">{secrets.length}</span>
              </h3>
            </div>
            {vaultBody}
          </section>
        ) : null}
        {groups.length || agentsShown === "group" || vaultListed
          ? null
          : noMatch("Nothing matches")}
      </>
    );
  } else {
    const listed = ofKind(active);
    const kindLabel = INTEGRATION_KIND_LABELS[active];
    before =
      active === "runtime" &&
      hostsListed &&
      (listed.length || !terms.length) ? (
        runtimeHosts()
      ) : listed.length ? (
        <ul className="integrations-list">{listed.map(rowFor)}</ul>
      ) : terms.length ? (
        noMatch(`No ${kindLabel.toLowerCase()} match`)
      ) : (
        <p className="integrations-empty">
          {PANELS[active]?.empty ?? `No ${kindLabel.toLowerCase()} yet.`}
        </p>
      );
  }
  const agentsBlock = agentsKind ? (
    <section
      className={
        agentsShown === "group" ? "integrations-kind" : "integrations-agents"
      }
      data-kind={agentsShown === "group" ? agentsKind : undefined}
      aria-label={
        agentsShown === "group"
          ? INTEGRATION_KIND_LABELS[agentsKind]
          : undefined
      }
      hidden={agentsShown === "hidden"}
    >
      {agentsShown === "group" ? heading(agentsKind) : null}
      {agents(query, setAgentMatches)}
    </section>
  ) : null;
  const help =
    active === "all" || active === "vault" ? undefined : PANELS[active]?.help;
  const panelExtras =
    active === "all" || active === "vault" ? null : kindExtras(active);

  return (
    <div ref={root} className="integrations-settings">
      <p className="integrations-intro">
        What World reads from and works through. Each one is optional and adds
        to what World shows; the World service makes every request, never the
        browser.
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
          onChange={(event) => search(event.target.value)}
        />
      </label>
      <div
        className="integrations-tabs"
        role="tablist"
        aria-label="Kinds of integration"
      >
        {tabs.map((each, index) => {
          const n = count(each);
          const failing =
            each !== "vault" &&
            rows.some(
              (entry) =>
                (each === "all" || entry.kind === each) &&
                entry.state === "error",
            );
          const label = tabLabel(each);
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
                    ? (index + 1) % tabs.length
                    : event.key === "ArrowLeft"
                      ? (index + tabs.length - 1) % tabs.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : null;
                if (next === null) return;
                event.preventDefault();
                select(tabs[next], true);
              }}
            >
              {each === "vault" ? <TabIcon tab="vault" /> : null}
              <span className="integrations-tab-label">{label}</span>
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
        {help || panelExtras ? (
          <div className="integrations-panel-head">
            {help ? <p className="integrations-help">{help}</p> : null}
            {panelExtras}
          </div>
        ) : null}
        {before}
        {agentsBlock}
        {after}
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
