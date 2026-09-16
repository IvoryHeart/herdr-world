import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import process from "node:process";

export const PINNED_HERDR_REVISION =
  "b99002ac99b09e00b4ca692436cb15a6b0d676f1";
export const PINNED_HERDR_VERSION = "0.9.0";
const COMMAND_TIMEOUT_MS = 10_000;
const LIVE_PROOF_BLOCKER =
  "the live SSH snapshot/subscription/concurrency proof has no supported stream driver yet";

const REQUIRED_METHODS = [
  "session.snapshot",
  "events.subscribe",
  "layout.export",
  "layout.apply",
  "pane.move",
  "agent.start",
];
const MACHINE_SELECTOR_KEYS = new Set([
  "machine_id",
  "profile_id",
  "endpoint_id",
]);

export function isAgentSocket(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    return statSync(value).isSocket();
  } catch {
    return false;
  }
}

function resolveReference(root, value) {
  if (!value || typeof value !== "object" || typeof value.$ref !== "string") {
    return value;
  }
  if (!value.$ref.startsWith("#/")) return value;
  return value.$ref
    .slice(2)
    .split("/")
    .reduce((current, key) => current?.[key], root);
}

function collectPropertyKeys(root, value, seen = new Set()) {
  const resolved = resolveReference(root, value);
  if (!resolved || typeof resolved !== "object") return new Set();
  if (seen.has(resolved)) return new Set();
  seen.add(resolved);
  const keys = new Set(Object.keys(resolved.properties ?? {}));
  for (const child of Object.values(resolved.properties ?? {})) {
    for (const key of collectPropertyKeys(root, child, seen)) keys.add(key);
  }
  for (const child of Object.values(resolved.$defs ?? {})) {
    for (const key of collectPropertyKeys(root, child, seen)) keys.add(key);
  }
  return keys;
}

function requestVariants(schema) {
  return schema?.schemas?.request?.oneOf ?? [];
}

function variantMethod(variant) {
  return variant?.properties?.method?.const;
}

/**
 * Assess the public raw socket contract and an optional supported stream entry
 * point. A machine selector may qualify the stream before the raw methods are
 * sent, so the raw request schema does not need to repeat that selector.
 */
export function assessPublicSurface(schema, {
  machineQualifiedStream = false,
  streamEntryPoint = null,
} = {}) {
  const variants = requestVariants(schema);
  const methods = variants.map(variantMethod).filter((method) => typeof method === "string");
  const methodSet = new Set(methods);
  const machineQualifiedMethods = variants
    .filter((variant) => {
      const params = resolveReference(schema, variant?.properties?.params);
      const keys = collectPropertyKeys(schema, params);
      const required = new Set(params?.required ?? []);
      return [...MACHINE_SELECTOR_KEYS].some((key) => keys.has(key) && required.has(key));
    })
    .map(variantMethod)
    .filter((method) => typeof method === "string");
  const missingMethods = REQUIRED_METHODS.filter((method) => !methodSet.has(method));
  const streamIsQualified = machineQualifiedStream === true &&
    typeof streamEntryPoint === "string" &&
    streamEntryPoint.trim().length > 0;
  const reasons = [];
  if (machineQualifiedMethods.length === 0 && !streamIsQualified) {
    reasons.push(
      "the public API has no machine-qualified request or supported stream entry point; it addresses only the connected local socket",
    );
  }
  if (missingMethods.length > 0) {
    reasons.push(`the public socket schema omits required methods: ${missingMethods.join(", ")}`);
  }
  return {
    status: reasons.length === 0 ? "ready" : "blocked",
    machineQualified: machineQualifiedMethods.length > 0 || streamIsQualified,
    methods,
    machineQualifiedMethods,
    machineQualifiedStream: streamIsQualified,
    streamEntryPoint: streamIsQualified ? streamEntryPoint : null,
    missingMethods,
    reasons,
  };
}

