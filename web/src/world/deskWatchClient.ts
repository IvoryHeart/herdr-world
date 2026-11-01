import {
  deskReadKey,
  type DeskDeclaration,
  type DeskReadKind,
  type DeskReadNotice,
  type DeskReadTarget,
  type DeskReceiptTarget,
} from "../../../shared/deskAcquisition";

export type DeskWatchPorts = {
  enabled(): boolean;
  visible(): boolean;
  epoch(): number;
  declare(targets: DeskDeclaration): Promise<unknown>;
  changed(listener: () => void): () => void;
  reads(listener: (frame: unknown) => void): () => void;
  retry(callback: () => void): { cancel(): void };
};
type Subscription = {
  kind: DeskReadKind;
  targets: Map<string, DeskReceiptTarget | DeskReadTarget>;
  receive(frame: DeskReadNotice): void;
  current(target: DeskReadTarget): boolean;
};

/** One browser's whole Desk declaration and qualified, ordered read stream. */
export class DeskWatchClient {
  private readonly subscriptions = new Map<object, Subscription>();
  private readonly modes = new Set<() => void>();
  private readonly latest = new Map<string, DeskReadNotice>();
  private disconnect?: () => void;
  private pending: object | null = null;
  private acknowledged: string | null = null;
  private retry?: { cancel(): void };
  private failed: string | null = null;
  private snapshot = "";

  constructor(private readonly ports: DeskWatchPorts) {}

  getSnapshot = () =>
    `${this.ports.epoch()}:${this.ports.enabled() ? "shared" : "legacy"}`;
  enabled = () => this.ports.enabled();
  subscribe = (listener: () => void) => {
    this.modes.add(listener);
    this.start();
    return () => {
      this.modes.delete(listener);
      this.stopIfUnused();
    };
  };

  watch(
    owner: object,
    kind: DeskReadKind,
    targets: (DeskReadTarget | DeskReceiptTarget)[],
    receive: (frame: DeskReadNotice) => void,
    current: (target: DeskReadTarget) => boolean,
  ): void {
    const previous = this.subscriptions.get(owner);
    const next = {
      kind,
      targets: new Map(
        targets.map((target) => [deskReadKey(kind, target), target]),
      ),
      receive,
      current,
    };
    this.subscriptions.set(owner, next);
    this.prune();
    this.start();
    for (const [key, target] of next.targets) {
      const cached = this.latest.get(key);
      if (!previous?.targets.has(key) && cached)
        queueMicrotask(() => {
          if (
            this.subscriptions.get(owner) === next &&
            this.latest.get(key) === cached &&
            current(target) &&
            this.ports.enabled() &&
            this.ports.visible()
          )
            receive(cached);
        });
    }
    this.sync();
  }

  release(owner: object): void {
    this.subscriptions.delete(owner);
    this.prune();
    this.sync();
    this.stopIfUnused();
  }

  private prune(): void {
    const live = new Set(
      [...this.subscriptions.values()].flatMap((subscription) => [
        ...subscription.targets.keys(),
      ]),
    );
    for (const key of this.latest.keys())
      if (!live.has(key)) this.latest.delete(key);
  }

  private start(): void {
    if (this.disconnect) return;
    this.snapshot = this.getSnapshot();
    const changed = this.ports.changed(() => {
      const next = this.getSnapshot();
      if (next !== this.snapshot) {
        this.snapshot = next;
        this.pending = null;
        this.acknowledged = null;
        this.latest.clear();
        this.cancelRetry();
        for (const listener of [...this.modes]) listener();
      }
      this.sync();
      this.stopIfUnused();
    });
    const reads = this.ports.reads((frame) => this.receive(frame));
    this.disconnect = () => {
      changed();
      reads();
    };
  }

  private stopIfUnused(): void {
    if (
      this.subscriptions.size ||
      this.modes.size ||
      this.pending ||
      this.retry
    )
      return;
    this.disconnect?.();
    this.disconnect = undefined;
    this.cancelRetry();
    this.latest.clear();
    this.acknowledged = null;
    this.pending = null;
  }

  private cancelRetry(): void {
    this.retry?.cancel();
    this.retry = undefined;
    this.failed = null;
  }

  private sync(): void {
    if (!this.ports.enabled()) {
      this.acknowledged = null;
      this.pending = null;
      this.cancelRetry();
      return;
    }
    const screens = new Map<string, DeskReadTarget>(),
      receipts = new Map<string, DeskReceiptTarget>();
    if (this.ports.visible()) {
      for (const subscription of this.subscriptions.values())
        for (const [key, target] of subscription.targets) {
          if (!subscription.current(target)) continue;
          if (subscription.kind === "screen") screens.set(key, target);
          else receipts.set(key, target as DeskReceiptTarget);
        }
    }
    const targets = {
      screens: [...screens.values()],
      receipts: [...receipts.values()],
    };
    const signature = JSON.stringify([this.ports.epoch(), targets]);
    if (
      this.pending ||
      this.acknowledged === signature ||
      (this.retry && this.failed === signature)
    )
      return;
    this.cancelRetry();
    this.acknowledged = null;
    const request = {},
      epoch = this.ports.epoch();
    this.pending = request;
    void this.ports
      .declare(targets)
      .then(
        () => {
          if (this.pending === request && epoch === this.ports.epoch())
            this.acknowledged = signature;
        },
        () => {
          if (this.pending !== request || epoch !== this.ports.epoch()) return;
          this.failed = signature;
          this.retry = this.ports.retry(() => {
            this.retry = undefined;
            this.failed = null;
            this.sync();
            this.stopIfUnused();
          });
        },
      )
      .finally(() => {
        if (this.pending !== request) return;
        this.pending = null;
        this.sync();
        this.stopIfUnused();
      });
  }

  private receive(value: unknown): void {
    if (
      !this.ports.enabled() ||
      !this.ports.visible() ||
      !value ||
      typeof value !== "object"
    )
      return;
    const frame = value as DeskReadNotice;
    if (
      frame.type !== "world_desk_reads" ||
      (frame.kind !== "screen" && frame.kind !== "receipt") ||
      typeof frame.connection_id !== "string" ||
      !Number.isSafeInteger(frame.connection_generation) ||
      typeof frame.pane_id !== "string" ||
      !(frame.session === null || typeof frame.session === "string") ||
      !(frame.trigger === null || typeof frame.trigger === "string") ||
      (!Object.prototype.hasOwnProperty.call(frame, "result") &&
        typeof frame.error !== "string")
    )
      return;
    const key = deskReadKey(frame.kind, frame);
    for (const subscription of this.subscriptions.values()) {
      const target = subscription.targets.get(key);
      if (!target || !subscription.current(target)) continue;
      this.latest.set(key, frame);
      subscription.receive(frame);
    }
  }
}
