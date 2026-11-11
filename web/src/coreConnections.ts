import { useEffect, useState } from "react";
import { bridge, type ConnectionLifecycleState } from "./api";

/** One terminal as a herdr-core connection last observed it. */
export type CoreObservedTerminal = {
  address: string;
  name: string | null;
  state: string;
  status: string | null;
  program: string | null;
  remote: boolean;
};

export type CoreObservation = {
  state: "live" | "stale";
  reason: string | null;
  core: { id: string; name: string; version: string; pid: number } | null;
  observed_ms: number;
  terminals: CoreObservedTerminal[];
  counts: { live: number; finished: number; remote: number };
  unknown_events: string[];
};

/** A herdr-core connection: kept apart from Herdr (TUI) connections. */
export type CoreConnectionSummary = {
  id: string;
  label: string;
  type: "local" | "ssh";
  runtime: "herdr-core";
  state: ConnectionLifecycleState;
  generation: number;
  error?: { message: string };
  ssh_destination?: string;
  core_session: string;
  core_state_dir: string;
  auto_connect: boolean;
  read_only: boolean;
  observation: CoreObservation | null;
};

const STATES = new Set([
  "disconnected",
  "connecting",
  "ready",
  "reconnecting",
  "stopping",
  "error",
]);

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseObservation(value: unknown): CoreObservation | null {
  if (!record(value)) return null;
  if (
    (value.state !== "live" && value.state !== "stale") ||
    !Array.isArray(value.terminals) ||
    !record(value.counts)
  )
    return null;
  const core = record(value.core) ? value.core : null;
  return {
    state: value.state,
    reason: typeof value.reason === "string" ? value.reason : null,
    core:
      core &&
      typeof core.id === "string" &&
      typeof core.name === "string" &&
      typeof core.version === "string" &&
      typeof core.pid === "number"
        ? {
            id: core.id,
            name: core.name,
            version: core.version,
            pid: core.pid,
          }
        : null,
    observed_ms: typeof value.observed_ms === "number" ? value.observed_ms : 0,
    terminals: value.terminals.flatMap((item) =>
      record(item) && typeof item.address === "string"
        ? [
            {
              address: item.address,
              name: typeof item.name === "string" ? item.name : null,
              state: typeof item.state === "string" ? item.state : "live",
              status: typeof item.status === "string" ? item.status : null,
              program: typeof item.program === "string" ? item.program : null,
              remote: item.remote === true,
            },
          ]
        : [],
    ),
    counts: {
      live: Number(value.counts.live) || 0,
      finished: Number(value.counts.finished) || 0,
      remote: Number(value.counts.remote) || 0,
    },
    unknown_events: Array.isArray(value.unknown_events)
      ? value.unknown_events.filter((e): e is string => typeof e === "string")
      : [],
  };
}

/** Parses the `core_connections` catalogue field; invalid items are dropped. */
export function parseCoreConnections(value: unknown): CoreConnectionSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      !record(item) ||
      item.runtime !== "herdr-core" ||
      typeof item.id !== "string" ||
      typeof item.label !== "string" ||
      (item.type !== "local" && item.type !== "ssh") ||
      typeof item.state !== "string" ||
      !STATES.has(item.state) ||
      typeof item.core_session !== "string" ||
      typeof item.core_state_dir !== "string"
    )
      return [];
    return [
      {
        id: item.id,
        label: item.label,
        type: item.type,
        runtime: "herdr-core" as const,
        state: item.state as ConnectionLifecycleState,
        generation: Number(item.generation) || 0,
        ...(record(item.error) && typeof item.error.message === "string"
          ? { error: { message: item.error.message } }
          : {}),
        ...(typeof item.ssh_destination === "string"
          ? { ssh_destination: item.ssh_destination }
          : {}),
        core_session: item.core_session,
        core_state_dir: item.core_state_dir,
        auto_connect: item.auto_connect === true,
        read_only: item.read_only === true,
        observation: parseObservation(item.observation),
      },
    ];
  });
}

/** One plain status line for a core connection. */
export function coreConnectionStatus(
  connection: CoreConnectionSummary,
): string {
  const observed = connection.observation;
  const count = (n: number) => `${n} live terminal${n === 1 ? "" : "s"}`;
  if (connection.state === "ready" && observed?.state === "live") {
    const version = observed.core?.version
      ? `herdr-core ${observed.core.version}`
      : "herdr-core";
    return `Connected · ${version} · ${count(observed.counts.live)}`;
  }
  if (observed?.state === "stale" && connection.state !== "disconnected")
    return `Stale · last saw ${count(observed.counts.live)} · retrying`;
  if (connection.state === "reconnecting" || connection.state === "connecting")
    return "Not running · retrying";
  if (connection.state === "error") return "Error";
  return "Disconnected";
}

export function coreTerminalLabel(terminal: CoreObservedTerminal): string {
  const who = terminal.name ?? terminal.program ?? "terminal";
  const status = terminal.status ? ` · ${terminal.status}` : "";
  const ended = terminal.state === "live" ? "" : " · ended";
  return `${terminal.address} ${who}${status}${ended}`;
}

export type CoreProfileDraft = {
  id: string;
  label: string;
  where: "local" | "ssh";
  sshDestination: string;
  session: string;
  stateDir: string;
  autoConnect: boolean;
};

/** The server validates again; this catches mistakes before a round trip. */
export function coreProfilePayload(draft: CoreProfileDraft) {
  const id = draft.id.trim();
  const label = draft.label.trim();
  const session = draft.session.trim() || "default";
  const stateDir = draft.stateDir.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id) || id.length > 128)
    throw new Error(
      "ID must start with a letter or number and use only letters, numbers, dot, colon, underscore, or hyphen.",
    );
  if (!label) throw new Error("Name is required.");
  if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/.test(session))
    throw new Error("Session must be a herdr-core session name.");
  if (stateDir && !stateDir.startsWith("/"))
    throw new Error("State directory must be an absolute path.");
  if (draft.where === "ssh" && !draft.sshDestination.trim())
    throw new Error("SSH destination is required.");
  return {
    id,
    label,
    type: draft.where,
    runtime: "herdr-core" as const,
    ...(draft.where === "ssh"
      ? { ssh_destination: draft.sshDestination.trim() }
      : {}),
    core_session: session,
    core_state_dir: stateDir,
    auto_connect: draft.autoConnect,
  };
}

/**
 * herdr-core connections for the open Connections dialog: read from
 * `connections.list` and again whenever the service says connections changed.
 * Herdr views never receive them.
 */
export function useCoreConnections(): CoreConnectionSummary[] {
  const [connections, setConnections] = useState<CoreConnectionSummary[]>([]);
  useEffect(() => {
    let live = true;
    let request = 0;
    const refresh = () => {
      const seq = ++request;
      bridge
        .call("connections.list")
        .then((result: { core_connections?: unknown } | null) => {
          if (live && seq === request)
            setConnections(parseCoreConnections(result?.core_connections));
        })
        .catch(() => undefined);
    };
    refresh();
    const stop = bridge.onControl((control) => {
      if (control.type === "world_connections_changed") refresh();
    });
    return () => {
      live = false;
      stop();
    };
  }, []);
  return connections;
}
