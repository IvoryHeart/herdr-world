/**
 * Integrations: everything outside World's own code that World reads from or
 * acts through, under one noun. The service builds this read-only registry
 * from the owners that already exist (connection profiles, sources, World's
 * harness skills, the metrics connector); each owner keeps its own settings
 * and operations. The registry never acts: a runtime row carries its
 * immutable connection ID and generation only so the browser connects that
 * one connection through the existing fenced verbs, never another.
 *
 * Nothing in the list is required: a fresh install with nothing connected
 * still works, and each row says what it would add.
 */

/** What an integration is. Kinds share status and UI, not an operation contract. */
export const INTEGRATION_KINDS = [
  "runtime",
  "source",
  "harness",
  "ide",
] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

export const INTEGRATION_KIND_LABELS: Record<IntegrationKind, string> = {
  runtime: "Runtimes",
  source: "Sources",
  harness: "Agents",
  ide: "Editors",
};

/**
 * - `connected`: present and working now.
 * - `available`: found, and one Connect away (a switched-off source, a
 *   disconnected profile, an agent without World's skill).
 * - `needs_connect`: needs the owner first: a sign-in, a token, an address.
 * - `error`: set up, but failing; `detail` says what World saw.
 */
export const INTEGRATION_STATES = [
  "connected",
  "available",
  "needs_connect",
  "error",
] as const;
export type IntegrationState = (typeof INTEGRATION_STATES)[number];

export const INTEGRATION_STATE_LABELS: Record<IntegrationState, string> = {
  connected: "Connected",
  available: "Available",
  needs_connect: "Needs connect",
  error: "Error",
};

/** What an integration gives World's elements. */
export const INTEGRATION_PROVISIONS = [
  "terminals",
  "agents",
  "files",
  "pull_requests",
  "tickets",
  "usage",
  "agent_skill",
  "editor",
] as const;
export type IntegrationProvision = (typeof INTEGRATION_PROVISIONS)[number];

export const INTEGRATION_PROVISION_LABELS: Record<
  IntegrationProvision,
  string
> = {
  terminals: "terminals",
  agents: "agents",
  files: "files",
  pull_requests: "pull requests",
  tickets: "tickets",
  usage: "usage and cost",
  agent_skill: "World's skill",
  editor: "editing",
};

/**
 * The existing owner that connects and disconnects a row:
 * - `connection`: `connections.connect`/`disconnect` for its connection ID;
 * - `source`: the source's own on/off setting;
 * - `skill`: World's skill install/uninstall for that harness;
 * - `metrics`: the metrics connector's address;
 * - `none`: shown only; nothing to connect yet.
 */
export type IntegrationControl =
  | "connection"
  | "source"
  | "skill"
  | "metrics"
  | "none";

export type IntegrationConnectionLifecycle =
  | "disconnected"
  | "connecting"
  | "ready"
  | "reconnecting"
  | "stopping"
  | "error";

/** A display-safe setting. A secret is reported only as set or not set. */
export type IntegrationSetting = {
  key: string;
  label: string;
  value: string | number | boolean | null;
  secret?: true;
};

export type IntegrationEntry = {
  /** Stable: `runtime:<connectionId>`, `source:github`, `harness:claude`. */
  id: string;
  kind: IntegrationKind;
  /** Its type within the kind: `herdr`, `herdr-core`, `github`, `claude`. */
  type: string;
  label: string;
  provides: IntegrationProvision[];
  state: IntegrationState;
  /** One plain sentence for the current state; never a raw error. */
  detail: string;
  settings: IntegrationSetting[];
  control: IntegrationControl;
  /** Runtimes only: the exact connection; a row never stands in for another. */
  connection?: {
    id: string;
    generation: number;
    transport: "local" | "ssh";
    /** The connection's own lifecycle, which decides Connect or Disconnect. */
    lifecycle: IntegrationConnectionLifecycle;
  };
};

export type VaultSecretStatus = {
  name: string;
  label: string;
  /** The integration that uses it. */
  usedBy: string;
};

/** Where World keeps the tokens integrations need; never their values. */
export type VaultStatus = {
  backend: "file" | "keychain";
  label: string;
  detail: string;
  secrets: VaultSecretStatus[];
};

export type IntegrationsSnapshot = {
  observedAt: number;
  integrations: IntegrationEntry[];
  vault: VaultStatus;
};

export const WORLD_INTEGRATIONS_PATH = "/api/world/integrations";

/**
 * The integration an element uses by default for what it needs: the first
 * connected one. None means the element shows Connect (see `connectFor`).
 */
export function connectedProvider(
  integrations: readonly IntegrationEntry[],
  provision: IntegrationProvision,
): IntegrationEntry | null {
  return (
    integrations.find(
      (entry) =>
        entry.state === "connected" && entry.provides.includes(provision),
    ) ?? null
  );
}

/**
 * The row an element's Connect opens when nothing it needs is connected:
 * one a click away first, then one that needs setting up, then a failing one.
 */
export function connectFor(
  integrations: readonly IntegrationEntry[],
  provision: IntegrationProvision,
): IntegrationEntry | null {
  if (connectedProvider(integrations, provision)) return null;
  const candidates = integrations.filter((entry) =>
    entry.provides.includes(provision),
  );
  for (const state of ["available", "needs_connect", "error"] as const) {
    const found = candidates.find((entry) => entry.state === state);
    if (found) return found;
  }
  return null;
}
