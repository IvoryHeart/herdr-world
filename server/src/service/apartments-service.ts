import type { ApartmentLink } from "../../../shared/apartments";
import type { WorldSourcesSnapshot } from "../../../shared/worldSources";
import type { AgentSessionFileAccess } from "../agent/session-file-access";
import type { ApartmentsPort } from "../storage/apartments";
import { ApartmentCensus } from "../world/apartment-census";
import { readApartmentHistory } from "../world/apartment-history";
import { type ApartmentTenant, WorldApartments } from "../world/apartments";
import type { Complete, Fresh } from "../world/snapshot-observers";

type Status = { id: string; label: string };
type Manager<Lease> = {
  has(id: string): boolean;
  list(): Status[];
  readyRuntimeLease(id: string): Lease | null | undefined;
};
type TuiLease = { runtime: { agentSessionFiles: AgentSessionFileAccess } };
type CoreLease = object;
type CoreHost = {
  agentSessionFiles: AgentSessionFileAccess;
  /** Chat's sessions for this host (herdr-core/agent-sessions.ts). */
  agentSessions(): {
    knownSession(
      address: string,
      agent: string,
    ): Promise<{ id: string | null; holder: string } | null>;
  };
};

/**
 * Apartments' composition: the tracker (world/apartments.ts) with the
 * host labels, linked work, transcript files and core launch sessions it
 * reads from the rest of the service.
 */
export function createApartmentsService<Core extends CoreLease>(deps: {
  port: ApartmentsPort | undefined;
  now(): number;
  tui(): Manager<TuiLease>;
  core(): {
    manager: Manager<Core>;
    hostRuntime(lease: Core): CoreHost;
  } | null;
  sources?(): WorldSourcesSnapshot | null;
  publish(revision: number): void;
  log(message: string): void;
}) {
  const coreLease = (id: string) => {
    const core = deps.core();
    return core?.manager.has(id)
      ? { core, lease: core.manager.readyRuntimeLease(id) ?? null }
      : null;
  };
  /** The host's transcript files, while it is connected. */
  const files = (connectionId: string): AgentSessionFileAccess | null => {
    const tui = deps.tui();
    if (tui.has(connectionId))
      return (
        tui.readyRuntimeLease(connectionId)?.runtime.agentSessionFiles ?? null
      );
    const found = coreLease(connectionId);
    return found?.lease
      ? found.core.hostRuntime(found.lease).agentSessionFiles
      : null;
  };
  const links = (tenant: ApartmentTenant): ApartmentLink[] => {
    const snapshot = deps.sources?.();
    if (!snapshot) return [];
    const items = new Map(snapshot.items.map((item) => [item.key, item]));
    const found: ApartmentLink[] = [];
    for (const link of snapshot.links) {
      if (
        link.connectionId !== tenant.connection_id ||
        link.generation !== tenant.generation ||
        link.paneId !== tenant.pane_id
      )
        continue;
      const item = items.get(link.itemKey);
      if (!item || item.kind === "ticket" || !item.number) continue;
      found.push({
        kind: item.kind === "pull_request" ? "pr" : "issue",
        number: item.number,
        ...(item.repo ? { repo: item.repo } : {}),
        ...(/^https:\/\//.test(item.url) ? { url: item.url } : {}),
        ...(item.title ? { title: item.title } : {}),
      });
    }
    return found;
  };
  const host = (
    id: string,
  ): { label: string; runtime: "herdr" | "herdr-core" } => {
    const tui = deps.tui();
    if (tui.has(id))
      return {
        label: tui.list().find((status) => status.id === id)?.label ?? id,
        runtime: "herdr",
      };
    const core = deps.core();
    return {
      label:
        core?.manager.list().find((status) => status.id === id)?.label ?? id,
      runtime: "herdr-core",
    };
  };
  const apartments = new WorldApartments({
    port: deps.port,
    now: deps.now,
    host,
    // The session Chat knows for a live core agent: a linked Codex session,
    // Claude's process record or the launch arguments. Herdr (TUI) rows
    // carry their own.
    session: async (connectionId, terminalId, harness) => {
      const found = coreLease(connectionId);
      if (!found?.lease) return null;
      return found.core
        .hostRuntime(found.lease)
        .agentSessions()
        .knownSession(terminalId, harness);
    },
    links,
    lastReport: async (tenant) => {
      const access = tenant.session_id ? files(tenant.connection_id) : null;
      if (!access) return null;
      return (
        await readApartmentHistory(
          {
            harness: tenant.harness,
            session_id: tenant.session_id,
            cwd: tenant.cwd,
          },
          access,
        )
      ).report;
    },
    publish: deps.publish,
    log: deps.log,
  });
  // Every agent not running now, from the histories each host keeps.
  const census = deps.port
    ? new ApartmentCensus({
        files,
        host,
        residents: () => deps.port?.list() ?? [],
        live: () => apartments.liveSessions(),
        found: (residents) => apartments.found(residents),
        now: deps.now,
        log: deps.log,
      })
    : null;

  return {
    apartments,
    census,
    /** A snapshot's fresh observer that also tells Apartments who is at a desk. */
    fresh(observer: Fresh): Fresh {
      return (...args) => {
        observer(...args);
        apartments.fresh(...args);
        census?.request(args[0]);
      };
    },
    /** Before World's storage closes: no more census or move-ins. */
    async stop() {
      await census?.stop();
      await apartments.stop();
    },
    /** A complete pane list's observer that also moves ended agents out. */
    complete(observer: Complete): Complete {
      return (...args) => {
        observer(...args);
        apartments.complete(...args);
      };
    },
    /** A resident's conversation, read from its host while it is connected. */
    async history(id: string) {
      const resident = apartments.get(id);
      if (!resident) throw new Error("That resident has moved out.");
      const access = files(resident.connection_id);
      if (!access)
        return {
          status: "unavailable" as const,
          detail: `Connect ${resident.connection_label} to read this agent's history.`,
          messages: [],
          truncated: false,
          report: resident.last_report,
        };
      const history = await readApartmentHistory(resident, access);
      return { ...history, report: history.report ?? resident.last_report };
    },
  };
}
export type ApartmentsService = ReturnType<typeof createApartmentsService>;
