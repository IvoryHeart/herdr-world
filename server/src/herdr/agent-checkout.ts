import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { HerdrClient } from "../bridge/herdr-client";
import { createSshTunnelManager } from "../bridge/ssh-tunnel";
import { loadServerConfig, type ServerConfig } from "../config/server-config";
import { runProcess } from "../utils/process-utils";

export const AGENT_CHECKOUT_SOURCE = "herdr-world:agent-checkout";
export const AGENT_CHECKOUT_VERSION = "1";
export const AGENT_CHECKOUT_PATH_CHUNKS = 9;
export const AGENT_CHECKOUT_PR_CHUNKS = 4;
export const AGENT_CHECKOUT_MAX_PATH_BYTES = 540;
export const AGENT_CHECKOUT_MAX_PR_BYTES = 240;

type AgentSession = {
  source: string;
  agent: string;
  kind: string;
  value: string;
};
type Client = Pick<HerdrClient, "call">;
type Command = {
  paneId: string;
  checkoutPath: string;
  prUrl?: string;
  transportArgs: string[];
};

export type AgentCheckoutCommandDeps = {
  loadConfig?: (appVersion: string) => ServerConfig;
  createClient?: (socketPath: string) => Client;
  createTunnel?: (config: ServerConfig) => {
    startAutoSshTunnel(): Promise<void>;
    cleanupAutoSshTunnel(): Promise<void>;
  } | null;
  log?: (message: string) => void;
  error?: (message: string) => void;
};

function usage(message: string): never {
  throw new Error(message);
}
function help() {
  return "Usage: herdr-world agent-checkout PATH --pane ID [--pr HTTPS_URL] [--session NAME] [--ssh-host DESTINATION]";
}
function nonEmpty(value: string, label: string) {
  const valueTrimmed = value.trim();
  if (!valueTrimmed) usage(`${label} must not be empty`);
  return valueTrimmed;
}

export function agentCheckoutSessionFingerprint(session: AgentSession) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        session.source,
        session.agent,
        session.kind,
        session.value,
      ]),
    )
    .digest("hex");
}

function parseSession(value: unknown): AgentSession {
  if (!value || typeof value !== "object" || Array.isArray(value))
    usage("target pane has no active agent session");
  const record = value as Record<string, unknown>;
  const result = {} as AgentSession;
  for (const field of ["source", "agent", "kind", "value"] as const) {
    if (typeof record[field] !== "string" || !record[field])
      usage("target pane has an incomplete agent session");
    result[field] = record[field];
  }
  return result;
}

function validPrUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function chunks(value: string, count: number) {
  const encoded = Buffer.from(value, "utf8").toString("base64url");
  const result: Record<string, string | null> = {};
  for (let index = 0; index < count; index += 1)
    result[String(index)] = encoded.slice(index * 80, (index + 1) * 80) || null;
  return result;
}

export function agentCheckoutTokens(
  session: AgentSession,
  checkoutPath: string,
  prUrl?: string,
) {
  if (!isAbsolute(checkoutPath)) usage("checkout path must be absolute");
  if (Buffer.byteLength(checkoutPath, "utf8") > AGENT_CHECKOUT_MAX_PATH_BYTES)
    usage("checkout path exceeds 540 bytes");
  if (
    prUrl &&
    (!validPrUrl(prUrl) ||
      Buffer.byteLength(prUrl, "utf8") > AGENT_CHECKOUT_MAX_PR_BYTES)
  )
    usage("reported PR must be an HTTPS URL of at most 240 bytes");
  const path = chunks(checkoutPath, AGENT_CHECKOUT_PATH_CHUNKS);
  const pr = chunks(prUrl ?? "", AGENT_CHECKOUT_PR_CHUNKS);
  const tokens: Record<string, string | null> = {
    agent_checkout_v: AGENT_CHECKOUT_VERSION,
    agent_checkout_session: agentCheckoutSessionFingerprint(session),
  };
  for (let index = 0; index < AGENT_CHECKOUT_PATH_CHUNKS; index += 1)
    tokens[`agent_checkout_path_${index}`] = path[String(index)]!;
  for (let index = 0; index < AGENT_CHECKOUT_PR_CHUNKS; index += 1)
    tokens[`agent_checkout_pr_${index}`] = pr[String(index)]!;
  return tokens;
}

