import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Blocks,
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
import { worldLocalStorage, worldSessionStorage } from "../../browserStorage";
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
  type IdeProviderId,
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
/** The servers whose workbench this browser tab loaded, across page reloads. */
const LOADED_KEY = "code.loaded";
const LOADED_LIMIT = 16;
/** The ones this page loaded. */
const loadedThisPage = new Set<string>();
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

/**
 * Notes that this page loads a server's workbench, and says whether it is a
 * load again: "page" when an earlier page of this tab had it (the page
 * reloaded), "page-again" when this page had it and let it go (its server
 * ended or failed and started again), else null.
 */
function noteLoaded(id: string): "page" | "page-again" | null {
  const again = loadedThisPage.has(id);
  loadedThisPage.add(id);
  let earlier: string[] = [];
  try {
    const saved = JSON.parse(worldSessionStorage.getItem(LOADED_KEY) ?? "[]");
    if (Array.isArray(saved))
      earlier = saved.filter((entry) => typeof entry === "string");
    worldSessionStorage.setItem(
      LOADED_KEY,
      JSON.stringify(
        [...earlier.filter((entry) => entry !== id), id].slice(-LOADED_LIMIT),
      ),
    );
  } catch {
    // Storage off: a reloaded page can't tell, and says nothing.
  }
  if (again) return "page-again";
  return earlier.includes(id) ? "page" : null;
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

/** A refusal and the IDE it was for: another IDE chosen clears it. */
type ProjectRefusal = { provider: IdeProviderId; refusal: IdeRefusal };

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
  /** Opens an agent's Inspector at its chat history. */
  onOpenAgent: (id: string, view: "history") => unknown;
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
  const [refusals, setRefusals] = useState<Record<string, ProjectRefusal>>({});
  const [opening, setOpening] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [stopping, setStopping] = useState<IdeInstance | null>(null);
  const [serversOpen, setServersOpen] = useState(false);
  // The IDE list (Enable, Disable, Connect): the way back from any failure.
  const [idesOpen, setIdesOpen] = useState(false);
  const running = runningIdeServers(ide.status);
  // Workbenches loaded on this page stay loaded while another project is
  // in front, and while World reattaches to their server (its connection
  // changed, World restarted): the frame keeps its page and VS Code
  // reconnects on its own, so nothing reloads (#1262). Only Stop, or a
  // server that failed or is gone, lets its frame go.
  const [visited, setVisited] = useState<string[]>([]);
  const noted = useRef(new Set<string>());
  // A workbench that loaded again, and why, until dismissed.
  const [reloaded, setReloaded] = useState<{
    id: string;
    why: "page" | "page-again";
  } | null>(null);
  const selectId = useId();

  const providers = ide.status?.providers ?? [];
  const enabledProviders = providers.filter(usable);
  const [providerChoice, setProviderChoice] = useState<string | null>(null);
  const provider =
    enabledProviders.find((entry) => entry.id === providerChoice) ??
    enabledProviders[0] ??
    null;
  // One server per IDE and folder. An IDE the owner picked shows its own
  // server, or Open; else whichever one runs. Another IDE's failed server
  // never stands in front of the IDE that would open.
  const projectInstances = project
    ? instances.filter(
        (entry) =>
          entry.connectionId === project.connectionId &&
          entry.folder === project.folder,
      )
    : [];
  const picked = provider !== null && provider.id === providerChoice;
  const instance =
    projectInstances.find(
      (entry) => entry.state !== "failed" && entry.provider === provider?.id,
    ) ??
    (picked
      ? undefined
      : projectInstances.find((entry) => entry.state !== "failed")) ??
    projectInstances.find((entry) => entry.provider === provider?.id);
  const refused = project ? refusals[project.key] : undefined;
  const refusal =
    refused && refused.provider === provider?.id ? refused.refusal : undefined;
  // Where the project is, as plainly as World knows it.
  const computer = project ? computerName(project, local) : "";
  // Microsoft's VS Code can't connect from a plain-HTTP address: World
  // says so instead of a workbench that waits forever.
  const insecureFor = (id: string | undefined) =>
    secure
      ? undefined
      : providers.find((entry) => entry.id === id && entry.needsSecurePage);
  const insecure = insecureFor(instance?.provider ?? provider?.id);

  useEffect(() => {
    if (
      instance?.state !== "ready" ||
      insecure ||
      visited.includes(instance.id)
    )
      return;
    // Once per frame: StrictMode runs an effect twice.
    if (!noted.current.has(instance.id)) {
      noted.current.add(instance.id);
      const why = noteLoaded(instance.id);
      setReloaded(why ? { id: instance.id, why } : null);
    }
    setVisited((current) =>
      current.includes(instance.id) ? current : [...current, instance.id],
    );
  }, [instance?.id, instance?.state, insecure, visited]);

  // A server that failed or is no longer listed lets its frame go: a new
  // start loads afresh, and the screen before said why.
  const listed = ide.status?.instances;
  useEffect(() => {
    if (!listed) return;
    for (const id of noted.current)
      if (!listed.some((entry) => entry.id === id && entry.state !== "failed"))
        noted.current.delete(id);
    setVisited((current) => {
      const next = current.filter((id) =>
        listed.some((entry) => entry.id === id && entry.state !== "failed"),
      );
      return next.length === current.length ? current : next;
    });
  }, [listed]);

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
          [target.key]: { provider: using.id, refusal: result.refusal },
        }));
      await ide.reload();
    } catch (cause) {
      setOpenError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOpening(null);
    }
  };

  /**
   * Try again where nothing was opened (the secure-address screen): read
   * the IDEs again, so a change made elsewhere (another IDE enabled in
   * Settings, World opened over HTTPS in a new tab) shows here.
   */
  const checkAgain = async () => {
    setChecking(true);
    try {
      await ide.reload(true);
    } finally {
      setChecking(false);
    }
  };

  /** Opens the IDE list over the view; the failure stays beneath it. */
  const chooseIde = () => {
    setServersOpen(false);
    setIdesOpen(true);
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

  const keptFrames = instances.filter(
    (entry) =>
      entry.state !== "failed" &&
      visited.includes(entry.id) &&
      !insecureFor(entry.provider),
  );
  const showingFrame = instance?.state === "ready" && !insecure;
  const reloadNote =
    showingFrame && reloaded?.id === instance.id ? reloaded.why : null;

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
        {ide.status ? (
          <button
            type="button"
            className="code-view-bar-action"
            aria-expanded={idesOpen}
            title="Enable, disable or connect an IDE"
            onClick={() => {
              setServersOpen(false);
              setIdesOpen(!idesOpen);
            }}
          >
            <Blocks size={13} aria-hidden />
            <span>IDEs</span>
          </button>
        ) : null}
        {running.length ? (
          <button
            type="button"
            className="code-view-bar-action"
            aria-expanded={serversOpen}
            title="IDE servers World started that still run"
            onClick={() => {
              setIdesOpen(false);
              setServersOpen(!serversOpen);
            }}
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
                // Show this server: its project and its IDE, so a picked
                // IDE without a server doesn't stand in front of it.
                const target = projectOf(entry);
                if (target) choose(target.key);
                setProviderChoice(entry.provider);
                setServersOpen(false);
              }}
            />
          </section>
        ) : null}
        {idesOpen && ide.status ? (
          <section
            className="code-view-servers code-view-ides"
            aria-label="IDEs"
          >
            <div className="code-view-servers-head">
              <h2>IDEs</h2>
              <CloseButton onClick={() => setIdesOpen(false)} />
            </div>
            <p className="code-view-muted">
              Enable the one to open projects with. World never installs one:
              each opens only on a computer where it is installed.
            </p>
            <IdeProviderList
              status={ide.status}
              client={client}
              onStatus={ide.apply}
              onEnabled={(id) => setProviderChoice(id)}
            />
          </section>
        ) : null}
        <section className="code-view-stage" aria-label="IDE">
          {keptFrames.map((entry) => {
            // Behind: hidden in place at full size, keeping its layout.
            const front = showingFrame && entry.id === instance.id;
            return (
              <iframe
                key={entry.id}
                className="code-view-frame"
                data-front={front ? "true" : "false"}
                aria-hidden={front ? undefined : true}
                tabIndex={front ? undefined : -1}
                src={entry.url}
                title={`${providerLabel(entry)} — ${displayFolder(entry.folder)}`}
                style={{ colorScheme: theme }}
                allow="clipboard-read; clipboard-write"
              />
            );
          })}
          {reloadNote && instance ? (
            <p className="code-view-reloaded" role="status">
              <span>
                {reloadNote === "page"
                  ? `This page reloaded, so ${providerLabel(instance)} loaded again. Its server kept running.`
                  : `${providerLabel(instance)} loaded again: its server started again, or World reopened the Code view.`}
              </span>
              <CloseButton onClick={() => setReloaded(null)} />
            </p>
          ) : null}
          {showingFrame ? null : (
            <div className="code-view-panel">{panel()}</div>
          )}
        </section>
        {project && railOpen ? (
          <ProjectContext
            id={railId}
            project={project}
            onOpenAgent={(id) => onOpenAgent(id, "history")}
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
    if (!provider) return "integration";
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
          {openError ? (
            <p className="code-view-error" role="alert">
              {openError}
            </p>
          ) : null}
          <IdeProviderList
            status={ide.status}
            client={client}
            onStatus={ide.apply}
            onEnabled={(id) => setProviderChoice(id)}
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
    if (insecure)
      return (
        <InsecurePage
          label={insecure.label}
          computer={computer}
          busy={checking}
          onRetry={() => void checkAgain()}
          onChoose={chooseIde}
        />
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
          {visited.includes(instance.id) ? (
            <p className="code-view-muted">
              Its open editors and unsaved changes stay as they are: VS Code
              reconnects when World attaches again.
            </p>
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
          <h2>
            {providerLabel(instance)} stopped on {computer}
          </h2>
          <p role="alert">{instance.reason ?? "The server exited."}</p>
          <FailureActions
            busy={opening !== null || project.stale}
            onRetry={() => void open(project)}
            onChoose={chooseIde}
          />
          {openError ? (
            <p className="code-view-error" role="alert">
              {openError}
            </p>
          ) : null}
        </div>
      );
    if (refusal)
      return (
        <Refusal
          refusal={refusal}
          project={project}
          computer={computer}
          ideLabel={provider.label}
          busy={opening !== null}
          onRetry={() => void open(project)}
          onShowServers={() => setServersOpen(true)}
          onChoose={chooseIde}
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
          <>
            <p className="code-view-error" role="alert">
              World couldn't open {provider.label} on {computer}: {openError}
            </p>
            <FailureActions onChoose={chooseIde} />
          </>
        ) : null}
      </div>
    );
  }
}

