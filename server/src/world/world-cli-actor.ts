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
): Promise<{ actor: CliActor; host?: CliHost }> {
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
      return { actor: (await paneActor(host, paneId)).actor, host };
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
