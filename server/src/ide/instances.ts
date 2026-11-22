import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  definiteStartFailure,
  HOST_STOP_GRACE_MS,
  hostAttachScript,
  hostFailure,
  hostListScript,
  hostStartScript,
  hostStopScript,
  type IdeHostRoot,
  parseHostLines,
  parseHostList,
  parseHostPending,
  plainExitReason,
  startWaitReason,
} from "./host";
import {
  type IdeForward,
  type IdeForwardChild,
  type IdeHostRun,
  type IdeHostTarget,
  systemForward,
  systemHostRun,
} from "./hosts";
import {
  type IdeProviderId,
  ideServerArgs,
  ideUsesConnectionToken,
} from "./providers";
import { IDE_TOKEN_COOKIE, type IdeUpstream, ideBasePath } from "./proxy";
import type { IdeServerRecord } from "./settings";

export type {
  IdeInstanceOptions,
  IdeInstanceState,
  IdeInstanceView,
  IdeInventory,
  IdeOpenRequest,
  IdeProbe,
  IdeStopResult,
} from "./instance-types";
import type {
  IdeInstanceOptions,
  IdeInstanceState,
  IdeInstanceView,
  IdeOpenRequest,
  IdeProbe,
  IdeStopResult,
} from "./instance-types";

/**
 * The IDE servers World started (#1009): at most one per (connection, host,
 * provider, folder). Each lives on its host, detached from World (host.ts):
 * World attaches to it (a private Unix socket, for SSH through one `ssh -N`
 * forward) and detaches again when the Code view's connection reconnects,
 * SSH drops or World stops, without stopping it. After a restart World
 * lists the servers on each host, checks they are its own, and reattaches.
 * Only a person pressing Stop ends one: not the cap, not disabling the
 * provider, not removing the connection. World keeps the ones it started
 * in a durable inventory until Stop succeeds or the host shows them gone,
 * so none runs unseen after a restart, even on a host it can't reach.
 */

type Instance = IdeInstanceView & {
  key: string;
  upstream: IdeUpstream | null;
  forward: IdeForwardChild | null;
  /** Bumped on every attach, detach and stop: a stale wait gives up. */
  epoch: number;
  /** The generation World last tried to reattach under on its own. */
  autoAttached?: number;
};

export class IdeLimitError extends Error {}
/** The connection changed while an Open waited its turn. */
export class IdeStaleError extends Error {}

const DEFAULT_START_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_INSTANCES = 4;
/** A host script: ssh connect plus a few file and process checks. */
const HOST_RUN_TIMEOUT_MS = 30_000;
/** While waiting to answer, look on the host this often for an early exit. */
const HOST_CHECK_MS = 3_000;
/** Another start mid-launch on the host: how often and long to look again. */
const STARTING_LOOK_MS = 200;
const STARTING_LOOKS = 25;
/** VS Code retried its server download this often while World waited. */
const DOWNLOAD_RETRIES = 2;

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

const hostOf = (ssh?: { destination: string }) =>
  ssh ? `ssh:${ssh.destination}` : "local";

function instanceKey(
  connectionId: string,
  host: string,
  provider: string,
  folder: string,
) {
  return [connectionId, host, provider, folder].join("\u0000");
}

export class IdeInstances {
  private readonly byId = new Map<string, Instance>();
  private readonly run: IdeHostRun;
  private readonly forward: IdeForward;
  private readonly probe: IdeProbe;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly startTimeoutMs: number;
  private readonly maxInstances: number;
  private readonly stopGraceMs: number;
  private readonly onChange: () => void;
  private readonly revoked = new Set<(instanceId: string) => void>();
  /** One operation at a time per server: open, reattach and stop queue. */
  private readonly queues = new Map<string, Promise<unknown>>();
  /**
   * Bumped on every attach, detach, start and new entry, World-wide: a host
   * answer or list sent before is stale, even for a recreated entry.
   */
  private epochs = 0;

