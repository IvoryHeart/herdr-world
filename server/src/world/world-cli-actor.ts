import { CliError } from "./world-cli-errors";
import type { WorldCliRequest } from "./world-cli-protocol";
import { createHash } from "node:crypto";
import {
  paneRoots,
  runsInPane,
  type CallerLocator,
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

/**
 * A caller that named no pane. Any process can leave HERDR_PANE_ID unset, so
 * this is not the owner, only a terminal that did not say where it runs.
 */
export const NO_PANE = "terminal with no pane";

/**
 * Who is calling. Without HERDR_PANE_ID the caller is unverified with no
 * pane. With one, the claim is verified only when the calling process runs
 * in that pane of a local Herdr (searched for among the pane's own
 * processes); otherwise it is labelled unverified and acts on the default host.
 */
export async function identifyCaller(
  hosts: readonly CliHost[],
  paneId: string | undefined,
  locate: CallerLocator | null,
): Promise<{ actor: CliActor; host?: CliHost; distance?: number }> {
  if (!paneId) return { actor: { label: NO_PANE, verified: false } };
  if (locate)
    for (const host of hosts) {
      if (!host.local) continue;
      const info = (
        (await host
          .call("pane.process_info", { pane_id: paneId })
          .catch(() => null)) as { process_info?: PaneProcessInfo } | null
      )?.process_info;
      const roots = paneRoots(info);
      const chain = roots.length ? locate(roots) : null;
      if (!chain || !runsInPane(chain, info)) continue;
      return {
        actor: (await paneActor(host, paneId)).actor,
        host,
        distance: chain.findIndex((entry) => roots.includes(entry.pid)),
      };
    }
  return {
    actor: { label: `unverified ${paneId}`, verified: false, pane_id: paneId },
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
  identifyCore?: (
    terminal: string,
    locate: CallerLocator | null,
  ) => Promise<{ actor: CliActor; distance: number } | undefined>,
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
  const coreTerminal = caller?.core_terminal_id;
  if (
    coreTerminal !== undefined &&
    (typeof coreTerminal !== "string" ||
      !/^t[1-9][0-9]{0,9}$/.test(coreTerminal))
  )
    usage("HC_TERMINAL_ID is not a core terminal ID");
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
