import {
  type IntegrationEntry,
  type IntegrationSetting,
  type IntegrationsSnapshot,
  sourceEntry,
  type VaultStatus,
} from "../../../shared/integrations";
import { HARNESS_LABELS } from "../../../shared/harnessLabels";
import type { WorldSourceStatus } from "../../../shared/worldSources";
import type { WorldIntegrationStatus } from "../cli/integration";
import type { ConnectionState } from "../connections/types";
import type { OfficeObservabilityConfiguration } from "../world/observability";

/**
 * The read-only integrations registry. Each mapper turns one existing owner's
 * status into rows; none of them act or hold state. A failing owner leaves
 * its rows out rather than failing the list.
 */

/** One Herdr TUI or herdr-core connection, as its profile service lists it. */
export type RuntimeInput = {
  id: string;
  label: string;
  runtime: "herdr" | "herdr-core";
  state: ConnectionState;
  generation: number;
  transport: "local" | "ssh";
  sshDestination?: string;
  readOnly: boolean;
  error?: string;
};

/** One harness on the service's host. */
export type HarnessInput = {
  skill: WorldIntegrationStatus;
  /** Its config folder exists: the harness is installed for this user. */
  detected: boolean;
};

export type IntegrationsInputs = {
  hosts?: () => NonNullable<IntegrationsSnapshot["hosts"]>;
  runtimes: () => RuntimeInput[];
  sources: () => Promise<WorldSourceStatus[]>;
  metrics: () => OfficeObservabilityConfiguration;
  harnesses: () => HarnessInput[];
  vault: () => VaultStatus;
  now: () => number;
};

export { sourceEntry };

const RUNTIME_LABELS = {
  herdr: "Herdr",
  "herdr-core": "herdr-core",
} as const;

export function runtimeEntry(input: RuntimeInput): IntegrationEntry {
  const settings: IntegrationSetting[] = [
    {
      key: "transport",
      label: "Runs on",
      value: input.transport === "ssh" ? "SSH host" : "This computer",
    },
  ];
  if (input.transport === "ssh" && input.sshDestination)
    settings.push({
      key: "ssh_destination",
      label: "SSH destination",
      value: input.sshDestination,
    });
  if (input.readOnly)
    settings.push({ key: "read_only", label: "Read only", value: true });
  const { state, detail } = runtimeState(input);
  return {
    id: `runtime:${input.id}`,
    kind: "runtime",
    type: input.runtime,
    label: input.label,
    provides: ["terminals", "agents", "files"],
    state,
    detail: `${RUNTIME_LABELS[input.runtime]} · ${detail}`,
    settings,
    control: "connection",
    connection: {
      id: input.id,
      generation: input.generation,
      transport: input.transport,
      lifecycle: input.state,
    },
  };
}

function runtimeState(input: RuntimeInput): {
  state: IntegrationEntry["state"];
  detail: string;
} {
  switch (input.state) {
    case "ready":
      return { state: "connected", detail: "Connected." };
    case "connecting":
      return { state: "available", detail: "Connecting…" };
    case "reconnecting":
      return { state: "error", detail: "Lost; reconnecting…" };
    case "stopping":
      return { state: "available", detail: "Disconnecting…" };
    case "error":
      return {
        state: "error",
        detail: input.error ? `Failed: ${input.error}` : "Failed to connect.",
      };
    default:
      return { state: "available", detail: "Disconnected." };
  }
}

export function metricsEntry(
  config: OfficeObservabilityConfiguration,
): IntegrationEntry {
  const settings: IntegrationSetting[] = [
    { key: "endpoint", label: "Prometheus URL", value: config.endpoint },
  ];
  if (config.source === "environment")
    settings.push({
      key: "source",
      label: "Set by",
      value: "environment variable",
    });
  let state: IntegrationEntry["state"];
  let detail: string;
  if (!config.configured) {
    state = "needs_connect";
    detail = "Add a Prometheus URL to show agent usage and cost.";
  } else if (config.health === "available") {
    state = "connected";
    detail = "Reading usage and cost.";
  } else if (config.lastSuccessAt === null && config.healthReason === null) {
    state = "available";
    detail = "Waiting for the first reading.";
  } else {
    state = "error";
    detail = "Prometheus didn't answer the last query.";
  }
  return {
    id: "source:metrics",
    kind: "source",
    type: "prometheus",
    label: "Usage metrics",
    provides: ["usage"],
    state,
    detail,
    settings,
    control: "metrics",
  };
}

/**
 * A harness is listed once it is installed here or carries World's skill. A
 * skill file several harnesses share proves none of them is installed.
 */
export function harnessEntry(input: HarnessInput): IntegrationEntry | null {
  const { skill, detected } = input;
  const installed =
    (skill.state === "current" || skill.state === "outdated") &&
    skill.shared_with.length === 0;
  if (!detected && !installed) return null;
  const settings: IntegrationSetting[] = skill.path
    ? [{ key: "skill_path", label: "World's skill", value: skill.path }]
    : [];
  let state: IntegrationEntry["state"];
  let detail: string;
  let control: IntegrationEntry["control"] = "skill";
  if (skill.state === "current") {
    state = "connected";
    detail = "World's skill is installed.";
  } else if (skill.state === "outdated") {
    state = "available";
    detail = "World's skill is out of date. Connect updates it.";
  } else if (skill.state === "not_installed") {
    state = "available";
    detail = "Found. Connect installs World's skill.";
  } else {
    state = "available";
    detail = "Found. World has no skill for it yet.";
    control = "none";
  }
  return {
    id: `harness:${skill.harness}`,
    kind: "harness",
    type: skill.harness,
    label: HARNESS_LABELS[skill.harness] ?? skill.harness,
    provides: control === "skill" ? ["agents", "agent_skill"] : ["agents"],
    state,
    detail,
    settings,
    control,
  };
}

function settle<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

export async function integrationsSnapshot(
  inputs: IntegrationsInputs,
): Promise<IntegrationsSnapshot> {
  const sources = await inputs.sources().catch(() => []);
  const metrics = settle<IntegrationEntry[]>(
    () => [metricsEntry(inputs.metrics())],
    [],
  );
  return {
    observedAt: inputs.now(),
    ...(inputs.hosts ? { hosts: settle(inputs.hosts, []) } : {}),
    integrations: [
      ...settle(() => inputs.runtimes().map(runtimeEntry), []),
      ...sources.map(sourceEntry),
      ...metrics,
      ...settle(
        () =>
          inputs
            .harnesses()
            .map(harnessEntry)
            .filter((entry): entry is IntegrationEntry => entry !== null),
        [],
      ),
    ],
    vault: settle(inputs.vault, {
      backend: "file",
      label: "Private file",
      detail: "World can't read its vault right now.",
      secrets: [],
    }),
  };
}
