import type { IdeForward, IdeHostRun } from "./hosts";
import type { IdeProviderId } from "./providers";
import type { IdeUpstream } from "./proxy";
import type { IdeServerRecord } from "./settings";

/** What World shows and keeps of the IDE servers it started (instances.ts). */
export type IdeInstanceState =
  /** Attaching, or waiting for the server to answer. */
  | "starting"
  | "ready"
  /** Runs on its host; World isn't attached (Open attaches again). */
  | "detached"
  /** Exited on its own, or never started. */
  | "failed";

export type IdeInstanceView = {
  id: string;
  provider: IdeProviderId;
  connectionId: string;
  /** The connection's runtime generation World is attached under; -1 when not attached. */
  generation: number;
  /** The SSH destination it runs on; absent on World's own computer. */
  sshDestination?: string;
  /** The host's name when World last reached it. */
  hostLabel: string;
  folder: string;
  state: IdeInstanceState;
  /** The same-origin address the Code view frames. */
  url: string;
  /** When it started on its host. */
  startedAt: string;
  /** Why it failed or is detached, in plain words. */
  reason?: string;
  /** True while the first start downloads the provider's web server. */
  downloading?: boolean;
  /** True while Stop is ending it. */
  stopping?: boolean;
};

/** Asks the upstream for its base page; resolves to the HTTP status or null. */
export type IdeProbe = (upstream: IdeUpstream) => Promise<number | null>;

export type IdeInstanceOptions = {
  /** World's private folder: servers on this computer and SSH forward sockets. */
  localRoot: string;
  /** This World's identity on every host. */
  worldId: () => string;
  run?: IdeHostRun;
  forward?: IdeForward;
  probe?: IdeProbe;
  now?: () => Date;
  /** Waits between readiness probes. */
  sleep?: (ms: number) => Promise<void>;
  /** Whole start budget, including the first-start download. */
  startTimeoutMs?: number;
  /** Servers at once, running anywhere; not measured, a conservative guard. */
  maxInstances?: number;
  /** Local servers leave World's systemd cgroup (World runs as a unit). */
  systemdScope?: boolean;
  /** The host's SIGTERM grace before SIGKILL; tests shorten it. */
  stopGraceMs?: number;
  onChange?: () => void;
  /**
   * Where World keeps the servers it started across restarts. Without it
   * the list lives only as long as World.
   */
  inventory?: IdeInventory;
  /**
   * Whether a connection still admits a server: an Open or a reattach that
   * waited its turn checks it again before touching the host.
   */
  admits?: (
    entry: Pick<
      IdeInstanceView,
      "provider" | "connectionId" | "generation" | "sshDestination"
    >,
  ) => boolean;
};

/** The durable list of servers World started and hasn't seen end. */
export type IdeInventory = {
  read(): IdeServerRecord[];
  write(records: IdeServerRecord[]): void;
};

export type IdeOpenRequest = {
  provider: IdeProviderId;
  binary: string;
  connectionId: string;
  generation: number;
  folder: string;
  /** It runs on this SSH host instead of World's computer. */
  ssh?: { destination: string; hostLabel: string };
};

export type IdeStopResult = { ok: true } | { ok: false; reason: string };
