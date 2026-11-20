import { Plus, RefreshCw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { bridge } from "../api";
import type { CoreInstallHost } from "../coreInstall";
import type { HostCatalogueEntry } from "../hostGroups";
import {
  type IntegrationEntry,
  type IntegrationsSnapshot,
  matchesTerms,
} from "../integrations";
import { useStoreSelector } from "../store";
import type { RunIntegrationTask } from "../world/SourceFields";
import { CoreInstallPanel } from "./CoreInstall";

type IntegrationHost = NonNullable<IntegrationsSnapshot["hosts"]>[number];

/**
 * Where herdr-core's installer runs for a host of the catalogue: this
 * computer, or a saved non-Windows SSH host (with or without runtimes yet).
 * World's installer has no remote Windows steps, so those hosts get the
 * manual hint instead.
 */
export function coreInstallTarget(
  entry: HostCatalogueEntry | undefined,
): CoreInstallHost | null {
  if (!entry) return null;
  if (entry.type === "local") return { type: "local" };
  return entry.sshDestination && !entry.windows
    ? { type: "ssh", destination: entry.sshDestination }
    : null;
}

/**
 * Add a runtime to one host: what it could still run, each with its way in.
 * herdr-core installs from here (confirmed first); Herdr's TUI is installed
 * and started on the machine, then World looks again and connects it.
 */
function AddRuntime({
  host,
  entry,
  busy,
  run,
}: {
  host: IntegrationHost;
  entry: HostCatalogueEntry | undefined;
  busy: boolean;
  run: RunIntegrationTask;
}) {
  const [installing, setInstalling] = useState(false);
  const target = coreInstallTarget(entry);
  const lookAgain = () =>
    void run(
      `host:${host.host_id}`,
      () => bridge.call("connections.discover_host", { host_id: host.host_id }),
      `Looked for runtimes on ${host.label}.`,
    );
  if (installing && target)
    return (
      <div className="integrations-add-runtime">
        <CoreInstallPanel
          host={target}
          onClose={() => {
            setInstalling(false);
            lookAgain();
          }}
        />
      </div>
    );
  return (
    <div
      className="integrations-add-runtime"
      role="group"
      aria-label={`Add a runtime to ${host.label}`}
    >
      {host.available_runtimes.length ? (
        <ul>
          {host.available_runtimes.map((choice) => (
            <li key={choice.kind} data-runtime-choice={choice.kind}>
              <strong>{choice.label}</strong>
              {choice.kind === "herdr-core" ? (
                target ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setInstalling(true)}
                  >
                    Install herdr-core…
                  </button>
                ) : (
                  <span>
                    Install herdr-core on the machine, then look again.
                  </span>
                )
              ) : choice.kind === "herdr" ? (
                <span>
                  Install Herdr on {host.label} and start it, then look again.
                </span>
              ) : (
                <span>Install it on the machine, then look again.</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="integrations-empty">
          Every runtime World knows already runs here.
        </p>
      )}
      <button type="button" disabled={busy} onClick={lookAgain}>
        <RefreshCw size={14} aria-hidden="true" /> Look again
      </button>
    </div>
  );
}

/**
 * Runtimes, one heading per machine: each host lists the runtimes found on
 * it and can add another. Runtime rows keep their own Connect or Disconnect.
 * A runtime the service does not place on a host is listed after the hosts.
 */
export function RuntimeHosts({
  hosts,
  rows,
  terms,
  rowFor,
  open,
  toggle,
  busy,
  run,
}: {
  hosts: readonly IntegrationHost[];
  /** The runtime rows the search leaves. */
  rows: readonly IntegrationEntry[];
  terms: readonly string[];
  rowFor(entry: IntegrationEntry): ReactNode;
  open: ReadonlySet<string>;
  toggle(id: string): void;
  busy: boolean;
  run: RunIntegrationTask;
}) {
  const catalogue = useStoreSelector((state) => state.hostCatalogue);
  const placed = new Set<string>();
  const sections = hosts.flatMap((host) => {
    const ids = new Set(
      host.runtimes.map(({ connection_id }) => `runtime:${connection_id}`),
    );
    const held = rows.filter((row) => ids.has(row.id));
    for (const row of held) placed.add(row.id);
    if (terms.length && !held.length && !matchesTerms(terms, [host.label]))
      return [];
    const key = `host:${host.host_id}`;
    const adding = open.has(key);
    return [
      <section
        key={host.host_id}
        className="integrations-host"
        data-integration={key}
        aria-label={host.label}
      >
        <h4>{host.label}</h4>
        {held.length ? (
          <ul className="integrations-list">{held.map(rowFor)}</ul>
        ) : (
          <p className="integrations-empty">No runtime found on this host.</p>
        )}
        {terms.length ? null : (
          <>
            <button
              type="button"
              className="ghost"
              aria-expanded={adding}
              aria-label={`Add a runtime to ${host.label}`}
              onClick={() => toggle(key)}
            >
              <Plus size={14} aria-hidden="true" /> Add a runtime
            </button>
            {adding ? (
              <AddRuntime
                host={host}
                entry={catalogue?.find((entry) => entry.id === host.host_id)}
                busy={busy}
                run={run}
              />
            ) : null}
          </>
        )}
      </section>,
    ];
  });
  const rest = rows.filter((row) => !placed.has(row.id));
  return (
    <>
      {sections}
      {rest.length ? (
        <ul className="integrations-list">{rest.map(rowFor)}</ul>
      ) : null}
    </>
  );
}