/**
 * The way on from a failure: the same again, and back to the IDE list to
 * choose another IDE or option. Try again is left out only where the screen
 * already has it (Open).
 */
function FailureActions({
  busy = false,
  onRetry,
  onChoose,
}: {
  busy?: boolean;
  onRetry?: () => void;
  onChoose?: () => void;
}) {
  return (
    <div className="code-view-detached-actions">
      {onRetry ? (
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={onRetry}
        >
          Try again
        </button>
      ) : null}
      {onChoose ? (
        <button type="button" onClick={onChoose}>
          <Blocks size={13} aria-hidden /> Choose another IDE
        </button>
      ) : null}
    </div>
  );
}

function InsecurePage({
  label,
  computer,
  busy,
  onRetry,
  onChoose,
}: {
  label: string;
  computer: string;
  busy: boolean;
  /** Checks again: this address stays plain HTTP until World is opened on HTTPS. */
  onRetry: () => void;
  onChoose: () => void;
}) {
  return (
    <div className="code-view-refusal" data-code="insecure-page">
      <h2>{label} needs a secure address</h2>
      <p role="alert">
        It can run on {computer}, but this browser can't show it here.
        Microsoft's VS Code connects only from a page served over HTTPS, or at
        localhost on the computer World runs on. This page is plain HTTP at{" "}
        {window.location.host}, so it would never finish opening.
      </p>
      <p>
        Open World over HTTPS instead: give World a certificate, or put it
        behind an HTTPS proxy such as <code>tailscale serve</code>. On the
        computer World runs on, localhost works too. code-server and OpenVSCode
        Server work on this address: choose one of them instead.
      </p>
      <FailureActions busy={busy} onRetry={onRetry} onChoose={onChoose} />
    </div>
  );
}

