import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type IdeProviderId,
  ideServerArgs,
  ideUsesConnectionToken,
} from "./providers";
import { remoteExitReason, sshIdeArgv } from "./remote";
import { IDE_TOKEN_COOKIE, type IdeUpstream, ideBasePath } from "./proxy";

/**
 * World-owned IDE servers: at most one per (connection, provider, folder),
 * each on a private Unix socket in its own 0700 runtime folder with its own
 * random connection token. For a project over SSH the server runs on that
 * host and the socket is OpenSSH's forward of the host's own (remote.ts). World starts them only on an explicit open and
 * stops them on Stop, on disable, when their connection goes away and when
 * World stops.
 */
export type IdeInstanceState = "starting" | "ready" | "failed";

export type IdeInstanceView = {
  id: string;
  provider: IdeProviderId;
  connectionId: string;
  /** The connection's runtime generation World admitted it under. */
  generation: number;
  /** The SSH destination it runs on; absent on World's own computer. */
  sshDestination?: string;
  folder: string;
  state: IdeInstanceState;
  /** The same-origin address the Code view frames. */
  url: string;
  startedAt: string;
  /** Why it failed, in plain words. */
  reason?: string;
  /** True while the first start downloads the provider's web server. */
  downloading?: boolean;
};

type Instance = IdeInstanceView & {
  upstream: IdeUpstream;
  runtimeDir: string;
  child: IdeChild | null;
  stopping: boolean;
  ready: Promise<void>;
  lastOutput: string[];
};

export type IdeChild = {
  pid: number;
  exited: Promise<number | null>;
  /** Signal the whole process group. */
  kill(signal: NodeJS.Signals): void;
};

export type IdeSpawn = (options: {
  command: string[];
  cwd: string;
  /** Written to stdin, which then stays open for the child's life. */
  stdin?: string;
  onOutput(line: string): void;
}) => IdeChild;

/** Asks the upstream for its base page; resolves to the HTTP status or null. */
export type IdeProbe = (upstream: IdeUpstream) => Promise<number | null>;

export type IdeInstanceOptions = {
  spawn?: IdeSpawn;
  probe?: IdeProbe;
  /** Folder that holds every runtime folder; defaults to the system temp. */
  runtimeRoot?: string;
  now?: () => Date;
  /** Waits between readiness probes. */
  sleep?: (ms: number) => Promise<void>;
  /** Whole start budget, including the first-start download. */
  startTimeoutMs?: number;
  /** Running servers at once; not measured, a conservative guard. */
  maxInstances?: number;
  onChange?: () => void;
};

export class IdeLimitError extends Error {}

const DEFAULT_START_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_INSTANCES = 4;
const KILL_GRACE_MS = 3_000;
const MAX_OUTPUT_LINES = 20;

export function systemIdeSpawn(environment = process.env): IdeSpawn {
  return ({ command, cwd, stdin, onOutput }) => {
    const child = Bun.spawn(command, {
      cwd,
      env: environment,
      stdin: stdin === undefined ? "ignore" : "pipe",
      stdout: "pipe",
      stderr: "pipe",
      // Its own process group, so Stop also ends the server it starts.
      detached: true,
    } as Parameters<typeof Bun.spawn>[1]);
    for (const stream of [child.stdout, child.stderr])
      void readLines(stream as ReadableStream<Uint8Array>, onOutput);
    if (stdin !== undefined) {
      // Kept open: an ssh-launched server stops when its input ends.
      const sink = child.stdin as import("bun").FileSink;
      sink.write(stdin);
      void sink.flush();
    }
    return {
      pid: child.pid,
      exited: child.exited.then(
        () => child.exitCode,
        () => null,
      ),
      kill(signal) {
        try {
          process.kill(-child.pid, signal);
        } catch {
          try {
            child.kill(signal);
          } catch {
            // Already gone.
          }
        }
      },
    };
  };
}

async function readLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
) {
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    for await (const chunk of stream) {
      buffered += decoder.decode(chunk, { stream: true });
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) onLine(line);
      if (buffered.length > 4096) buffered = buffered.slice(-4096);
    }
  } catch {
    // The child closed its output.
  }
  if (buffered.trim()) onLine(buffered);
}

export const systemIdeProbe: IdeProbe = async (upstream) => {
  try {
    const response = await fetch(
      `http://localhost${upstream.stripsBasePath ? "/" : `${ideBasePath(upstream.instanceId)}/`}`,
      {
        unix: upstream.socketPath,
        headers: upstream.token
          ? { cookie: `${IDE_TOKEN_COOKIE}=${upstream.token}` }
          : {},
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      } as RequestInit,
    );
    await response.body?.cancel();
    return response.status;
  } catch {
    return null;
  }
};

