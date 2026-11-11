import { CliError } from "./world-cli-errors";
import type { WorldCliRequest } from "./world-cli-protocol";
import { createHash } from "node:crypto";
import {
  paneRoots,
  type CallerLocator,
  type CallerProcess,
  type PaneProcessInfo,
} from "./caller-identity";
import type { CliActor } from "./world-ledger";

/** A ready, current Herdr runtime the service can call. */
export type CliHost = {
  connection_id: string;
  generation: number;
  /** The Herdr runs on this machine, so its processes can be checked. */
  local: boolean;
  call(
    method: string,
    params: Record<string, unknown>,
    beforeSend?: () => void,
  ): Promise<unknown>;
};

export function askSessionFingerprint(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const session = value as Record<string, unknown>;
  const fields = [session.source, session.agent, session.kind, session.value];
  if (!fields.every((part) => typeof part === "string" && part.length > 0))
    return undefined;
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

/** The program holding a herdr-core address now. */
export type CoreCliOccupant = {
  coreId: string;
  pid: number;
  foregroundPid: number | null;
  foreground?: { pid: number; name: string };
  /** `coreOccupantFingerprint`: core, address, pid, argv, template. */
  fingerprint: string;
};

export type CorePreparedDelivery = {
  connectionId: string;
  generation: number;
  isCurrent(): boolean;
  send(
    text: string,
    beforeSubmit: () => Promise<boolean>,
    authorized?: () => boolean,
  ): Promise<unknown>;
};

/** A ready, current herdr-core connection the CLI checks callers against. */
export type CoreCliHost = {
  connection_id: string;
  generation: number;
  /** The core runs on this machine, so its processes can be checked. */
  local: boolean;
  isCurrent(): boolean;
  coreId(): string | null;
  delivery?(
    address: string,
    fingerprint: string,
    foreground: { pid: number; name: string },
  ): CorePreparedDelivery | null;
  /** The live program at `address` (`tN`) on this core, or null. */
  occupant(address: string): CoreCliOccupant | null;
  /** World's read-model row for it: room, harness and name. */
  describe(
    address: string,
  ): Promise<{ workspace_id?: string; agent?: string; name?: string } | null>;
};

export type CoreCallerSource = {
  /** Whether a connection ID is a herdr-core connection, ready or not. */
  has(connectionId: string): boolean;
  hosts(): CoreCliHost[];
};

/** `HC_TERMINAL_ID`: core's 30-symbol alphabet, bounded for ledger labels. */
export const CORE_TERMINAL = /^t[1-9][0-9bcdfghjkmnpqrstvwxyz]{0,9}$/;

/**
 * How far up the caller's process chain `pids` first appears (0: the caller
 * itself), or null when none of them is the caller or an ancestor.
 */
function distanceTo(
  chain: readonly CallerProcess[],
  pids: ReadonlySet<number>,
): number | null {
  const index = chain.findIndex((entry) => pids.has(entry.pid));
  return index < 0 ? null : index;
}

/** A verified core caller's fields, bound to the program it runs under. */
export async function coreActor(
  host: CoreCliHost,
  address: string,
  occupant: CoreCliOccupant,
): Promise<CliActor> {
  const row = await host.describe(address).catch(() => null);
  return {
    label: `${row?.agent ?? "terminal"} in ${address}`,
    verified: true,
    connection_id: host.connection_id,
    connection_generation: host.generation,
    pane_id: address,
    terminal_id: address,
    agent_session_fingerprint: occupant.fingerprint,
    ...(row?.workspace_id ? { workspace_id: row.workspace_id } : {}),
    ...(row?.agent ? { agent: row.agent } : {}),
    ...(row?.name ? { name: row.name } : {}),
  };
}

/**
 * A caller inside a herdr-core terminal, verified (§4.10): on a local core
 * whose terminal `address` is live, the calling process (found from its
 * loopback connection) must run under that terminal's program. Addresses
 * repeat across cores (every core has a `t1`): only a core whose program at
 * that address is the caller's ancestor matches, and the nearest one wins.
 */
async function locateCoreCaller(
  hosts: readonly CoreCliHost[],
  address: string,
  locate: CallerLocator,
): Promise<
  { host: CoreCliHost; occupant: CoreCliOccupant; distance: number }[]
> {
  const found: {
    host: CoreCliHost;
    occupant: CoreCliOccupant;
    distance: number;
  }[] = [];
  for (const host of hosts) {
    if (!host.local || !host.isCurrent()) continue;
    const occupant = host.occupant(address);
    if (!occupant) continue;
    const roots = [occupant.pid, occupant.foregroundPid].filter(
      (pid): pid is number => typeof pid === "number" && pid > 1,
    );
    const chain = roots.length ? locate(roots) : null;
    // The terminal's own program must be the caller or its ancestor: a
    // foreground process alone (a shared group) is not enough.
    const distance = chain ? distanceTo(chain, new Set([occupant.pid])) : null;
    if (distance === null) continue;
    // Still the same program when the check finished.
    if (host.occupant(address)?.fingerprint !== occupant.fingerprint) continue;
    found.push({ host, occupant, distance });
  }
  return found;
}

/**
 * A caller that named no pane. Any process can leave HERDR_PANE_ID unset, so
 * this is not the owner, only a terminal that did not say where it runs.
 */
export const NO_PANE = "terminal with no pane";

/**
 * Who is calling. Without HERDR_PANE_ID or HC_TERMINAL_ID the caller is
 * unverified with no pane. With HERDR_PANE_ID, the claim is verified only
 * when the calling process runs in that pane of a local Herdr (searched for
 * among the pane's own processes). With HC_TERMINAL_ID, only when it runs
 * under that terminal's program on a local herdr-core. When both verify
 * (one runtime started inside the other), the runtime whose terminal is the
 * caller's nearest ancestor wins; a tie stays unverified. Otherwise the
 * claim is labelled unverified and acts on the default host.
 */
export async function identifyCaller(
  hosts: readonly CliHost[],
  paneId: string | undefined,
  locate: CallerLocator | null,
  core?: { terminal?: string; source: CoreCallerSource | null },
): Promise<{ actor: CliActor; host?: CliHost; distance?: number }> {
  const coreTerminal =
    core?.terminal && CORE_TERMINAL.test(core.terminal)
      ? core.terminal
      : undefined;
  if (!paneId && !coreTerminal)
    return { actor: { label: NO_PANE, verified: false } };
  const matches: {
    distance: number;
    resolve(): Promise<{ actor: CliActor; host?: CliHost; distance?: number }>;
  }[] = [];
  if (locate && paneId)
    for (const host of hosts) {
      if (!host.local) continue;
      const info = (
        (await host
          .call("pane.process_info", { pane_id: paneId })
          .catch(() => null)) as { process_info?: PaneProcessInfo } | null
      )?.process_info;
      const roots = paneRoots(info);
      const chain = roots.length ? locate(roots) : null;
      const distance = chain ? distanceTo(chain, new Set(roots)) : null;
      if (distance === null) continue;
      matches.push({
        distance,
        resolve: async () => ({
          actor: (await paneActor(host, paneId)).actor,
          host,
        }),
      });
      // A pane ID names one pane per Herdr; the first local match is it.
      break;
    }
  if (locate && coreTerminal && core?.source)
    for (const found of await locateCoreCaller(
      core.source.hosts(),
      coreTerminal,
      locate,
    ))
      matches.push({
        distance: found.distance,
        resolve: async () => ({
          actor: await coreActor(found.host, coreTerminal, found.occupant),
        }),
      });
  const nearest = Math.min(...matches.map((match) => match.distance));
  const winners = matches.filter((match) => match.distance === nearest);
  if (winners.length === 1)
    return { ...(await winners[0]!.resolve()), distance: nearest };
  if (paneId)
    return {
      actor: {
        label: `unverified ${paneId}`,
        verified: false,
        pane_id: paneId,
      },
    };
  return {
    actor: { label: `unverified herdr-core ${coreTerminal}`, verified: false },
  };
}

/**
 * The caller fields Herdr gives for a pane on `host`, as for a verified
 * caller there. Only an explicit native not-found response proves absence;
 * failed or malformed reads leave the observation unknown.
 */
export async function paneActor(
  host: CliHost,
  paneId: string,
): Promise<{ state: "present" | "absent" | "unknown"; actor: CliActor }> {
  let state: "present" | "absent" | "unknown" = "unknown";
  let pane: Record<string, unknown> | undefined;
  try {
    const candidate = (
      (await host.call("pane.get", { pane_id: paneId })) as {
        pane?: Record<string, unknown>;
      } | null
    )?.pane;
    if (
      candidate?.pane_id === paneId &&
      typeof candidate.terminal_id === "string" &&
      candidate.terminal_id
    ) {
      pane = candidate;
      state = "present";
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/^pane_not_found(?::|$)/.test(message)) state = "absent";
  }
  const agent = typeof pane?.agent === "string" ? pane.agent : undefined;
  return {
    state,
    actor: {
      label: `${agent ?? "terminal"} in ${paneId}`,
      verified: true,
      connection_id: host.connection_id,
      connection_generation: host.generation,
      pane_id: paneId,
      ...(typeof pane?.terminal_id === "string"
        ? { terminal_id: pane.terminal_id }
        : {}),
      ...(typeof pane?.workspace_id === "string"
        ? { workspace_id: pane.workspace_id }
        : {}),
      ...(typeof pane?.agent_session === "object" && pane.agent_session !== null
        ? {
            agent_session_fingerprint: askSessionFingerprint(
              pane.agent_session,
            ),
            ...(typeof (pane.agent_session as { value?: unknown }).value ===
            "string"
              ? {
                  agent_session_id: (pane.agent_session as { value: string })
                    .value,
                }
              : {}),
          }
        : {}),
      ...(agent ? { agent } : {}),
    },
  };
}

/** Verify both inherited runtime claims and choose the nearest ancestor PTY. */
export async function identifyWorldCaller(
  hosts: readonly CliHost[],
  caller: WorldCliRequest["caller"],
  locate: CallerLocator | null,
  identifyCore:
    | ((
        terminal: string,
        locate: CallerLocator | null,
      ) => Promise<{ actor: CliActor; distance: number } | undefined>)
    | undefined,
  source?: CoreCallerSource | null,
): Promise<{ actor: CliActor; host?: CliHost }> {
  const usage = (message: string): never => {
    throw new CliError("usage", message);
  };
  const paneId =
    typeof caller?.pane_id === "string" && caller.pane_id.trim()
      ? caller.pane_id.trim()
      : undefined;
  if (
    paneId !== undefined &&
    !/^[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{1,32}$/.test(paneId)
  )
    usage("HERDR_PANE_ID is not a Herdr pane ID");
  const coreTerminal = caller?.core_terminal_id ?? caller?.core_terminal;
  if (
    coreTerminal !== undefined &&
    (typeof coreTerminal !== "string" || !CORE_TERMINAL.test(coreTerminal))
  )
    usage("HC_TERMINAL_ID is not a core terminal ID");
  if (source || caller?.core_terminal !== undefined)
    return identifyCaller(hosts, paneId, locate, {
      terminal: typeof coreTerminal === "string" ? coreTerminal : undefined,
      source: source ?? null,
    });
  const core =
    typeof coreTerminal === "string"
      ? await identifyCore?.(coreTerminal, locate)
      : undefined;
  const tui = await identifyCaller(hosts, paneId, locate);
  if (core && tui.actor.verified) {
    if (
      tui.distance === undefined ||
      tui.distance < 0 ||
      core.distance === tui.distance
    )
      return { actor: { label: "ambiguous runtime claims", verified: false } };
    return core.distance < tui.distance ? { actor: core.actor } : tui;
  }
  if (core) return { actor: core.actor };
  return typeof coreTerminal !== "string"
    ? tui
    : {
        actor: {
          label: `unverified ${coreTerminal}`,
          verified: false,
          pane_id: coreTerminal,
        },
      };
}