  constructor(private readonly options: IdeInstanceOptions) {
    this.run = options.run ?? systemHostRun();
    this.forward = options.forward ?? systemForward();
    this.probe = options.probe ?? systemIdeProbe;
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((ms) => Bun.sleep(ms));
    this.startTimeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
    this.maxInstances = options.maxInstances ?? DEFAULT_MAX_INSTANCES;
    this.stopGraceMs = options.stopGraceMs ?? HOST_STOP_GRACE_MS;
    const onChange = options.onChange ?? (() => {});
    this.onChange = () => {
      this.persist();
      onChange();
    };
    this.restore();
  }

  /** Last inventory written, to write only when it changes. */
  private persisted = "";

  /**
   * The servers World started before it restarted: listed as running but
   * not attached until World reaches their host again.
   */
  private restore() {
    for (const record of this.options.inventory?.read() ?? []) {
      if (this.byId.has(record.id)) continue;
      const ssh = record.ssh_destination
        ? { destination: record.ssh_destination }
        : undefined;
      this.byId.set(record.id, {
        id: record.id,
        key: instanceKey(
          record.connection_id,
          hostOf(ssh),
          record.provider,
          record.folder,
        ),
        provider: record.provider,
        connectionId: record.connection_id,
        generation: -1,
        ...(ssh ? { sshDestination: ssh.destination } : {}),
        hostLabel: record.host_label,
        folder: record.folder,
        state: "detached",
        reason: `World hasn't reached ${record.host_label} since it started again; it runs there until you stop it.`,
        url: `${ideBasePath(record.id)}/`,
        startedAt: record.started_at,
        upstream: null,
        forward: null,
        epoch: ++this.epochs,
      });
    }
    this.persisted = JSON.stringify(this.records());
  }