function parse(args: string[]): Command | null {
  if (!args.length || args[0] === "--help" || args[0] === "-h") return null;
  let paneId: string | undefined;
  let checkoutPath: string | undefined;
  let prUrl: string | undefined;
  const transportArgs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--clear")
      usage(
        "agent-checkout does not support --clear; reports belong to the current session",
      );
    if (arg === "--ttl-ms")
      usage("agent-checkout has no TTL; reports last for the current session");
    if (
      arg === "--pane" ||
      arg === "--pr" ||
      arg === "--session" ||
      arg === "--ssh-host" ||
      arg === "--socket-path" ||
      arg === "--client-socket-path"
    ) {
      const value = args[++index];
      if (value === undefined) usage(`missing value for ${arg}`);
      if (arg === "--pane") {
        if (paneId) usage("--pane may only be specified once");
        paneId = nonEmpty(value, "pane ID");
      } else if (arg === "--pr") {
        if (prUrl) usage("--pr may only be specified once");
        prUrl = nonEmpty(value, "reported PR");
      } else transportArgs.push(arg, value);
      continue;
    }
    if (arg.startsWith("-")) usage(`unknown agent-checkout option: ${arg}`);
    if (checkoutPath) usage("agent-checkout accepts one checkout path");
    checkoutPath = arg;
  }
  const resolvedPane = paneId ?? process.env.HERDR_PANE_ID;
  if (!resolvedPane) usage("agent-checkout requires --pane or HERDR_PANE_ID");
  if (!checkoutPath) usage("agent-checkout requires an absolute checkout path");
  agentCheckoutTokens(
    {
      source: "validation",
      agent: "validation",
      kind: "validation",
      value: "validation",
    },
    checkoutPath,
    prUrl,
  );
  return {
    paneId: nonEmpty(resolvedPane, "pane ID"),
    checkoutPath,
    ...(prUrl ? { prUrl } : {}),
    transportArgs,
  };
}

function stripArgv(args: readonly string[]) {
  if (process.argv[2] === "agent-checkout")
    process.argv.splice(2, process.argv.length - 2, ...args);
}

export async function runAgentCheckoutCommand(
  args: string[],
  appVersion: string,
  dependencies: AgentCheckoutCommandDeps = {},
): Promise<number | null> {
  if (args[0] !== "agent-checkout") return null;
  const log = dependencies.log ?? console.log;
  const error = dependencies.error ?? console.error;
  let command: Command | null;
  try {
    command = parse(args.slice(1));
  } catch (cause) {
    error(`agent-checkout: ${(cause as Error).message}`);
    error(help());
    return 2;
  }
  if (!command) {
    log(help());
    return 0;
  }
  let tunnel:
    | ReturnType<NonNullable<AgentCheckoutCommandDeps["createTunnel"]>>
    | undefined;
  try {
    stripArgv(command.transportArgs);
    const config = (dependencies.loadConfig ?? loadServerConfig)(appVersion);
    const createTunnel =
      dependencies.createTunnel ??
      ((target: ServerConfig) =>
        target.sshHost
          ? createSshTunnelManager({ config: target, runProcess })
          : null);
    tunnel = createTunnel(config);
    await tunnel?.startAutoSshTunnel();
    const client = (
      dependencies.createClient ??
      ((socketPath: string) => new HerdrClient(socketPath))
    )(config.socketPath);
    const response = await client.call("pane.get", { pane_id: command.paneId });
    const pane =
      response?.pane && typeof response.pane === "object"
        ? (response.pane as Record<string, unknown>)
        : (response as Record<string, unknown>);
    if (pane?.pane_id !== command.paneId)
      usage("Herdr did not return the requested pane");
    await client.call("pane.report_metadata", {
      pane_id: command.paneId,
      source: AGENT_CHECKOUT_SOURCE,
      tokens: agentCheckoutTokens(
        parseSession(pane.agent_session),
        command.checkoutPath,
        command.prUrl,
      ),
    });
    log(JSON.stringify({ pane_id: command.paneId, status: "reported" }));
    return 0;
  } catch {
    error("agent-checkout: unable to report to the requested Herdr pane");
    return 1;
  } finally {
    await tunnel?.cleanupAutoSshTunnel();
  }
}
