import { createHash } from "node:crypto";
import type { ReadyRuntimeLease } from "../connections/manager";
import type { CallerLocator } from "../world/caller-identity";
import type { CliActor } from "../world/world-ledger";
import type { AnswerRecipient } from "../world/ask-delivery-types";
import {
  coreRecipientChange,
  coreRecipientToken,
  foregroundOf,
} from "./recipient";
import type { CoreConnectionRuntime } from "./runtime";

export type CoreAnswerConnections = {
  list(): { id: string }[];
  readyRuntimeLease(
    id: string,
  ): ReadyRuntimeLease<CoreConnectionRuntime> | null | undefined;
};

/** CLI claims become evidence only through the local caller's process ancestry. */
export function identifyCoreAsker(
  connections: CoreAnswerConnections,
  address: string,
  locate: CallerLocator | null,
): { actor: CliActor; distance: number } | undefined {
  if (!locate) return;
  const matches: { actor: CliActor; distance: number }[] = [];
  for (const { id } of connections.list()) {
    const lease = connections.readyRuntimeLease(id);
    if (!lease?.isCurrent() || !lease.runtime.local) continue;
    const view = lease.runtime.core;
    const record = view.terminal(address);
    const foreground = record && foregroundOf(record);
    if (!view.actionable || !view.epoch || !record || !foreground) continue;
    const token = coreRecipientToken(
      view.epoch.coreId,
      record,
      view.occupancy(address),
    );
    if (
      !token ||
      coreRecipientChange(
        token,
        view.epoch.coreId,
        record,
        view.occupancy(address),
      )
    )
      continue;
    const chain = locate([foreground[0]]);
    const distance = chain?.findIndex((p) => p.pid === foreground[0]) ?? -1;
    if (distance < 0) continue;
    matches.push({
      distance,
      actor: {
        label: `agent in ${address}`,
        verified: true,
        connection_id: lease.connectionId,
        connection_generation: lease.generation,
        pane_id: address,
        terminal_id: address,
        agent_session_fingerprint: createHash("sha256")
          .update(token)
          .digest("hex"),
        agent_session_id: token,
        ...(typeof record.name === "string" ? { name: record.name } : {}),
      },
    });
  }
  matches.sort((a, b) => a.distance - b.distance);
  return matches.length &&
    (matches.length === 1 || matches[0]!.distance < matches[1]!.distance)
    ? matches[0]
    : undefined;
}

export function coreAskBinding(
  connections: CoreAnswerConnections,
  actor: CliActor,
  incarnation: string,
  now: number,
): AnswerRecipient | undefined {
  if (
    !actor.verified ||
    !actor.connection_id ||
    !actor.pane_id ||
    !actor.agent_session_id ||
    actor.agent_session_fingerprint !==
      createHash("sha256").update(actor.agent_session_id).digest("hex")
  )
    return;
  const lease = connections.readyRuntimeLease(actor.connection_id);
  const view = lease?.runtime.core;
  if (
    !lease?.isCurrent() ||
    lease.generation !== actor.connection_generation ||
    !view?.epoch ||
    !view.actionable ||
    coreRecipientChange(
      actor.agent_session_id,
      view.epoch.coreId,
      view.terminal(actor.pane_id),
      view.occupancy(actor.pane_id),
    )
  )
    return;
  return {
    adapter: "herdr-core",
    connection_id: lease.connectionId,
    connection_generation: lease.generation,
    pane_id: actor.pane_id,
    terminal_id: actor.pane_id,
    reported: {
      scheme: "core-occupant-v1",
      fingerprint: actor.agent_session_fingerprint!,
    },
    conversation: {
      scheme: "core-recipient-v1",
      fingerprint: actor.agent_session_id,
    },
    captured_at: now,
    service_incarnation: incarnation,
  };
}