function instanceKey(connectionId: string, provider: string, folder: string) {
  return `${connectionId}\u0000${provider}\u0000${folder}`;
}

function plainReason(lines: string[], code: number | null) {
  const last = [...lines]
    .reverse()
    .find((line) => /error|fail|denied|unable|not /i.test(line));
  const suffix = last ? `: ${last.trim().slice(0, 240)}` : ".";
  return `The IDE server stopped${code === null ? "" : ` (exit ${code})`}${suffix}`;
}

export class IdeInstances {
  private readonly byId = new Map<string, Instance>();
  private readonly byKey = new Map<string, string>();
  private readonly spawn: IdeSpawn;
  private readonly probe: IdeProbe;
  private readonly runtimeRoot: string;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly startTimeoutMs: number;
  private readonly maxInstances: number;
  private readonly onChange: () => void;
  private readonly revoked = new Set<(instanceId: string) => void>();

  constructor(options: IdeInstanceOptions = {}) {
    this.spawn = options.spawn ?? systemIdeSpawn();
    this.probe = options.probe ?? systemIdeProbe;
    this.runtimeRoot = options.runtimeRoot ?? tmpdir();
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((ms) => Bun.sleep(ms));
    this.startTimeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
    this.maxInstances = options.maxInstances ?? DEFAULT_MAX_INSTANCES;
    this.onChange = options.onChange ?? (() => {});
  }

  list(): IdeInstanceView[] {
    return [...this.byId.values()].map(view);
  }

  get(id: string): IdeInstanceView | null {
    const instance = this.byId.get(id);
    return instance ? view(instance) : null;
  }

  /** The proxy target, only while the server is ready and not stopping. */
  upstream(id: string): IdeUpstream | null {
    const instance = this.byId.get(id);
    return instance?.state === "ready" && !instance.stopping
      ? instance.upstream
      : null;
  }

  /**
   * Called with an instance's ID as soon as it starts to stop, for any
   * reason, so its open streams close before the server has exited.
   */
  onRevoked(listener: (instanceId: string) => void) {
    this.revoked.add(listener);
    return () => this.revoked.delete(listener);
  }

  /**
   * Start or reuse the server for this folder. Resolves once it is ready or
   * failed; a caller may also return early and read `get()` later.
   */
  open(request: {
    provider: IdeProviderId;
    binary: string;
    connectionId: string;
    generation: number;
    folder: string;
    /** Run it on this SSH host instead of World's computer. */
    ssh?: { destination: string; hostLabel: string };
  }): { instance: IdeInstanceView; ready: Promise<IdeInstanceView> } {
    const key = instanceKey(
      request.connectionId,
      request.provider,
      request.folder,
    );
    const existingId = this.byKey.get(key);
    const existing = existingId ? this.byId.get(existingId) : undefined;
    if (
      existing &&
      existing.state !== "failed" &&
      !existing.stopping &&
      existing.generation === request.generation &&
      existing.sshDestination === request.ssh?.destination
    )
      return {
        instance: view(existing),
        ready: existing.ready.then(() => view(existing)),
      };
    // A failed one is gone already; one from an older generation or
    // another transport stops.
    if (existing?.state === "failed") this.discard(existing);
    else if (existing && !existing.stopping) void this.stopInstance(existing);
    const running = [...this.byId.values()].filter(
      (entry) => entry.state !== "failed" && !entry.stopping,
    ).length;
    if (running >= this.maxInstances)
      throw new IdeLimitError(
        `World runs at most ${this.maxInstances} IDE servers at once. Stop one in the Code view first.`,
      );

    const id = randomBytes(16).toString("base64url");
    const runtimeDir = mkdtempSync(join(this.runtimeRoot, "hw-ide-"));
    const socketPath = join(runtimeDir, "ide.sock");
    const tokenFile = join(runtimeDir, "token");
    const usesToken = ideUsesConnectionToken(request.provider);
    const token = usesToken ? randomBytes(24).toString("base64url") : null;
    const basePath = ideBasePath(id);
    const { args, stripsBasePath } = ideServerArgs(request.provider, {
      basePath,
      socketPath,
      tokenFile,
      folder: request.folder,
    });
    let launch: { command: string[]; cwd: string; stdin?: string };
    if (request.ssh) {
      const remote = sshIdeArgv({
        destination: request.ssh.destination,
        provider: request.provider,
        binary: request.binary,
        basePath,
        folder: request.folder,
        localSocket: socketPath,
        remoteId: randomBytes(16).toString("base64url"),
        token,
      });
      launch = { command: remote.argv, cwd: runtimeDir, stdin: remote.stdin };
    } else {
      if (token) writeFileSync(tokenFile, token, { mode: 0o600 });
      launch = { command: [request.binary, ...args], cwd: request.folder };
    }
    const instance: Instance = {
      id,
      provider: request.provider,
      connectionId: request.connectionId,
      generation: request.generation,
      ...(request.ssh ? { sshDestination: request.ssh.destination } : {}),
      folder: request.folder,
      state: "starting",
      url: `${basePath}/`,
      startedAt: this.now().toISOString(),
      upstream: {
        instanceId: id,
        provider: request.provider,
        socketPath,
        token,
        stripsBasePath,
      },
      runtimeDir,
      child: null,
      stopping: false,
      ready: Promise.resolve(),
      lastOutput: [],
    };
    this.byId.set(id, instance);
    this.byKey.set(key, id);
    try {
      instance.child = this.spawn({
        ...launch,
        onOutput: (line) => {
          instance.lastOutput.push(line);
          if (instance.lastOutput.length > MAX_OUTPUT_LINES)
            instance.lastOutput.shift();
        },
      });
    } catch (error) {
      this.fail(
        instance,
        `World couldn't start the IDE server: ${(error as Error).message}`,
      );
      return {
        instance: view(instance),
        ready: Promise.resolve(view(instance)),
      };
    }
    const child = instance.child;
    void child.exited.then((code) => {
      if (instance.stopping || !this.byId.has(instance.id)) return;
      this.fail(
        instance,
        (request.ssh && remoteExitReason(code, request.ssh.hostLabel)) ||
          plainReason(instance.lastOutput, code),
      );
      instance.child = null;
    });
    instance.ready = this.waitReady(instance);
    this.onChange();
    return {
      instance: view(instance),
      ready: instance.ready.then(() => view(instance)),
    };
  }