  /** Every server that may still run: all but those known to have ended. */
  private records(): IdeServerRecord[] {
    return [...this.byId.values()]
      .filter((entry) => entry.state !== "failed")
      .map((entry) => ({
        id: entry.id,
        provider: entry.provider,
        connection_id: entry.connectionId,
        ...(entry.sshDestination
          ? { ssh_destination: entry.sshDestination }
          : {}),
        host_label: entry.hostLabel,
        folder: entry.folder,
        started_at: entry.startedAt,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  private persist() {
    const inventory = this.options.inventory;
    if (!inventory) return;
    const text = JSON.stringify(this.records());
    if (text === this.persisted) return;
    inventory.write(JSON.parse(text));
    this.persisted = text;
  }

  private get localHostRoot(): IdeHostRoot {
    return { path: join(this.options.localRoot, "servers") };
  }

  private rootFor(instance: { sshDestination?: string }): IdeHostRoot {
    return instance.sshDestination ? { remote: true } : this.localHostRoot;
  }

  private target(instance: { sshDestination?: string }): IdeHostTarget {
    return instance.sshDestination
      ? { kind: "ssh", destination: instance.sshDestination }
      : { kind: "local" };
  }

  /** Deterministic per World, connection, host, provider and folder. */
  idFor(request: {
    connectionId: string;
    provider: IdeProviderId;
    folder: string;
    sshDestination?: string;
  }) {
    return createHash("sha256")
      .update(
        [
          this.options.worldId(),
          request.connectionId,
          hostOf(
            request.sshDestination
              ? { destination: request.sshDestination }
              : undefined,
          ),
          request.provider,
          request.folder,
        ].join("\u0000"),
      )
      .digest("base64url")
      .slice(0, 22);
  }

  list(): IdeInstanceView[] {
    return [...this.byId.values()].map(view);
  }

  get(id: string): IdeInstanceView | null {
    const instance = this.byId.get(id);
    return instance ? view(instance) : null;
  }

  /** The proxy target, only while World is attached and it answers. */
  upstream(id: string): IdeUpstream | null {
    const instance = this.byId.get(id);
    return instance?.state === "ready" && !instance.stopping
      ? instance.upstream
      : null;
  }

  /**
   * Called with an instance's ID as soon as World detaches from it or
   * starts to stop it, so its open streams close.
   */
  onRevoked(listener: (instanceId: string) => void) {
    this.revoked.add(listener);
    return () => this.revoked.delete(listener);
  }

  private serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    const settled = next.then(
      () => {},
      () => {},
    );
    this.queues.set(key, settled);
    void settled.then(() => {
      if (this.queues.get(key) === settled) this.queues.delete(key);
    });
    return next;
  }

  private busy(key: string) {
    return this.queues.has(key);
  }

  private live() {
    return [...this.byId.values()].filter((entry) => entry.state !== "failed");
  }

  /**
   * Attach to this folder's server, or start it. Resolves once World is
   * attaching (state `starting`), or with why not; readiness follows.
   */
  open(request: IdeOpenRequest): Promise<IdeInstanceView> {
    const key = instanceKey(
      request.connectionId,
      hostOf(request.ssh),
      request.provider,
      request.folder,
    );
    return this.serial(key, async () => {
      // Queued behind another operation: the connection may have changed.
      if (
        this.options.admits?.({
          provider: request.provider,
          connectionId: request.connectionId,
          generation: request.generation,
          ...(request.ssh ? { sshDestination: request.ssh.destination } : {}),
        }) === false
      )
        throw new IdeStaleError(
          "The connection changed while the IDE was starting. Choose the project again.",
        );
      const id = this.idFor({
        ...request,
        sshDestination: request.ssh?.destination,
      });
      let instance = this.byId.get(id);
      if (
        instance &&
        !instance.stopping &&
        (instance.state === "ready" || instance.state === "starting") &&
        instance.generation === request.generation
      )
        return view(instance);
      if (!instance || instance.state === "failed") {
        const running = this.live().filter((entry) => entry.id !== id).length;
        if (running >= this.maxInstances)
          throw new IdeLimitError(
            `World runs at most ${this.maxInstances} IDE servers at once. Stop one first.`,
          );
      }
      if (!instance) {
        instance = {
          id,
          key,
          provider: request.provider,
          connectionId: request.connectionId,
          generation: request.generation,
          ...(request.ssh ? { sshDestination: request.ssh.destination } : {}),
          hostLabel: request.ssh?.hostLabel ?? "this computer",
          folder: request.folder,
          state: "starting",
          url: `${ideBasePath(id)}/`,
          startedAt: this.now().toISOString(),
          upstream: null,
          forward: null,
          epoch: ++this.epochs,
          autoAttached: request.generation,
        };
        this.byId.set(id, instance);
        this.onChange();
        await this.start(instance, request);
        return view(instance);
      }
      if (request.ssh) instance.hostLabel = request.ssh.hostLabel;
      // Retire an attachment under an older generation before re-stamping.
      this.release(instance);
      instance.autoAttached = request.generation;
      const known = instance.state;
      instance.generation = request.generation;
      this.setState(instance, "starting");
      if (known === "failed") await this.start(instance, request);
      else if ((await this.attach(instance, request.generation)) === "gone")
        // Gone from its host meanwhile: start it afresh.
        await this.start(instance, request);
      return view(instance);
    });
  }

  /**
   * Reattach under a new generation without a click: after a restart or
   * reconnect, once per generation. Starts nothing; one that is gone from
   * its host is forgotten.
   */
  reattach(id: string, generation: number, hostLabel?: string) {
    const instance = this.byId.get(id);
    if (
      !instance ||
      instance.state !== "detached" ||
      instance.stopping ||
      instance.autoAttached === generation
    )
      return Promise.resolve();
    instance.autoAttached = generation;
    return this.serial(instance.key, async () => {
      if (
        this.byId.get(id) !== instance ||
        instance.state !== "detached" ||
        instance.stopping ||
        this.options.admits?.({ ...view(instance), generation }) === false
      )
        return;
      if (hostLabel) instance.hostLabel = hostLabel;
      instance.generation = generation;
      this.setState(instance, "starting");
      if ((await this.attach(instance, generation)) === "gone") {
        this.release(instance);
        if (this.byId.get(id) === instance) this.byId.delete(id);
        this.onChange();
      }
    });
  }

  private setState(
    instance: Instance,
    state: IdeInstanceState,
    reason?: string,
  ) {
    instance.state = state;
    instance.reason = reason;
    if (state !== "starting") instance.downloading = undefined;
    if (state !== "ready" && state !== "starting") instance.generation = -1;
    this.onChange();
  }

  /**
   * Whether World still wants this attach: nothing detached, stopped or
   * replaced it while a host script ran.
   */
  private wanted(instance: Instance, epoch: number) {
    return (
      instance.epoch === epoch &&
      !instance.stopping &&
      instance.state === "starting" &&
      this.byId.get(instance.id) === instance
    );
  }

  /** Launches it on its host; on success World attaches with its token. */
  private async start(instance: Instance, request: IdeOpenRequest) {
    const token = ideUsesConnectionToken(request.provider)
      ? randomBytes(24).toString("base64url")
      : null;
    const startedAt = this.now().toISOString();
    let script: string;
    try {
      script = hostStartScript({
        root: this.rootFor(instance),
        id: instance.id,
        worldId: this.options.worldId(),
        connectionId: request.connectionId,
        provider: request.provider,
        binary: request.binary,
        basePath: ideBasePath(instance.id),
        folder: request.folder,
        startedAt,
        nonce: randomBytes(16).toString("base64url"),
        token: token !== null,
        systemdScope: !request.ssh && this.options.systemdScope === true,
        stopGraceMs: this.stopGraceMs,
      });
    } catch (error) {
      this.fail(instance, (error as Error).message);
      return;
    }
    // A list sent before this start can't see it: it must not forget it.
    const epoch = (instance.epoch = ++this.epochs);
    const result = await this.run(this.target(instance), script, {
      stdin: token ? `${token}\n` : undefined,
      timeoutMs: HOST_RUN_TIMEOUT_MS,
    });
    const { values } = parseHostLines(result.stdout);
    const outcome =
      values.get("result") === "started" || values.get("result") === "running"
        ? values.get("result")
        : undefined;
    if (outcome === "started") instance.startedAt = startedAt;
    // Detached or stopping meanwhile: what started runs on, listed.
    if (!this.wanted(instance, epoch)) return;
    if (!outcome) {
      if (definiteStartFailure(result.code)) {
        // The script refused before it launched anything.
        this.fail(
          instance,
          hostFailure(result.code, instance.hostLabel, Boolean(request.ssh)),
        );
        return;
      }
      // No answer: the reply may be all that was lost (SSH dropping after
      // the launch, a timeout). It may run, so it stays listed and counted
      // until its host shows it gone or Stop ends it.
      this.setState(
        instance,
        "detached",
        `World lost its answer from ${instance.hostLabel} while starting it, so it may be running there. Open it to check, or Stop it.`,
      );
      return;
    }
    if (outcome === "running") {
      // Already there (another World's start, or not yet listed here).
      if ((await this.attach(instance, request.generation)) === "gone")
        this.fail(instance, "The IDE server no longer runs.");
      return;
    }
    this.connect(instance, values.get("root") ?? "", token, request.generation);
  }

  /**
   * Checks the server on its host is this World's and still runs, then
   * attaches. `gone` when nothing is there; `done` otherwise (attached,
   * or detached or failed with why). One still starting there (another
   * start launching it) is looked at again for a few seconds first.
   */
  private async attach(
    instance: Instance,
    generation: number,
    tries = 0,
  ): Promise<"done" | "gone"> {
    const epoch = instance.epoch;
    const result = await this.run(
      this.target(instance),
      hostAttachScript({
        root: this.rootFor(instance),
        id: instance.id,
        worldId: this.options.worldId(),
        provider: instance.provider,
        folder: instance.folder,
        stopGraceMs: this.stopGraceMs,
      }),
      { timeoutMs: HOST_RUN_TIMEOUT_MS },
    );
    if (!this.wanted(instance, epoch)) return "done";
    const { values, log } = parseHostLines(result.stdout);
    const state = values.get("state");
    if (result.code !== 0 || !state) {
      this.setState(
        instance,
        "detached",
        hostFailure(
          result.code,
          instance.hostLabel,
          Boolean(instance.sshDestination),
        ),
      );
      return "done";
    }
    if (state === "gone") return "gone";
    const started = values.get("started");
    if (started) instance.startedAt = started;
    if (state === "running") {
      const token = values.get("token") ?? null;
      if (ideUsesConnectionToken(instance.provider) && !token) {
        this.setState(
          instance,
          "detached",
          `World couldn't read its access token on ${instance.hostLabel}.`,
        );
        return "done";
      }
      this.connect(instance, values.get("root") ?? "", token, generation);
      return "done";
    }
    if (state === "starting" && tries < STARTING_LOOKS) {
      await this.sleep(STARTING_LOOK_MS);
      if (!this.wanted(instance, epoch)) return "done";
      return this.attach(instance, generation, tries + 1);
    }
    if (state === "starting") {
      this.setState(
        instance,
        "detached",
        `It is still starting on ${instance.hostLabel}. Open it again in a moment.`,
      );
      return "done";
    }
    if (state === "stopping") {
      // A Stop of it didn't finish on its host: it may still run.
      this.setState(
        instance,
        "detached",
        `A Stop of it didn't finish on ${instance.hostLabel}; Stop it again.`,
      );
      return "done";
    }
    if (state === "foreign") {
      this.fail(
        instance,
        `Another IDE server holds this folder's place on ${instance.hostLabel}.`,
      );
      return "done";
    }
    const code = values.get("exit");
    this.fail(
      instance,
      plainExitReason(log, code && /^\d+$/.test(code) ? Number(code) : null),
    );
    return "done";
  }

  private connect(
    instance: Instance,
    hostRoot: string,
    token: string | null,
    generation: number,
  ) {
    this.release(instance);
    const epoch = (instance.epoch = ++this.epochs);
    instance.generation = generation;
    const remoteSocket = `${hostRoot}/${instance.id}/ide.sock`;
    let socketPath = remoteSocket;
    if (instance.sshDestination) {
      const forwards = join(this.options.localRoot, "forwards");
      mkdirSync(forwards, { recursive: true, mode: 0o700 });
      chmodSync(forwards, 0o700);
      socketPath = join(forwards, `${instance.id}.sock`);
      const forward = this.forward(
        instance.sshDestination,
        remoteSocket,
        socketPath,
      );
      instance.forward = forward;
      void forward.exited.then(() => {
        if (instance.epoch !== epoch || instance.forward !== forward) return;
        instance.forward = null;
        this.detach(
          instance,
          `SSH to ${instance.hostLabel} dropped; the IDE still runs there. Open it to reconnect.`,
        );
      });
    }
    instance.upstream = {
      instanceId: instance.id,
      provider: instance.provider,
      socketPath,
      token,
      stripsBasePath: ideServerArgs(instance.provider, {
        basePath: "",
        socketPath: "",
        tokenFile: "",
        folder: instance.folder,
      }).stripsBasePath,
    };
    this.setState(instance, "starting");
    void this.waitReady(instance, epoch);
  }

  private async waitReady(instance: Instance, epoch: number) {
    const current = () =>
      instance.epoch === epoch &&
      instance.state === "starting" &&
      this.byId.get(instance.id) === instance;
    const deadline = this.now().getTime() + this.startTimeoutMs;
    let delay = 100;
    let nextCheck = this.now().getTime() + HOST_CHECK_MS;
    let firstDownloads: number | null = null;
    while (current()) {
      const upstream = instance.upstream;
      if (!upstream) return;
      if (this.now().getTime() > deadline) {
        this.detach(
          instance,
          startWaitReason(
            instance.hostLabel,
            instance.downloading ? "downloading" : "timeout",
          ),
        );
        return;
      }
      if (existsSync(upstream.socketPath)) {
        const status = await this.probe(upstream);
        if (!current()) return;
        if (status === 202) {
          // VS Code's CLI is still downloading its web server.
          if (!instance.downloading) {
            instance.downloading = true;
            this.onChange();
          }
        } else if (status !== null && status < 500) {
          this.setState(instance, "ready");
          return;
        }
      }
      if (this.now().getTime() >= nextCheck) {
        nextCheck = this.now().getTime() + HOST_CHECK_MS;
        const downloads = await this.stillRuns(instance, epoch);
        if (downloads === null) return;
        if (downloads >= 0) firstDownloads ??= downloads;
        if (downloads - (firstDownloads ?? downloads) >= DOWNLOAD_RETRIES) {
          this.detach(
            instance,
            startWaitReason(instance.hostLabel, { downloads }),
          );
          return;
        }
      }
      await this.sleep(delay);
      delay = Math.min(delay * 2, 1_000);
    }
  }

  /** Exited: failed with why, null. Else downloads begun (-1: unknown). */
  private async stillRuns(instance: Instance, epoch: number) {
    const result = await this.run(
      this.target(instance),
      hostAttachScript({
        root: this.rootFor(instance),
        id: instance.id,
        worldId: this.options.worldId(),
        provider: instance.provider,
        folder: instance.folder,
        stopGraceMs: this.stopGraceMs,
      }),
      { timeoutMs: HOST_RUN_TIMEOUT_MS },
    );
    if (instance.epoch !== epoch || instance.state !== "starting") return null;
    if (result.code !== 0) return -1;
    const { values, log } = parseHostLines(result.stdout);
    const state = values.get("state");
    if (state === "exited" || state === "gone") {
      const code = values.get("exit");
      this.release(instance);
      this.fail(
        instance,
        plainExitReason(log, code && /^\d+$/.test(code) ? Number(code) : null),
      );
      return null;
    }
    return Number(values.get("downloads")) || 0;
  }

  /** Ends World's attachment: its streams and forward. The server runs on. */
  private release(instance: Instance) {
    instance.epoch = ++this.epochs;
    // Streams only exist through an upstream; say so once per attachment.
    if (instance.upstream)
      for (const listener of this.revoked) listener(instance.id);
    const forward = instance.forward;
    instance.forward = null;
    forward?.kill();
    instance.upstream = null;
  }

  private detach(instance: Instance, reason?: string) {
    this.release(instance);
    if (instance.state === "failed") return;
    instance.generation = -1;
    this.setState(instance, "detached", reason);
  }

  private fail(instance: Instance, reason: string) {
    if (instance.state === "failed" && instance.reason === reason) return;
    this.release(instance);
    this.setState(instance, "failed", reason);
  }

  /**
   * Detach from those that match, without stopping them: a reconnect, a
   * change of host or a lost admission. Returns how many.
   */
  detachWhere(match: (instance: IdeInstanceView) => boolean, reason?: string) {
    let count = 0;
    for (const instance of this.byId.values())
      if (
        !instance.stopping &&
        (instance.state === "ready" || instance.state === "starting") &&
        match(view(instance))
      ) {
        this.detach(instance, reason);
        count++;
      }
    return count;
  }

  /** Stop one completely on its host: every process it started. */
  stop(id: string): Promise<IdeStopResult> {
    const instance = this.byId.get(id);
    if (!instance) return Promise.resolve({ ok: true });
    instance.stopping = true;
    this.release(instance);
    this.onChange();
    return this.serial(instance.key, async () => {
      if (this.byId.get(id) !== instance) return { ok: true } as const;
      const result = await this.run(
        this.target(instance),
        hostStopScript(
          this.rootFor(instance),
          instance.id,
          this.options.worldId(),
          this.stopGraceMs,
        ),
        { timeoutMs: HOST_RUN_TIMEOUT_MS + this.stopGraceMs },
      );
      const outcome = parseHostLines(result.stdout).values.get("result");
      instance.stopping = undefined;
      if (
        (result.code === 0 && (outcome === "stopped" || outcome === "gone")) ||
        // It had already exited: only its record is left on the host.
        // `failed` only ever comes from the host's own evidence (an exit
        // code, its folder gone) or a start refused before launching; an
        // unanswered start stays `detached`.
        (instance.state === "failed" && outcome !== "foreign")
      ) {
        this.byId.delete(id);
        this.onChange();
        return { ok: true } as const;
      }
      const reason =
        outcome === "foreign"
          ? `The server on ${instance.hostLabel} isn't this World's; World left it alone.`
          : `World couldn't stop it: ${hostFailure(result.code, instance.hostLabel, Boolean(instance.sshDestination))} It still runs there.`;
      this.setState(
        instance,
        instance.state === "failed" ? "failed" : "detached",
        reason,
      );
      return { ok: false, reason } as const;
    });
  }

  /**
   * Stops listing one World can't reach any more, after the person stopped
   * it by hand on its host. Nothing on the host changes.
   */
  forget(id: string) {
    const instance = this.byId.get(id);
    if (!instance || instance.stopping || this.busy(instance.key)) return false;
    this.release(instance);
    this.byId.delete(id);
    this.onChange();
    return true;
  }

  /** Stop every one that matches (tests clean up with it). */
  async stopWhere(match: (instance: IdeInstanceView) => boolean) {
    const matching = [...this.byId.values()].filter((entry) =>
      match(view(entry)),
    );
    const results = await Promise.all(
      matching.map((entry) => this.stop(entry.id)),
    );
    return results.filter(
      (result): result is { ok: false; reason: string } => !result.ok,
    );
  }

  /**
   * Lists this World's servers on one host and merges them: new ones show
   * as detached (or failed when they exited), known ones that exited fail,
   * known detached ones that are gone are forgotten. Each keeps the
   * connection it was started for, even one since removed, so nothing
   * World started runs unseen.
   */
  async discover(host: { ssh?: { destination: string; hostLabel: string } }) {
    const sshDestination = host.ssh?.destination;
    const before = new Map(
      [...this.byId.values()].map((entry) => [entry.id, entry.epoch]),
    );
    const result = await this.run(
      this.target({ sshDestination }),
      hostListScript(
        this.rootFor({ sshDestination }),
        this.options.worldId(),
        this.stopGraceMs,
      ),
      { timeoutMs: HOST_RUN_TIMEOUT_MS },
    );
    if (result.code !== 0) return false;
    const records = parseHostList(result.stdout);
    // A pending one may still be launching (or a Stop of it unfinished):
    // neither failed nor gone yet.
    const pending = parseHostPending(result.stdout);
    const seen = new Set([...records.map((record) => record.id), ...pending]);
    let changed = false;
    for (const record of records) {
      const known = this.byId.get(record.id);
      if (known) {
        const quiet =
          !known.stopping &&
          !this.busy(known.key) &&
          before.get(known.id) === known.epoch;
        if (
          quiet &&
          record.state === "exited" &&
          known.state !== "failed" &&
          !pending.has(known.id)
        ) {
          this.fail(known, plainExitReason([], record.exitCode ?? null));
          changed = true;
        } else if (
          quiet &&
          record.state !== "exited" &&
          known.state === "failed"
        ) {
          // Marked failed, yet it runs (a start that answered late): Stop
          // must still reach it.
          this.setState(known, "detached");
        }
        continue;
      }
      const connectionId = record.connectionId;
      const key = instanceKey(
        connectionId,
        hostOf(host.ssh),
        record.provider,
        record.folder,
      );
      if (this.busy(key)) continue;
      this.byId.set(record.id, {
        id: record.id,
        key,
        provider: record.provider,
        connectionId,
        generation: -1,
        ...(sshDestination ? { sshDestination } : {}),
        hostLabel: host.ssh?.hostLabel ?? "this computer",
        folder: record.folder,
        state: record.state === "exited" ? "failed" : "detached",
        ...(record.state === "exited"
          ? { reason: plainExitReason([], record.exitCode ?? null) }
          : {}),
        url: `${ideBasePath(record.id)}/`,
        startedAt: record.startedAt,
        upstream: null,
        forward: null,
        epoch: ++this.epochs,
      });
      changed = true;
    }
    for (const instance of [...this.byId.values()])
      if (
        instance.sshDestination === sshDestination &&
        !seen.has(instance.id) &&
        instance.state === "detached" &&
        !instance.stopping &&
        !this.busy(instance.key) &&
        before.get(instance.id) === instance.epoch
      ) {
        // Gone from its host (stopped elsewhere, or the host restarted).
        this.byId.delete(instance.id);
        changed = true;
      }
    if (changed) this.onChange();
    return true;
  }

  /** World stops: end its attachments. Every server keeps running. */
  closeAll() {
    for (const instance of this.byId.values()) this.release(instance);
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
    hostLabel: instance.hostLabel,
    folder: instance.folder,
    state: instance.state,
    url: instance.url,
    startedAt: instance.startedAt,
    ...(instance.reason ? { reason: instance.reason } : {}),
    ...(instance.downloading ? { downloading: true } : {}),
    ...(instance.stopping ? { stopping: true } : {}),
  };
}
