import { join } from "node:path";
import { STARTUP_DEFAULT_CONNECTION_ID } from "../connections/types";
import {
  type IdeDetectEnvironment,
  systemDetectEnvironment,
} from "./providers";
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
};

/**
 * World's IDE service for the Code view: settings beside World's data,
 * connections from the profile catalogue. Servers start only on an open.
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
}): IdeService {
  let revision = 0;
  const connections = () => [
    ...deps.profiles.list(),
    ...deps.profiles.coreList(),
  ];
  return new IdeService({
    settings: fileIdeSettingsStore(join(deps.root, "ide.json")),
    environment: deps.environment ?? systemDetectEnvironment(),
    connection: (connectionId) => {
      const entry = connections().find((item) => item.id === connectionId);
      return entry ? ideConnection(entry, deps.sshHost) : null;
    },
    connectionIds: () => [...new Set(connections().map((item) => item.id))],
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
  };
}