  private async waitReady(instance: Instance) {
    const deadline = this.now().getTime() + this.startTimeoutMs;
    let delay = 100;
    while (instance.state === "starting") {
      if (this.now().getTime() > deadline) {
        this.fail(instance, "The IDE server didn't become ready in time.");
        await this.stopInstance(instance, false);
        return;
      }
      if (existsSync(instance.upstream.socketPath)) {
        const status = await this.probe(instance.upstream);
        if (instance.state !== "starting") return;
        if (status === 202) {
          // VS Code's CLI is still downloading its web server.
          if (!instance.downloading) {
            instance.downloading = true;
            this.onChange();
          }
        } else if (status !== null && status < 500) {
          instance.state = "ready";
          instance.downloading = undefined;
          this.onChange();
          return;
        }
      }
      await this.sleep(delay);
      delay = Math.min(delay * 2, 1_000);
    }
  }

  private fail(instance: Instance, reason: string) {
    if (instance.state === "failed") return;
    instance.state = "failed";
    instance.reason = reason;
    instance.downloading = undefined;
    this.onChange();
  }

  private discard(instance: Instance) {
    this.byId.delete(instance.id);
    const key = instanceKey(
      instance.connectionId,
      instance.provider,
      instance.folder,
    );
    if (this.byKey.get(key) === instance.id) this.byKey.delete(key);
    rmSync(instance.runtimeDir, { recursive: true, force: true });
  }

  private async stopInstance(instance: Instance, notify = true) {
    if (!instance.stopping)
      for (const listener of this.revoked) listener(instance.id);
    instance.stopping = true;
    const child = instance.child;
    instance.child = null;
    if (child) {
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
      await child.exited;
      clearTimeout(timer);
    }
    this.discard(instance);
    if (notify) this.onChange();
  }

  async stop(id: string): Promise<boolean> {
    const instance = this.byId.get(id);
    if (!instance) return false;
    await this.stopInstance(instance);
    return true;
  }

  /** Stop what matches; used for disable, connection removal and shutdown. */
  async stopWhere(match: (instance: IdeInstanceView) => boolean) {
    const matching = [...this.byId.values()].filter((entry) => match(entry));
    await Promise.all(matching.map((entry) => this.stopInstance(entry, false)));
    if (matching.length) this.onChange();
    return matching.length;
  }

  stopAll() {
    return this.stopWhere(() => true);
  }
}

function view(instance: Instance): IdeInstanceView {
  return {
    id: instance.id,
    provider: instance.provider,
    connectionId: instance.connectionId,
    generation: instance.generation,
    ...(instance.sshDestination
      ? { sshDestination: instance.sshDestination }
      : {}),
    folder: instance.folder,
    state: instance.state,
    url: instance.url,
    startedAt: instance.startedAt,
    ...(instance.reason ? { reason: instance.reason } : {}),
    ...(instance.downloading ? { downloading: true } : {}),
  };
}
