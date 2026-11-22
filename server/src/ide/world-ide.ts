import { join } from "node:path";
import { sshReadCommandArgv } from "../bridge/ssh-command";
import { STARTUP_DEFAULT_CONNECTION_ID } from "../connections/types";
import { runProcessWithCodeTimeout } from "../utils/process-utils";
import {
  type IdeDetectEnvironment,
  type IdeDetection,
  type IdeProviderId,
  systemDetectEnvironment,
} from "./providers";
import { parseRemoteDetection, remoteDetectCommand } from "./remote";
import { type IdeConnection, IdeService } from "./service";
import { fileIdeSettingsStore } from "./settings";

/** The parts of a connection list entry the Code view reads. */
type ConnectionEntry = {
  id: string;
  label: string;
  type: string;
  generation: number;
  ssh_destination?: string;
  remote_platform?: string;
  state?: string;
};

/**
 * World's IDE service for the Code view: settings beside World's data,
 * connections from the profile catalogue. Servers start only on an open
 * and run on their host until Stop; World attaches to them.
 */
export function createWorldIde(deps: {
  root: string;
  /** The startup connection's `--ssh` destination, when World was given one. */
  sshHost?: string;
  /** Herdr TUI connections first, then herdr-core ones. */
  profiles: {
    list(): readonly ConnectionEntry[];
    coreList(): readonly ConnectionEntry[];
  };
  /** Sends a control message to every browser. */
  notify(message: string): void;
  environment?: IdeDetectEnvironment;
  /** Runs a read-only host command; defaults to ssh with a timeout. */
  runRemote?: (
    argv: string[],
    timeoutMs: number,
  ) => Promise<{ code: number; stdout: string }>;
}): IdeService {
  const runRemote = deps.runRemote ?? runProcessWithCodeTimeout;
  let revision = 0;
  const connections = () => [
    ...deps.profiles.list(),
    ...deps.profiles.coreList(),
  ];
  return new IdeService({
    settings: fileIdeSettingsStore(join(deps.root, "ide.json")),
    localRoot: join(deps.root, "ide"),
    instanceOptions: {
      // World runs as a systemd unit: its servers leave World's cgroup.
      systemdScope: Boolean(process.env.INVOCATION_ID),
    },
    environment: deps.environment ?? systemDetectEnvironment(),
    connection: (connectionId) => {
      const entry = connections().find((item) => item.id === connectionId);
      return entry ? ideConnection(entry, deps.sshHost) : null;
    },
    connectionIds: () => [...new Set(connections().map((item) => item.id))],
    remoteDetect: async (destination, provider, hostLabel) =>
      detectOnHost(runRemote, destination, provider, hostLabel),
    onChange: () =>
      deps.notify(
        JSON.stringify({
          control: { type: "world_ide_changed", revision: ++revision },
        }),
      ),
  });
}

export function ideConnection(
  entry: ConnectionEntry,
  sshHost: string | undefined,
): IdeConnection {
  const sshDestination =
    entry.id === STARTUP_DEFAULT_CONNECTION_ID && sshHost
      ? sshHost
      : entry.type === "ssh"
        ? entry.ssh_destination
        : undefined;
  return {
    id: entry.id,
    label: entry.label,
    type: sshDestination ? "ssh" : "local",
    generation: entry.generation,
    ...(sshDestination ? { sshDestination } : {}),
    ...(entry.remote_platform === "windows"
      ? { remotePlatform: "windows" as const }
      : {}),
    ...(entry.state !== undefined && entry.state !== "ready"
      ? { ready: false }
      : {}),
  };
}

/** Remote detection is a few file checks and `--version`, over SSH. */
const REMOTE_DETECT_TIMEOUT_MS = 20_000;

export async function detectOnHost(
  runRemote: (
    argv: string[],
    timeoutMs: number,
  ) => Promise<{ code: number; stdout: string }>,
  destination: string,
  provider: IdeProviderId,
  hostLabel: string,
): Promise<IdeDetection> {
  const result = await runRemote(
    sshReadCommandArgv(
      destination,
      remoteDetectCommand(provider),
      [],
      "ide-detect",
    ),
    REMOTE_DETECT_TIMEOUT_MS,
  );
  return parseRemoteDetection(provider, hostLabel, result);
}
