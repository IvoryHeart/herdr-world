import { ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { ShipyardInstance } from "../../../../shared/shipyard";
import { openIntegrations } from "../../integrations";
import {
  instanceWords,
  runningCount,
  shipyardAge,
  shipyardDate,
  shipyardView,
  shortSha,
  workflowWords,
  type ShipyardShip,
  type ShipyardView,
} from "./shipyardModel";
import { shipyardLanes, shipyardStore, useShipyard } from "./shipyardStore";
import "./shipyard.css";

/**
 * The release pipeline (#1028), left to right as work ships: main's
 * checks, the changes merged and waiting for the next release, the
 * releases shipped, and the Worlds running here. Board shows it as the Work
 * lens's Releases tab; Town's harbour opens the same tab. Links open
 * GitHub or a running World in a new tab; World never releases, tags or
 * deploys from here.
 */
export function ShipyardPipeline() {
  const state = useShipyard();
  const now = useMinute();
  const view = shipyardView(state, now);
  return (
    <div className="shipyard" aria-label="Release pipeline">
      <ShipyardHead view={view} state={state} now={now} />
      <div className="shipyard-stages">
        {view.status === "open" ? (
          <>
            <MainStage view={view} />
            <CargoStage view={view} />
            <ShipsStage view={view} now={now} />
          </>
        ) : view.status === "loading" ? null : (
          <section className="shipyard-stage shipyard-closed">
            <h3>GitHub</h3>
            <p className="shipyard-note">{closedWords(view)}</p>
            {view.status === "off" || view.status === "closed" ? (
              <button
                type="button"
                className="shipyard-setup"
                onClick={() => openIntegrations("source:github")}
              >
                Connect GitHub
              </button>
            ) : null}
          </section>
        )}
        {view.status === "loading" || view.status === "unreachable" ? null : (
          <RunningStage running={view.running} note={view.runningNote} />
        )}
      </div>
    </div>
  );
}

/** Re-render every minute, so ages and "today" stay true. */
function useMinute() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function closedWords(view: ShipyardView) {
  switch (view.status) {
    case "unreachable":
      return `World did not answer: ${view.detail}`;
    case "no_repo":
      return "No project open in World has a GitHub repository. Open one in a room, or type a repository above.";
    case "reading":
    case "off":
    case "closed":
      return view.detail;
    default:
      return "";
  }
}

function ShipyardHead({
  view,
  state,
  now,
}: {
  view: ShipyardView;
  state: ReturnType<typeof useShipyard>;
  now: number;
}) {
  // The open projects' repositories, and one typed while it is chosen.
  const options = state.catalog
    ? shipyardLanes(state.catalog, state.manual)
    : state.repo
      ? [state.repo]
      : [];
  const local = (state.catalog?.projects ?? []).filter(
    (project) => !project.repo,
  );
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const refreshing = view.status === "open" && view.refreshing;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      void shipyardStore.choose(draft.trim(), true);
      setTyping(false);
      setDraft("");
      setError(null);
    } catch {
      setError("Use owner/repository, as on github.com.");
    }
  };
  return (
    <header className="shipyard-head">
      {typing || (!options.length && state.catalog) ? (
        <form className="shipyard-repo-form" onSubmit={submit}>
          <input
            aria-label="GitHub repository"
            placeholder="owner/repository"
            value={draft}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" disabled={!draft.trim()}>
            Show
          </button>
          {options.length ? (
            <button type="button" onClick={() => setTyping(false)}>
              Cancel
            </button>
          ) : null}
          {error ? (
            <span className="shipyard-error" role="alert">
              {error}
            </span>
          ) : null}
        </form>
      ) : options.length ? (
        <label className="shipyard-repo">
          <span>Repository</span>
          <select
            value={state.repo ?? ""}
            onChange={(event) => {
              if (event.target.value === "\u0000other") setTyping(true);
              else void shipyardStore.choose(event.target.value);
            }}
          >
            {options.map((repo) => (
              <option key={repo} value={repo}>
                {repo === state.manual &&
                !state.catalog?.repositories.includes(repo)
                  ? `${repo} (typed)`
                  : repo}
              </option>
            ))}
            {local.map((project) => (
              <option key={`local:${project.name}`} disabled>
                {`${project.name} (no GitHub remote)`}
              </option>
            ))}
            <option value={"\u0000other"}>Another repository…</option>
          </select>
        </label>
      ) : null}
      <span className="shipyard-age" role="status">
        {view.status === "open"
          ? refreshing
            ? "Reading GitHub…"
            : view.stale
              ? `Out of date · last read ${shipyardAge(view.lastSuccessAt, now)}`
              : `Read ${shipyardAge(view.lastSuccessAt, now)}`
          : view.status === "loading"
            ? "Opening…"
            : ""}
      </span>
      {state.repo ? (
        <button
          type="button"
          className="shipyard-refresh"
          aria-label="Read GitHub again"
          title="Read GitHub again"
          disabled={refreshing}
          onClick={() => void shipyardStore.read(true)}
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      ) : null}
      {view.status === "open" && view.stale ? (
        <p className="shipyard-stale">{view.detail}</p>
      ) : null}
      <ProjectsNote state={state} />
    </header>
  );
}