export function assessCliSurface(help, apiHelp) {
  const text = `${help ?? ""}\n${apiHelp ?? ""}`;
  const machinePrefix = /--machine(?:[ =]|<)/.test(text);
  const apiSnapshot =
    /\bapi snapshot\b/.test(text) ||
    /\bsnapshot\b/.test(apiHelp ?? "");
  const apiConnect =
    /\bapi connect\b/.test(text) ||
    /^\s*connect(?:\s|$)/m.test(apiHelp ?? "");
  return {
    machinePrefix,
    apiSnapshot,
    apiConnect,
    machineQualifiedStream: machinePrefix && apiConnect,
    oneShotOnly: machinePrefix && apiSnapshot && !apiConnect,
  };
}

function command(bin, args, env = process.env) {
  const result = spawnSync(bin, args, {
    encoding: "utf8",
    env,
    timeout: COMMAND_TIMEOUT_MS,
    killSignal: "SIGKILL",
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    code: result.error ? null : result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error?.code ?? null,
  };
}

function parseVersion(output) {
  const match = String(output).match(/herdr\s+([^\s]+)/i);
  return match?.[1] ?? null;
}

function parseMachineList(result, machineId) {
  if (result.error || result.code !== 0) {
    return { status: "unavailable", count: null, enabled: null, valid: false };
  }
  try {
    const rows = JSON.parse(result.stdout);
    if (!Array.isArray(rows)) throw new Error("machine list is not an array");
    const valid = rows.every((row) =>
      row &&
      typeof row.id === "string" &&
      /^[0-9a-f]{32}$/.test(row.id) &&
      typeof row.label === "string" &&
      typeof row.target === "string" &&
      typeof row.session === "string" &&
      typeof row.enabled === "boolean" &&
      typeof row.selected === "boolean"
    );
    return {
      status: "available",
      count: rows.length,
      enabled: rows.filter((row) => row.enabled).length,
      valid,
      exposesTransportFields: rows.some((row) => "target" in row || "session" in row),
      selectedMachineAvailable: Boolean(
        machineId && rows.some((row) => row.id === machineId && row.enabled === true),
      ),
    };
  } catch {
    return { status: "invalid", count: null, enabled: null, valid: false };
  }
}

function hasMachineId(value) {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
}

export function runCheckpoint({
  bin = process.env.HERDR_BIN || "herdr",
  env = process.env,
  machineId = process.env.HERDR_CHECKPOINT1_MACHINE_ID || null,
  herdrRevision = env.HERDR_CHECKPOINT1_HERDR_REVISION || null,
} = {}) {
  const versionResult = command(bin, ["--version"], env);
  const helpResult = command(bin, ["--help"], env);
  const apiHelpResult = command(bin, ["api", "--help"], env);
  const catalogResult = command(bin, ["machine", "list", "--json"], env);
  const schemaResult = command(bin, ["api", "schema", "--json"], env);
  const machineList = parseMachineList(catalogResult, machineId);
  const cliSurface = assessCliSurface(
    helpResult.stdout + helpResult.stderr,
    apiHelpResult.stdout + apiHelpResult.stderr,
  );
  let schema = null;
  try {
    if (schemaResult.code === 0 && !schemaResult.error) schema = JSON.parse(schemaResult.stdout);
  } catch {
    schema = null;
  }
  const publicSurface = schema
    ? assessPublicSurface(schema, {
        machineQualifiedStream: cliSurface.machineQualifiedStream,
        streamEntryPoint: cliSurface.machineQualifiedStream
          ? "--machine <id> api connect"
          : null,
      })
    : {
        status: "blocked",
        machineQualified: false,
        methods: [],
        machineQualifiedMethods: [],
        machineQualifiedStream: false,
        streamEntryPoint: null,
        missingMethods: [...REQUIRED_METHODS],
        reasons: ["Herdr did not return a parseable public API schema"],
      };
  const syntheticMachineId = "00000000000000000000000000000000";
  const selectorProbe = command(bin, ["--machine", syntheticMachineId, "api", "snapshot"], env);
  const connectProbe = command(bin, ["--machine", syntheticMachineId, "api", "connect"], env);
  const selectorAccepted =
    selectorProbe.code === 2 &&
    /unknown machine|saved machine|profile/i.test(`${selectorProbe.stdout}\n${selectorProbe.stderr}`);
  const agentSocket = env.SSH_AUTH_SOCK;
  const managedServiceEnvironment = Boolean(
    env.HERDR_PLUGIN_CONFIG_DIR && env.HERDR_PLUGIN_STATE_DIR,
  );
  const reasons = [LIVE_PROOF_BLOCKER, ...publicSurface.reasons];
  if (versionResult.error || versionResult.code !== 0) {
    reasons.push("the installed Herdr binary did not report a version");
  } else if (parseVersion(versionResult.stdout + versionResult.stderr) !== PINNED_HERDR_VERSION) {
    reasons.push(`Herdr version is not the pinned ${PINNED_HERDR_VERSION} baseline`);
  }
  if (!cliSurface.machinePrefix) {
    reasons.push("the installed Herdr CLI has no public --machine selector");
  } else if (cliSurface.oneShotOnly) {
    reasons.push("--machine routes one-shot commands only; no public api connect or persistent stream exists");
  }
  if (!selectorAccepted && cliSurface.machinePrefix) {
    reasons.push("the machine selector probe was not accepted as a saved-machine command");
  }
  if (machineList.status !== "available" || !machineList.valid) {
    reasons.push("machine list is unavailable or malformed");
  } else if (machineList.enabled === 0) {
    reasons.push("no enabled saved machine is available for the live proof");
  } else if (!hasMachineId(machineId)) {
    reasons.push("HERDR_CHECKPOINT1_MACHINE_ID must select an enabled opaque saved-machine ID");
  } else if (!machineList.selectedMachineAvailable) {
    reasons.push("HERDR_CHECKPOINT1_MACHINE_ID is not an enabled saved machine in the catalogue");
  }
  if (!managedServiceEnvironment) {
    reasons.push("managed plugin/service environment markers are absent");
  }
  if (!isAgentSocket(agentSocket)) reasons.push("SSH_AUTH_SOCK is absent or is not a Unix socket");
  const blocked = reasons.length > 0;
  return {
    status: blocked ? "blocked" : "ready",
    stopCondition: blocked
      ? "Checkpoint 1 cannot be claimed until Herdr exposes a reusable machine-qualified stream, this harness executes it end to end, and the live prerequisites are present"
      : null,
    herdr: {
      version: parseVersion(versionResult.stdout + versionResult.stderr),
      pinnedVersion: PINNED_HERDR_VERSION,
      pinnedRevision: PINNED_HERDR_REVISION,
      declaredRevision: herdrRevision,
      declaredRevisionMatchesPinned: herdrRevision === PINNED_HERDR_REVISION,
      versionCommand: versionResult.error ? "unavailable" : `exit ${versionResult.code}`,
    },
    catalogue: machineList,
    api: {
      protocol: schema?.protocol ?? null,
      schemaVersion: schema?.schema_version ?? null,
      ...publicSurface,
      cli: cliSurface,
      probes: {
        machineSnapshot: selectorAccepted,
        machineConnect: cliSurface.machineQualifiedStream,
        machineSnapshotExit: selectorProbe.code,
        machineConnectExit: connectProbe.code,
      },
    },
    prerequisites: {
      savedMachineIdProvided: machineId !== null,
      managedPluginServiceEnvironment: managedServiceEnvironment,
      managedSupervisorExecution: "not-proven",
      sshAgentSocket: isAgentSocket(agentSocket),
      sshAgentInheritance: "not-proven",
    },
    live: {
      fullSnapshot: "blocked",
      subscription: "blocked",
      concurrentControl: "blocked",
      launcher: "blocked",
      managedSupervisor: "blocked",
      sshAgentInheritance: "blocked",
    },
    reasons,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = runCheckpoint();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === "ready" ? 0 : 2;
}
