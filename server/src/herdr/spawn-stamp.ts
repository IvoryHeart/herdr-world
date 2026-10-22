import { HerdrClient } from "../bridge/herdr-client";
import { createSshTunnelManager } from "../bridge/ssh-tunnel";
import { loadServerConfig, type ServerConfig } from "../config/server-config";
import { runProcess } from "../utils/process-utils";
import {
  SPAWNED_BY_TERMINAL_TOKEN,
  SPAWNED_BY_TOKEN,
} from "../../../shared/relations";

/**
 * Stamp a child pane with the pane that spawned it, so World groups the two
 * (shared/relations.ts). Herdr has no creator field, so the spawner reports
 * display-only metadata on the child: the parent's pane ID and its terminal,
 * which survives a move of the parent. No TTL: the stamp lasts as long as the
 * pane on this Herdr runtime, and World keeps its own copy after that.
 */

export const SPAWN_STAMP_SOURCE = "herdr-world:spawn";

type Call = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;
type Client = Pick<HerdrClient, "call">;
type Command = { child: string; parent: string; transportArgs: string[] };

export type SpawnStampCommandDeps = {
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
  return `Usage: herdr-world stamp CHILD_PANE PARENT_PANE [--session NAME] [--ssh-host DESTINATION]

Records on CHILD_PANE that PARENT_PANE spawned it, as Herdr pane metadata
(spawned_by and spawned_by_terminal). World then groups the two.`;
}

async function paneOf(call: Call, paneId: string) {
  const response = (await call("pane.get", { pane_id: paneId })) as Record<
    string,
    unknown
  > | null;
  const pane =
    response?.pane && typeof response.pane === "object"
      ? (response.pane as Record<string, unknown>)
      : response;
  if (pane?.pane_id !== paneId || typeof pane.terminal_id !== "string")
    usage(`Herdr did not return pane ${paneId}`);
  return { pane_id: paneId, terminal_id: pane.terminal_id };
}

/**
 * Stamp `child` as spawned by `parent` on one Herdr runtime. With
 * `parentTerminal`, the parent pane must still hold that terminal: a pane ID
 * alone may name another pane by now.
 */
export async function stampSpawn(
  call: Call,
  child: string,
  parent: string,
  parentTerminal?: string,
) {
  if (child === parent) usage("a pane cannot spawn itself");
  const [, from] = await Promise.all([
    paneOf(call, child),
    paneOf(call, parent),
  ]);
  if (parentTerminal && from.terminal_id !== parentTerminal)
    usage(`pane ${parent} no longer holds the spawning terminal`);
  await call("pane.report_metadata", {
    pane_id: child,
    source: SPAWN_STAMP_SOURCE,
    tokens: {
      [SPAWNED_BY_TOKEN]: from.pane_id,
      [SPAWNED_BY_TERMINAL_TOKEN]: from.terminal_id,
    },
  });
}

function parse(args: string[]): Command | null {
  if (!args.length || args[0] === "--help" || args[0] === "-h") return null;
  const panes: string[] = [];
  const transportArgs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (
      arg === "--session" ||
      arg === "--ssh-host" ||
      arg === "--socket-path" ||
      arg === "--client-socket-path"
    ) {
      const value = args[++index];
      if (value === undefined) usage(`missing value for ${arg}`);
      transportArgs.push(arg, value);
      continue;
    }
    if (arg.startsWith("-")) usage(`unknown stamp option: ${arg}`);
    if (!arg.trim()) usage("pane ID must not be empty");
    panes.push(arg.trim());
  }
  if (panes.length !== 2) usage("stamp takes a child pane and a parent pane");
  return { child: panes[0]!, parent: panes[1]!, transportArgs };
}

function stripArgv(args: readonly string[]) {
  if (process.argv[2] === "stamp")
    process.argv.splice(2, process.argv.length - 2, ...args);
}

export async function runSpawnStampCommand(
  args: string[],
  appVersion: string,
  dependencies: SpawnStampCommandDeps = {},
): Promise<number | null> {
  if (args[0] !== "stamp") return null;
  const log = dependencies.log ?? console.log;
  const error = dependencies.error ?? console.error;
  let command: Command | null;
  try {
    command = parse(args.slice(1));
  } catch (cause) {
    error(`stamp: ${(cause as Error).message}`);
    error(help());
    return 2;
  }
  if (!command) {
    log(help());
    return 0;
  }
  let tunnel:
    | ReturnType<NonNullable<SpawnStampCommandDeps["createTunnel"]>>
    | undefined;
  let failure: string | null = null;
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
    await stampSpawn(
      (method, params) => client.call(method, params),
      command.child,
      command.parent,
    );
  } catch (cause) {
    failure =
      cause instanceof Error && cause.message.startsWith("Herdr did not")
        ? cause.message
        : "unable to stamp the requested Herdr pane";
  }
  try {
    await tunnel?.cleanupAutoSshTunnel();
  } catch {
    failure ??= "unable to close the requested Herdr transport";
  }
  if (failure) {
    error(`stamp: ${failure}`);
    return 1;
  }
  log(
    JSON.stringify({
      pane_id: command.child,
      spawned_by: command.parent,
      status: "stamped",
    }),
  );
  return 0;
}