/** Named so a phone user knows which computer: World's own, or the host's. */
function computerName(project: CodeProject, local: Set<string>) {
  if (!local.has(project.connectionId)) return project.hostLabel;
  return /^(local|this computer)$/i.test(project.hostLabel)
    ? "the computer World runs on"
    : `${project.hostLabel}, the computer World runs on`;
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
  project,
  computer,
  ideLabel,
  busy,
  onRetry,
  onShowServers,
  onChoose,
}: {
  refusal: IdeRefusal;
  project: CodeProject;
  /** The project's computer, as plainly as World knows it. */
  computer: string;
  /** The IDE refused. */
  ideLabel: string;
  busy: boolean;
  onRetry: () => void;
  /** The cap: World stops none to make room; show the running ones. */
  onShowServers: () => void;
  /** Opens the IDE list. */
  onChoose: () => void;
}) {
  return (
    <div className="code-view-refusal" data-code={refusal.code}>
      <h2>
        {refusal.code === "limit"
          ? "Too many IDEs are running"
          : refusal.code === "missing"
            ? `${ideLabel} isn't installed on ${computer}`
            : `World can't open ${project.label} in ${ideLabel} on ${computer}`}
      </h2>
      <p role="alert">{refusal.message}</p>
      {refusal.code === "missing" ? (
        <p className="code-view-muted">
          World never installs an IDE. Install it on {project.hostLabel} and try
          again, or choose another IDE.
        </p>
      ) : null}
      {refusal.code === "limit" ? (
        <button type="button" onClick={onShowServers}>
          Show running servers
        </button>
      ) : null}
      <FailureActions busy={busy} onRetry={onRetry} onChoose={onChoose} />
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
