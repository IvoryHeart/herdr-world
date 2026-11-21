import { useEffect, useId, useMemo, useState } from "react";
import {
  Bot,
  Code2,
  ExternalLink,
  FolderOpen,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Server,
  Square,
  SquareTerminal,
} from "lucide-react";
import { worldLocalStorage } from "../../browserStorage";
import { AgentIcon } from "../../components/AgentIcon";
import { CloseButton } from "../../components/CloseButton";
import { useViewTheme } from "../../themeScope";
import type { WorldLeafObject, WorldObject } from "../worldObject";
import {
  type CodeProject,
  codeProjects,
  displayFolder,
  leafName,
} from "./codeProjects";
import {
  type IdeClient,
  type IdeInstance,
  type IdeProviderStatus,
  type IdeRefusal,
  pageIdeClient,
} from "./ideClient";
import { IdeProviderList } from "./IdeProviders";
import {
  IdeServerList,
  IdeStopDialog,
  ideProviderLabel,
  ideServerHost,
  ideSince,
  runningIdeServers,
} from "./IdeServers";
import { useIdeStatus } from "./useIdeStatus";
import "./CodeView.css";

export { IdeIntegrationsSettings } from "./IdeIntegrationsSettings";

const PROJECT_KEY = "code.project";
const RAIL_KEY = "code.rail";
/** Below this width the rail starts collapsed, leaving VS Code the room. */
const RAIL_OPEN_MIN_WIDTH = 1100;

const STATUS_LABELS: Record<WorldLeafObject["status"], string> = {
  working: "Working",
  idle: "Idle",
  blocked: "Needs you",
  done: "Done",
  unknown: "Unknown",
};

function readProjectKey() {
  try {
    return worldLocalStorage.getItem(PROJECT_KEY);
  } catch {
    return null;
  }
}

function writeProjectKey(key: string) {
  try {
    worldLocalStorage.setItem(PROJECT_KEY, key);
  } catch {
    // Storage off: the choice lasts for this page.
  }
}

/** The owner's last choice, else open only on a wide window. */
function readRailOpen() {
  try {
    const saved = worldLocalStorage.getItem(RAIL_KEY);
    if (saved === "open") return true;
    if (saved === "closed") return false;
  } catch {
    // Storage off: fall back to the width.
  }
  return window.innerWidth >= RAIL_OPEN_MIN_WIDTH;
}

function writeRailOpen(open: boolean) {
  try {
    worldLocalStorage.setItem(RAIL_KEY, open ? "open" : "closed");
  } catch {
    // Storage off: the choice lasts for this page.
  }
}

/**
 * Enabled is enough: whether it is installed is checked on the project's
 * own host (World's computer or the SSH host) when it opens.
 */
const usable = (provider: IdeProviderStatus) => provider.enabled;

/**
 * Code: the complete VS Code (or code-server / OpenVSCode Server) of the
 * host a project is on, World's own computer or an SSH host, filling the
 * view on World's own origin. A thin bar picks the project; the rail of
 * the project's agents and terminals folds away. World starts a server
 * only when asked, reuses it per project folder, and leaves editing, Git
 * and extensions to the IDE. Nothing here opens a desktop app.
 */
