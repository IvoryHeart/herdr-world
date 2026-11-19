import { useEffect, useId, useMemo, useState } from "react";
import {
  Bot,
  Code2,
  Copy,
  ExternalLink,
  FolderOpen,
  Loader2,
  Square,
  SquareTerminal,
} from "lucide-react";
import { worldLocalStorage } from "../../browserStorage";
import { AgentIcon } from "../../components/AgentIcon";
import { ConfirmDialog } from "../../components/ModalDialogs";
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
import { useIdeStatus } from "./useIdeStatus";
import "./CodeView.css";

export { IdeIntegrationsSettings } from "./IdeIntegrationsSettings";

const PROJECT_KEY = "code.project";

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

const usable = (provider: IdeProviderStatus) =>
  provider.enabled && provider.detection.state === "detected";

/**
 * Code: the owner's installed VS Code (or code-server / OpenVSCode Server)
 * for one project, on World's own origin, with that project's agents and
 * terminals beside it. World starts a server only when asked, reuses it
 * per project folder, and leaves editing, Git and extensions to the IDE.
 */
export default function CodeView({
  world,
  onOpenAgent,
  onOpenTerminal,
  client: clientProp,
}: {
  world: WorldObject;
  onOpenAgent: (id: string) => unknown;
  onOpenTerminal: (id: string) => unknown;
  client?: IdeClient;
}) {
  const client = useMemo(() => clientProp ?? pageIdeClient(), [clientProp]);
  const ide = useIdeStatus(client);
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
  const [refusals, setRefusals] = useState<Record<string, IdeRefusal>>({});
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [stopping, setStopping] = useState<IdeInstance | null>(null);
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

  const open = async (target: CodeProject) => {
    if (!provider) return;
    setOpening(target.key);
    setOpenError(null);
    try {
      const result = await client.open({
        provider: provider.id,
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

  const readyVisited = instances.filter(
    (entry) => entry.state === "ready" && visited.includes(entry.id),
  );
  const showingFrame = instance?.state === "ready";

  return (
    <div className="code-view" data-state={stageState()}>
      <header className="code-view-bar">
        <Code2 size={16} aria-hidden className="code-view-mark" />
        {projects.length ? (
          <label className="code-view-project" htmlFor={selectId}>
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
        {instance?.state === "ready" ? (
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
            onClick={() => setStopping(instance)}
          >
            <Square size={13} aria-hidden />
            <span>Stop</span>
          </button>
        ) : null}
      </header>
      <div className="code-view-body">
        <section className="code-view-stage" aria-label="IDE">
          {readyVisited.map((entry) => (
            <iframe
              key={entry.id}
              className="code-view-frame"
              src={entry.url}
              title={`${providerLabel(entry)} — ${displayFolder(entry.folder)}`}
              hidden={entry.id !== instance?.id}
              allow="clipboard-read; clipboard-write"
            />
          ))}
          {showingFrame ? null : (
            <div className="code-view-panel">{panel()}</div>
          )}
        </section>
        {project ? (
          <ProjectContext
            project={project}
            onOpenAgent={onOpenAgent}
            onOpenTerminal={onOpenTerminal}
          />
        ) : null}
      </div>
      <ConfirmDialog
        open={stopping !== null}
        title="Stop VS Code"
        message={`Stop ${stopping ? providerLabel(stopping) : "the IDE"} for ${stopping ? displayFolder(stopping.folder) : "this project"}? Its windows close; agents and terminals keep running. Open it again any time.`}
        confirmLabel="Stop"
        onClose={() => setStopping(null)}
        onConfirm={() => {
          if (stopping) void stop(stopping);
        }}
      />
    </div>
  );

  function providerLabel(entry: IdeInstance) {
    return (
      providers.find((candidate) => candidate.id === entry.provider)?.label ??
      "IDE"
    );
  }

  function stageState() {
    if (!ide.status) return "loading";
    if (!project) return "no-project";
    if (!provider) return "integration";
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
            Code opens the IDE already installed on this computer for a project,
            with your extensions, settings and profile, and keeps the project's
            agents and terminals beside it. Enable one to start.
          </p>
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
              ? "The first start on this computer downloads VS Code's web server, about a minute. Later starts are quick."
              : `For ${displayFolder(project.folder)} on ${project.hostLabel}.`}
          </p>
        </div>
      );
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
      return <Refusal refusal={refusal} onRetry={() => void open(project)} />;
    return (
      <div className="code-view-closed">
        <h2>{project.label}</h2>
        <p className="code-view-muted">
          {project.hostLabel} · {displayFolder(project.folder)}
        </p>
        {remote && !project.stale ? (
          <p className="code-view-muted">
            On {project.hostLabel}, over SSH: World gives you the command and
            link to open it in desktop VS Code with Remote - SSH.
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
          {remote ? "Open in desktop VS Code…" : `Open in ${provider.label}`}
        </button>
        {!window.isSecureContext ? (
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
}: {
  refusal: IdeRefusal;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const handoff = refusal.handoff;
  return (
    <div className="code-view-refusal" data-code={refusal.code}>
      <h2>
        {refusal.code === "remote"
          ? "Open this project in desktop VS Code"
          : refusal.code === "limit"
            ? "Too many IDEs are running"
            : "World can't open this project here"}
      </h2>
      <p role="alert">{refusal.message}</p>
      {handoff ? (
        <div className="code-view-handoff">
          <a className="primary" href={handoff.url}>
            <ExternalLink size={14} aria-hidden /> Open in VS Code
          </a>
          <div className="code-view-command">
            <code>{handoff.command}</code>
            <button
              type="button"
              aria-label="Copy the command"
              title="Copy the command"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(handoff.command)
                  .then(() => setCopied(true))
                  .catch(() => undefined)
              }
            >
              <Copy size={14} aria-hidden />
            </button>
          </div>
          <p className="code-view-muted">
            {copied
              ? "Copied. Run it on your own computer, where desktop VS Code with Remote - SSH is installed."
              : "The link and command need desktop VS Code with the Remote - SSH extension on your own computer."}
          </p>
        </div>
      ) : refusal.code === "stale" || refusal.code === "limit" ? (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

function ProjectContext({
  project,
  onOpenAgent,
  onOpenTerminal,
}: {
  project: CodeProject;
  onOpenAgent: (id: string) => unknown;
  onOpenTerminal: (id: string) => unknown;
}) {
  const agents = project.leaves.filter((leaf) => leaf.kind === "agent");
  const terminals = project.leaves.filter((leaf) => leaf.kind !== "agent");
  return (
    <aside
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