/**
 * What the lanes leave out, said rather than dropped (#1226): open
 * projects without a GitHub remote, and open folders past World's limit.
 */
function ProjectsNote({ state }: { state: ReturnType<typeof useShipyard> }) {
  const catalog = state.catalog;
  if (!catalog) return null;
  const local = catalog.projects.filter((project) => !project.repo);
  const parts: string[] = [];
  if (local.length)
    parts.push(
      `No GitHub remote: ${local.map((project) => project.name).join(", ")}.`,
    );
  if (catalog.omitted)
    parts.push(
      `${catalog.omitted} more open folder${catalog.omitted === 1 ? " was" : "s were"} not read (World reads ${catalog.limits.repositories}); choose Another repository… to see one.`,
    );
  if (catalog.pending)
    parts.push(
      `Reading ${catalog.pending} open folder${catalog.pending === 1 ? "" : "s"}…`,
    );
  return parts.length ? (
    <p className="shipyard-projects-note">{parts.join(" ")}</p>
  ) : null;
}

function Link({ href, children }: { href: string; children: string }) {
  return (
    <a
      className="shipyard-link"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
      <ExternalLink size={12} aria-hidden="true" />
    </a>
  );
}

type Open = Extract<ShipyardView, { status: "open" }>;

function MainStage({ view }: { view: Open }) {
  const { main } = view;
  return (
    <section
      className="shipyard-stage"
      data-stage="main"
      aria-label="Main branch"
    >
      <h3>
        <span className="shipyard-beacon" data-tone={main.beacon} />
        Main
      </h3>
      <p className="shipyard-lead" data-tone={main.beacon}>
        {main.words}
      </p>
      <p className="shipyard-meta">
        head <code>{shortSha(main.sha)}</code>
      </p>
      {main.workflows.length ? (
        <ul className="shipyard-list">
          {main.workflows.map((run) => {
            const { tone, words } = workflowWords(run);
            return (
              <li key={run.id}>
                <span
                  className="shipyard-dot"
                  data-tone={view.stale ? "unknown" : tone}
                />
                <a href={run.url} target="_blank" rel="noopener noreferrer">
                  {run.name}
                </a>
                <span className="shipyard-soft">{words}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="shipyard-note">No workflow runs on this commit.</p>
      )}
      {main.note ? <p className="shipyard-note">{main.note}</p> : null}
      <Link href={main.url}>Workflow runs</Link>
    </section>
  );
}

function CargoStage({ view }: { view: Open }) {
  const { cargo } = view;
  return (
    <section
      className="shipyard-stage"
      data-stage="waiting"
      aria-label="Waiting to ship"
    >
      <h3>
        <span className="shipyard-crate" />
        Waiting to ship
      </h3>
      <p className="shipyard-lead">
        {cargo.count}
        {cargo.since ? (
          <span className="shipyard-soft"> {cargo.since}</span>
        ) : null}
      </p>
      {cargo.pullRequests.length ? (
        <ul className="shipyard-list">
          {cargo.pullRequests.map((pr) => (
            <li key={pr.number}>
              <span className="shipyard-crate" />
              <a href={pr.url} target="_blank" rel="noopener noreferrer">
                <b>#{pr.number}</b> {pr.title}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {cargo.commits ? (
        <p className="shipyard-meta">
          {cargo.commits} commit{cargo.commits === 1 ? "" : "s"} on main in all
        </p>
      ) : null}
      {cargo.note ? <p className="shipyard-note">{cargo.note}</p> : null}
      <div className="shipyard-links">
        <Link href={cargo.pullRequestsUrl}>Merged pull requests</Link>
        {cargo.compareUrl ? <Link href={cargo.compareUrl}>Compare</Link> : null}
      </div>
    </section>
  );
}

function ShipsStage({ view, now }: { view: Open; now: number }) {
  return (
    <section
      className="shipyard-stage"
      data-stage="shipped"
      aria-label="Shipped releases"
    >
      <h3>
        <span className="shipyard-hull" />
        Shipped
      </h3>
      {view.ships.length ? (
        <ul className="shipyard-ships">
          {view.ships.map((ship) => (
            <ShipRow key={ship.release.id} ship={ship} now={now} />
          ))}
        </ul>
      ) : (
        <p className="shipyard-note">No published releases yet.</p>
      )}
      {view.shipsNote ? (
        <p className="shipyard-note">{view.shipsNote}</p>
      ) : null}
    </section>
  );
}

/** One release: its version, channel, date and where it runs. */
export function ShipRow({ ship, now }: { ship: ShipyardShip; now: number }) {
  const { release } = ship;
  return (
    <li className="shipyard-ship" data-channel={release.channel}>
      <a href={release.url} target="_blank" rel="noopener noreferrer">
        <b>{release.tag}</b>
        <ExternalLink size={12} aria-hidden="true" />
      </a>
      <span className="shipyard-chip" data-channel={release.channel}>
        {release.channel === "stable" ? "stable" : "prerelease"}
      </span>
      <span className="shipyard-soft">
        {shipyardDate(release.publishedAt, now)}
      </span>
      {ship.baseline ? (
        <span className="shipyard-chip" data-baseline>
          latest
        </span>
      ) : null}
      {ship.running.length ? (
        <span className="shipyard-berths">
          {ship.running.map((instance) => (
            <span key={instance.id} data-state={instance.state}>
              port {instance.port}
            </span>
          ))}
        </span>
      ) : null}
    </li>
  );
}

function RunningStage({
  running,
  note,
}: {
  running: ShipyardInstance[];
  note: string | null;
}) {
  return (
    <section
      className="shipyard-stage"
      data-stage="running"
      aria-label="Running Worlds"
    >
      <h3>
        <span className="shipyard-berth" />
        Running
      </h3>
      <p className="shipyard-lead">
        {running.length ? runningCount(running) : "none reported"}
      </p>
      {running.length ? (
        <ul className="shipyard-list">
          {running.map((instance) => {
            const words = instanceWords(instance);
            return (
              <li key={instance.id} data-state={instance.state}>
                <span
                  className="shipyard-dot"
                  data-tone={instance.state === "fresh" ? "pass" : "unknown"}
                />
                <span className="shipyard-instance">
                  <b>{words.name}</b>
                  <span className="shipyard-soft">
                    {words.what} · {words.state}
                  </span>
                </span>
                {instance.openUrl ? (
                  <a
                    className="shipyard-open"
                    href={instance.openUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open World ${words.name}`}
                  >
                    Open
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="shipyard-note">
          Worlds on this computer show here while they run.
        </p>
      )}
      {note ? <p className="shipyard-note">{note}</p> : null}
      {running.some((instance) => instance.openUrl) ? (
        <p className="shipyard-note">
          Open works on the computer running World.
        </p>
      ) : null}
    </section>
  );
}