export default function CodeView({
  world,
  onOpenAgent,
  onOpenTerminal,
  client: clientProp,
  secure = window.isSecureContext,
}: {
  world: WorldObject;
  onOpenAgent: (id: string) => unknown;
  onOpenTerminal: (id: string) => unknown;
  client?: IdeClient;
  /** Whether this page is HTTPS or localhost; tests try a plain-HTTP one. */
  secure?: boolean;
}) {
  const client = useMemo(() => clientProp ?? pageIdeClient(), [clientProp]);
  const ide = useIdeStatus(client);
  // VS Code's light/dark follows the frame's colour scheme (the server adds
  // auto-detect, workbench-theme.ts). Set on the frame itself: an inherited
  // change alone doesn't fire the frame's prefers-color-scheme change event.
  const theme = useViewTheme();
  const projects = useMemo(() => codeProjects(world), [world]);
  const [chosen, setChosen] = useState<string | null>(readProjectKey);
  const local = new Set(ide.status?.localConnections ?? []);
  const instances = ide.status?.instances ?? [];
  // The remembered project; else one with a running IDE; else the first
  // live one on this computer; else the first live one anywhere.
  const project =
    projects.find((entry) => entry.key === chosen) ??
    projects.find((entry) =>
      instances.some(
        (instance) =>
          instance.connectionId === entry.connectionId &&
          instance.folder === entry.folder,
      ),
    ) ??
    projects.find((entry) => !entry.stale && local.has(entry.connectionId)) ??
    projects.find((entry) => !entry.stale) ??
    null;
  // Known only when the service lists this computer's connections.
  const remote =
    project !== null && local.size > 0 && !local.has(project.connectionId);
  const [railOpen, setRailOpen] = useState(readRailOpen);
  const railId = useId();
  const [refusals, setRefusals] = useState<Record<string, IdeRefusal>>({});
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [stopping, setStopping] = useState<IdeInstance | null>(null);
  const [serversOpen, setServersOpen] = useState(false);
  const running = runningIdeServers(ide.status);
  // Ready workbenches shown this visit stay loaded while another project
  // is in front, so switching back does not reload VS Code.
  const [visited, setVisited] = useState<string[]>([]);
  const selectId = useId();

  const providers = ide.status?.providers ?? [];
  const enabledProviders = providers.filter(usable);
  const [providerChoice, setProviderChoice] = useState<string | null>(null);
  const provider =
    enabledProviders.find((entry) => entry.id === providerChoice) ??
    enabledProviders[0] ??
    null;
  const instance = project
    ? instances.find(
        (entry) =>
          entry.connectionId === project.connectionId &&
          entry.folder === project.folder,
      )
    : undefined;
  const refusal = project ? refusals[project.key] : undefined;
  // Microsoft's VS Code can't connect from a plain-HTTP address: World
  // says so instead of a workbench that waits forever.
  const insecureFor = (id: string | undefined) =>
    secure
      ? undefined
      : providers.find((entry) => entry.id === id && entry.needsSecurePage);
  const insecure = insecureFor(instance?.provider ?? provider?.id);

  useEffect(() => {
    if (instance?.state !== "ready") return;
    setVisited((current) =>
      current.includes(instance.id) ? current : [...current, instance.id],
    );
  }, [instance?.id, instance?.state]);

  const choose = (key: string) => {
    setChosen(key);
    writeProjectKey(key);
    setOpenError(null);
  };

  const open = async (target: CodeProject, using = provider) => {
    if (!using) return;
    setOpening(target.key);
    setOpenError(null);
    try {
      const result = await client.open({
        provider: using.id,
        connectionId: target.connectionId,
        generation: target.generation,
        folder: target.folder,
      });
      if (result.ok) {
        setRefusals((current) => {
          const rest = { ...current };
          delete rest[target.key];
          return rest;
        });
      } else
        setRefusals((current) => ({
          ...current,
          [target.key]: result.refusal,
        }));
      await ide.reload();
    } catch (cause) {
      setOpenError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOpening(null);
    }
  };

  const stop = async (target: IdeInstance) => {
    try {
      ide.apply(await client.stop(target.id));
      setVisited((current) => current.filter((id) => id !== target.id));
    } catch (cause) {
      setOpenError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  // The host as the project picker names it, else its SSH destination.
  const hostLabel = (entry: IdeInstance) =>
    projects.find((candidate) => candidate.connectionId === entry.connectionId)
      ?.hostLabel ?? ideServerHost(entry);
  const projectOf = (entry: IdeInstance) =>
    projects.find(
      (candidate) =>
        candidate.connectionId === entry.connectionId &&
        candidate.folder === entry.folder,
    );

  const readyVisited = instances.filter(
    (entry) =>
      entry.state === "ready" &&
      visited.includes(entry.id) &&
      !insecureFor(entry.provider),
  );
  const showingFrame = instance?.state === "ready" && !insecure;

  return (
    <div
      className="code-view"
      data-state={stageState()}
      data-rail={project && railOpen ? "open" : "closed"}
    >
      <header className="code-view-bar">
        <Code2 size={16} aria-hidden className="code-view-mark" />
        {projects.length ? (
          <label
            className="code-view-project"
            htmlFor={selectId}
            data-help="code.project"
          >
            <span className="world-sr-only">Project</span>
            <select
              id={selectId}
              value={project?.key ?? ""}
              onChange={(event) => choose(event.target.value)}
            >
              {groupByHost(projects).map(([host, entries]) => (
                <optgroup key={host} label={host}>
                  {entries.map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {entry.label}
                      {entry.stale ? " (stale)" : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        ) : null}
        {project ? (
          <span className="code-view-where" title={project.folder}>
            <FolderOpen size={13} aria-hidden />
            {project.hostLabel} · {displayFolder(project.folder)}
          </span>
        ) : null}
        <span className="code-view-bar-spacer" />
        {enabledProviders.length > 1 ? (
          <label className="code-view-provider">
            <span className="world-sr-only">IDE</span>
            <select
              value={provider?.id ?? ""}
              onChange={(event) => setProviderChoice(event.target.value)}
            >
              {enabledProviders.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
        ) : provider ? (
          <span className="code-view-provider-label">{provider.label}</span>
        ) : null}
        {showingFrame ? (
          <a
            className="code-view-bar-action"
            href={instance.url}
            target="_blank"
            rel="noopener"
            title="Open this VS Code in its own browser tab"
          >
            <ExternalLink size={14} aria-hidden />
            <span>New tab</span>
          </a>
        ) : null}
        {instance && instance.state !== "failed" ? (
          <button
            type="button"
            className="code-view-bar-action"
            disabled={instance.stopping}
            onClick={() => setStopping(instance)}
          >
            <Square size={13} aria-hidden />
            <span>Stop</span>
          </button>
        ) : null}
        {running.length ? (
          <button
            type="button"
            className="code-view-bar-action"
            aria-expanded={serversOpen}
            title="IDE servers World started that still run"
            onClick={() => setServersOpen(!serversOpen)}
          >
            <Server size={13} aria-hidden />
            <span>Servers</span>
            <span className="code-view-rail-count">{running.length}</span>
          </button>
        ) : null}
        {project ? (
          <button
            type="button"
            className="code-view-bar-action code-view-rail-toggle"
            aria-label="Agents and terminals"
            aria-expanded={railOpen}
            aria-controls={railId}
            title={
              railOpen
                ? "Hide the project's agents and terminals"
                : "Show the project's agents and terminals"
            }
            onClick={() => {
              setRailOpen(!railOpen);
              writeRailOpen(!railOpen);
            }}
          >
            {railOpen ? (
              <PanelRightClose size={14} aria-hidden />
            ) : (
              <PanelRightOpen size={14} aria-hidden />
            )}
            {!railOpen && project.leaves.length ? (
              <span className="code-view-rail-count">
                {project.leaves.length}
              </span>
            ) : null}
          </button>
        ) : null}
      </header>
      <div className="code-view-body">
        {serversOpen && ide.status && running.length ? (
          <section className="code-view-servers" aria-label="IDE servers">
            <div className="code-view-servers-head">
              <h2>Running IDE servers</h2>
              <CloseButton onClick={() => setServersOpen(false)} />
            </div>
            <p className="code-view-muted">
              They keep running when you leave Code, close the browser or World
              restarts, until you stop them.
            </p>
            <IdeServerList
              status={ide.status}
              hostLabel={hostLabel}
              onStop={stop}
              onForget={async (entry) =>
                ide.apply(await client.forget(entry.id))
              }
              onShow={(entry) => {
                const target = projectOf(entry);
                if (target) choose(target.key);
                setServersOpen(false);
              }}
            />
          </section>
        ) : null}
        <section className="code-view-stage" aria-label="IDE">
          {readyVisited.map((entry) => (
            <iframe
              key={entry.id}
              className="code-view-frame"
              src={entry.url}
              title={`${providerLabel(entry)} — ${displayFolder(entry.folder)}`}
              hidden={entry.id !== instance?.id}
              style={{ colorScheme: theme }}
              allow="clipboard-read; clipboard-write"
            />
          ))}
          {showingFrame ? null : (
            <div className="code-view-panel">{panel()}</div>
          )}
        </section>
        {project && railOpen ? (
          <ProjectContext
            id={railId}
            project={project}
            onOpenAgent={onOpenAgent}
            onOpenTerminal={onOpenTerminal}
          />
        ) : null}
      </div>
      <IdeStopDialog
        instance={stopping}
        providers={providers}
        hostLabel={hostLabel}
        onClose={() => setStopping(null)}
        onStop={stop}
      />
    </div>
  );

  function providerLabel(entry: IdeInstance) {
    return ideProviderLabel(providers, entry);
  }

  function stageState() {
    if (!ide.status) return "loading";
    if (!project) return "no-project";
    if (!provider) return refusal ? "refused" : "integration";
    if (insecure) return "insecure-page";
    if (instance) return instance.state;
    if (refusal) return "refused";
    return "closed";
  }

  function panel() {
    if (ide.error && !ide.status)
      return (
        <p className="code-view-error" role="alert">
          {ide.error}
        </p>
      );
    if (!ide.status)
      return (
        <p className="code-view-muted">
          <Loader2 size={16} className="code-view-spin" aria-hidden /> Looking
          for installed IDEs…
        </p>
      );
    if (!provider)
      return (
        <div className="code-view-integration">
          <h2>Your own VS Code, inside World</h2>
          <p>
            Code opens the VS Code installed on the computer a project is on,
            this one or an SSH host, with your extensions, settings and profile,
            right here in World. The project's agents and terminals stay one
            click away. Enable one to start.
          </p>
          {refusal && project ? (
            <Refusal
              refusal={refusal}
              onRetry={() => void open(project)}
              onShowServers={() => setServersOpen(true)}
            />
          ) : null}
          {openError ? (
            <p className="code-view-error" role="alert">
              {openError}
            </p>
          ) : null}
          <IdeProviderList
            status={ide.status}
            client={client}
            onStatus={ide.apply}
          />
        </div>
      );
    if (!project)
      return (
        <div className="code-view-empty">
          <h2>No projects yet</h2>
          <p>
            A project is the folder of a room or an agent. Start an agent or
            open a room, and its folder shows here.
          </p>
        </div>
      );
    if (insecure) return <InsecurePage label={insecure.label} />;
    if (instance?.state === "starting")
      return (
        <div className="code-view-starting" role="status">
          <Loader2 size={22} className="code-view-spin" aria-hidden />
          <h2>
            {instance.downloading
              ? `${provider.label} is getting its server ready`
              : `Starting ${provider.label}`}
          </h2>
          <p>
            {instance.downloading
              ? `The first start on ${project.hostLabel} downloads VS Code's web server, about a minute. Later starts are quick.`
              : `For ${displayFolder(project.folder)} on ${project.hostLabel}${instance.sshDestination ? ", over SSH" : ""}.`}
          </p>
        </div>
      );
    if (instance?.state === "detached") {
      const since = ideSince(instance.startedAt);
      const using =
        providers.find((entry) => entry.id === instance.provider) ?? provider;
      return (
        <div className="code-view-detached">
          <h2>
            {providerLabel(instance)} still runs on {hostLabel(instance)}
          </h2>
          <p>
            {since ? `Running since ${since}. ` : ""}World isn't attached to it
            right now; whatever runs in it keeps running.
          </p>
          {instance.reason ? (
            <p className="code-view-muted">{instance.reason}</p>
          ) : null}
          {project.stale ? (
            <p role="alert">
              This project's connection is stale. Reconnect it to open the IDE
              again.
            </p>
          ) : null}
          <div className="code-view-detached-actions">
            <button
              type="button"
              className="primary"
              disabled={opening !== null || project.stale || instance.stopping}
              onClick={() => void open(project, using)}
            >
              {opening === project.key ? (
                <Loader2 size={14} className="code-view-spin" aria-hidden />
              ) : (
                <Code2 size={14} aria-hidden />
              )}
              Open
            </button>
            <button
              type="button"
              disabled={instance.stopping}
              onClick={() => setStopping(instance)}
            >
              <Square size={13} aria-hidden /> Stop…
            </button>
          </div>
          {openError ? (
            <p className="code-view-error" role="alert">
              {openError}
            </p>
          ) : null}
        </div>
      );
    }
    if (instance?.state === "failed")
      return (
        <div className="code-view-failed">
          <h2>{providerLabel(instance)} stopped</h2>
          <p role="alert">{instance.reason ?? "The server exited."}</p>
          <button
            type="button"
            className="primary"
            disabled={opening !== null || project.stale}
            onClick={() => void open(project)}
          >
            Try again
          </button>
        </div>
      );
    if (refusal)
      return (
        <Refusal
          refusal={refusal}
          onRetry={() => void open(project)}
          onShowServers={() => setServersOpen(true)}
        />
      );
    return (
      <div className="code-view-closed">
        <h2>{project.label}</h2>
        <p className="code-view-muted">
          {project.hostLabel} · {displayFolder(project.folder)}
        </p>
        {remote && !project.stale ? (
          <p className="code-view-muted">
            On {project.hostLabel}, over SSH: World starts {provider.label}{" "}
            there and shows it here.
          </p>
        ) : null}
        {project.stale ? (
          <p role="alert">
            This project's connection is stale. Reconnect it to open the
            project.
          </p>
        ) : null}
        <button
          type="button"
          className="primary"
          disabled={opening !== null || project.stale}
          onClick={() => void open(project)}
        >
          {opening === project.key ? (
            <Loader2 size={14} className="code-view-spin" aria-hidden />
          ) : (
            <Code2 size={14} aria-hidden />
          )}
          Open in {provider.label}
        </button>
        {!secure ? (
          <p className="code-view-note">
            This address isn't secure, so VS Code's webviews, previews and
            clipboard may not work. Open World over HTTPS or at localhost on
            this computer.
          </p>
        ) : null}
        {openError ? (
          <p className="code-view-error" role="alert">
            {openError}
          </p>
        ) : null}
      </div>
    );
  }
}

function InsecurePage({ label }: { label: string }) {
  return (
    <div className="code-view-refusal" data-code="insecure-page">
      <h2>{label} needs a secure address</h2>
      <p role="alert">
        Microsoft's VS Code connects only from a page served over HTTPS, or at
        localhost on the computer World runs on. This page is plain HTTP at{" "}
        {window.location.host}, so it would never finish opening.
      </p>
      <p>
        Open World over HTTPS instead: give World a certificate, or put it
        behind an HTTPS proxy such as <code>tailscale serve</code>. On the
        computer World runs on, localhost works too. code-server and OpenVSCode
        Server work on this address.
      </p>
    </div>
  );
}

function groupByHost(projects: CodeProject[]) {
  const groups = new Map<string, CodeProject[]>();
  for (const project of projects) {
    const list = groups.get(project.hostLabel) ?? [];
    list.push(project);
    groups.set(project.hostLabel, list);
  }
  return [...groups.entries()];
}

function Refusal({
  refusal,
  onRetry,
  onShowServers,
}: {
  refusal: IdeRefusal;
  onRetry: () => void;
  /** The cap: World stops none to make room; show the running ones. */
  onShowServers: () => void;
}) {
  return (
    <div className="code-view-refusal" data-code={refusal.code}>
      <h2>
        {refusal.code === "limit"
          ? "Too many IDEs are running"
          : refusal.code === "missing"
            ? "The IDE isn't installed there"
            : "World can't open this project here"}
      </h2>
      <p role="alert">{refusal.message}</p>
      {refusal.code === "limit" ? (
        <button type="button" onClick={onShowServers}>
          Show running servers
        </button>
      ) : null}
      {refusal.code === "stale" ||
      refusal.code === "limit" ||
      refusal.code === "missing" ? (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

function ProjectContext({
  id,
  project,
  onOpenAgent,
  onOpenTerminal,
}: {
  id: string;
  project: CodeProject;
  onOpenAgent: (id: string) => unknown;
  onOpenTerminal: (id: string) => unknown;
}) {
  const agents = project.leaves.filter((leaf) => leaf.kind === "agent");
  const terminals = project.leaves.filter((leaf) => leaf.kind !== "agent");
  return (
    <aside
      id={id}
      className="code-view-context"
      aria-label="Project agents and terminals"
    >
      <ContextGroup
        title="Agents"
        empty="No agents in this project."
        leaves={agents}
        onOpen={onOpenAgent}
      />
      <ContextGroup
        title="Terminals"
        empty="No terminals."
        leaves={terminals}
        onOpen={onOpenTerminal}
      />
      {project.spaces.length ? (
        <p className="code-view-context-rooms">
          {project.spaces.length === 1 ? "Room" : "Rooms"}:{" "}
          {project.spaces.map((space) => space.label).join(", ")}
        </p>
      ) : null}
    </aside>
  );
}

function ContextGroup({
  title,
  empty,
  leaves,
  onOpen,
}: {
  title: string;
  empty: string;
  leaves: WorldLeafObject[];
  onOpen: (id: string) => unknown;
}) {
  return (
    <section className="code-view-context-group">
      <h3>
        {title}
        {leaves.length ? <span>{leaves.length}</span> : null}
      </h3>
      {leaves.length ? (
        <ul>
          {leaves.map((leaf) => {
            const live = !leaf.stale;
            return (
              <li key={leaf.id}>
                <button
                  type="button"
                  className="code-view-leaf"
                  data-status={leaf.status}
                  disabled={!live}
                  title={
                    live
                      ? `Open ${leafName(leaf)}`
                      : `${leafName(leaf)} is stale`
                  }
                  onClick={() => {
                    // Opening reports its own failures in the Inspector.
                    void Promise.resolve(onOpen(leaf.id)).catch(
                      () => undefined,
                    );
                  }}
                >
                  {leaf.kind === "agent" ? (
                    leaf.pane.agent ? (
                      <AgentIcon agent={leaf.pane.agent} compact />
                    ) : (
                      <Bot size={14} aria-hidden />
                    )
                  ) : (
                    <SquareTerminal size={14} aria-hidden />
                  )}
                  <span className="code-view-leaf-name">{leafName(leaf)}</span>
                  {leaf.kind === "agent" ? (
                    <span className="code-view-leaf-status">
                      {STATUS_LABELS[leaf.status]}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="code-view-muted">{empty}</p>
      )}
    </section>
  );
}
