/** Demand-driven evidence of a committed scene, never an animation-stop signal. */
export type CaptureView = "town" | "board" | "desk";
export type DrawReceipt = {
  view: CaptureView;
  owner: number;
  revision: number;
  width: number;
  height: number;
};
type Cancel = () => void;
type Options = {
  view: CaptureView;
  owner: number;
  assets(signal: AbortSignal): Promise<unknown>;
  active(): boolean;
  viewport(): { width: number; height: number };
  wake(): void;
  frame(callback: () => void): Cancel;
  deadline(callback: () => void, ms: number): Cancel;
  publish(receipt: DrawReceipt | null): void;
};

export class DrawReadiness {
  private revision = 0;
  private retired = false;
  private resources = false;
  private loading: AbortController | null = null;
  private preparing = false;
  private stage = "idle";
  private receipt: DrawReceipt | null = null;
  private paint: Cancel | null = null;
  private request: {
    resolve(value: DrawReceipt): void;
    reject(error: Error): void;
    cancel: Cancel;
  } | null = null;
  constructor(private readonly options: Options) {}

  invalidate(reason = "commit") {
    this.revision++;
    this.resources = false;
    this.cancelResources();
    this.receipt = null;
    this.paint?.();
    this.paint = null;
    this.stage = reason;
    this.options.publish(null);
    if (this.request) this.prepare();
  }
  private cancelResources() {
    const loading = this.loading;
    this.loading = null;
    loading?.abort();
  }
  private prepare() {
    this.stage = "assets";
    if (this.preparing) return;
    this.preparing = true;
    // Coalesce a synchronous commit/resize burst without retaining obsolete work.
    queueMicrotask(() => {
      this.preparing = false;
      const revision = this.revision,
        request = this.request;
      if (!request || this.retired) return;
      const loading = new AbortController();
      this.loading = loading;
      const current = () =>
        this.loading === loading &&
        request === this.request &&
        !this.retired &&
        revision === this.revision;
      void this.options.assets(loading.signal).then(
        () => {
          if (!current()) return;
          this.loading = null;
          this.resources = true;
          this.stage = "draw";
          this.options.wake();
        },
        () => {
          if (current()) this.fail("assets failed");
        },
      );
    });
  }
  wait(timeoutMs: number): Promise<DrawReceipt> {
    if (this.retired)
      return Promise.reject(new Error("Capture surface retired"));
    if (this.request)
      return Promise.reject(new Error("Capture already pending"));
    this.receipt = null;
    this.resources = false;
    this.options.publish(null);
    return new Promise((resolve, reject) => {
      const cancel = this.options.deadline(
        () => this.fail("deadline"),
        timeoutMs,
      );
      this.request = { resolve, reject, cancel };
      this.prepare();
    });
  }
  /** Called only after the owner's renderer really drew the committed scene. */
  drawn(pending?: string) {
    if (pending && this.receipt) this.invalidate(pending);
    if (!this.request || !this.resources || this.retired) return;
    if (pending) {
      this.paint?.();
      this.paint = null;
      this.stage = pending;
      return;
    }
    if (this.paint) return;
    const receipt = {
      view: this.options.view,
      owner: this.options.owner,
      revision: this.revision,
      ...this.options.viewport(),
    };
    const request = this.request;
    const current = () =>
      request === this.request &&
      !this.retired &&
      receipt.revision === this.revision &&
      this.options.active() &&
      receipt.width === this.options.viewport().width &&
      receipt.height === this.options.viewport().height;
    this.stage = "paint";
    // A subsequent animation frame crosses a browser paint opportunity. The
    // second callback also lets ResizeObserver/React layout commits fence it.
    this.paint = this.options.frame(() => {
      if (!current()) return;
      this.paint = this.options.frame(() => {
        if (!current()) return;
        this.paint = null;
        const request = this.request!;
        this.request = null;
        request.cancel();
        this.stage = "ready";
        this.receipt = receipt;
        this.options.publish(receipt);
        request.resolve(receipt);
      });
    });
  }
  matches(receipt: DrawReceipt) {
    return (
      !!this.receipt &&
      !this.retired &&
      this.options.active() &&
      JSON.stringify(receipt) === JSON.stringify(this.receipt) &&
      receipt.revision === this.revision &&
      receipt.width === this.options.viewport().width &&
      receipt.height === this.options.viewport().height
    );
  }
  diagnostics() {
    return {
      view: this.options.view,
      owner: this.options.owner,
      revision: this.revision,
      stage: this.stage,
      active: this.options.active(),
      ...this.options.viewport(),
    };
  }
  private fail(reason: string) {
    const request = this.request;
    if (!request) return;
    this.request = null;
    this.cancelResources();
    request.cancel();
    this.paint?.();
    this.paint = null;
    this.options.publish(null);
    request.reject(
      new Error(
        `Capture ${this.options.view} owner=${this.options.owner} revision=${this.revision} ${reason}; stage=${this.stage}`,
      ),
    );
  }
  dispose() {
    this.retired = true;
    this.fail("retired");
    this.invalidate("retired");
  }
}
