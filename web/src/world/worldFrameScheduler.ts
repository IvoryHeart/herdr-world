type FrameKind = "state" | "motion";
type FrameClient = {
  element: Element;
  draw(now: number): void;
  onPause?(paused: boolean): void;
  pending: FrameKind | null;
  visible: boolean;
  disposed: boolean;
};

/** One ordinary-task/rAF queue and one terminal-quiet signal for canvas views. */
class WorldFrameScheduler {
  readonly clients = new Set<FrameClient>();
  readonly quietListeners = new Set<(quiet: boolean) => void>();
  timer: ReturnType<typeof setTimeout> | null = null;
  frame: number | null = null;
  quietTimer: ReturnType<typeof setTimeout> | null = null;
  quiet = true;
  motion: MediaQueryList | null = null;
  intersection: IntersectionObserver | null = null;

  register(
    element: Element,
    draw: FrameClient["draw"],
    onPause?: FrameClient["onPause"],
  ) {
    if (!this.clients.size) this.start();
    const client: FrameClient = {
      element,
      draw,
      onPause,
      pending: null,
      visible: true,
      disposed: false,
    };
    this.clients.add(client);
    this.intersection?.observe(element);
    const request = (kind: FrameKind = "state") => {
      if (client.disposed) return;
      if (client.pending !== "state") client.pending = kind;
      this.schedule();
    };
    onPause?.(!this.quiet);
    return {
      request,
      cancel: () => {
        client.pending = null;
        this.reschedule();
      },
      dispose: () => {
        if (client.disposed) return;
        client.disposed = true;
        this.intersection?.unobserve(element);
        this.clients.delete(client);
        if (!this.clients.size) this.stop();
        else this.reschedule();
      },
      get motionAllowed() {
        return (
          scheduler.quiet &&
          !document.hidden &&
          client.visible &&
          !scheduler.motion?.matches
        );
      },
      get reducedMotion() {
        return scheduler.motion?.matches ?? false;
      },
    };
  }

  eligible(client: FrameClient) {
    return (
      !client.disposed &&
      !!client.pending &&
      client.visible &&
      !document.hidden &&
      (client.pending === "state" || (this.quiet && !this.motion?.matches))
    );
  }

  schedule = () => {
    if (
      this.timer !== null ||
      this.frame !== null ||
      ![...this.clients].some((client) => this.eligible(client))
    )
      return;
    // Ordinary tasks must run between canvas frames so socket replies progress.
    this.timer = setTimeout(() => {
      this.timer = null;
      this.frame = requestAnimationFrame(this.flush);
    }, 16);
  };

  flush = (now: number) => {
    this.frame = null;
    const began = performance.now();
    const clients = [...this.clients].filter((client) => this.eligible(client));
    clients.sort(
      (a, b) => Number(a.pending === "motion") - Number(b.pending === "motion"),
    );
    for (const client of clients) {
      if (!this.eligible(client)) continue;
      client.pending = null;
      client.draw(now);
      this.clients.delete(client);
      if (!client.disposed) this.clients.add(client);
      if (performance.now() - began >= 8) break;
    }
    this.schedule();
  };

  cancelFrame() {
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.timer = this.frame = null;
  }

  reschedule = () => {
    this.cancelFrame();
    this.schedule();
  };
  preferencesChanged = () => {
    for (const client of this.clients)
      if (client.pending === "motion") client.pending = "state";
    this.reschedule();
  };

  setQuiet(quiet: boolean) {
    if (quiet !== this.quiet) {
      this.quiet = quiet;
      for (const client of this.clients) client.onPause?.(!quiet);
      for (const listener of this.quietListeners) listener(quiet);
    }
    this.reschedule();
  }

  input = (event: Event) => {
    if (!(event.target instanceof Element) || !event.target.closest(".xterm"))
      return;
    if (this.quietTimer !== null) clearTimeout(this.quietTimer);
    this.setQuiet(false);
    this.quietTimer = setTimeout(() => {
      this.quietTimer = null;
      this.setQuiet(true);
    }, 180);
  };

  start() {
    this.motion ??= window.matchMedia("(prefers-reduced-motion: reduce)");
    this.motion.addEventListener("change", this.preferencesChanged);
    document.addEventListener("visibilitychange", this.reschedule);
    for (const type of ["keydown", "beforeinput", "paste"])
      document.addEventListener(type, this.input, true);
    if (typeof IntersectionObserver !== "undefined") {
      this.intersection = new IntersectionObserver((entries) => {
        for (const entry of entries)
          for (const client of this.clients)
            if (client.element === entry.target)
              client.visible = entry.isIntersecting;
        this.reschedule();
      });
    }
  }

  stop() {
    this.cancelFrame();
    if (this.quietTimer !== null) clearTimeout(this.quietTimer);
    this.quietTimer = null;
    this.quiet = true;
    this.motion?.removeEventListener("change", this.preferencesChanged);
    this.motion = null;
    this.intersection?.disconnect();
    this.intersection = null;
    document.removeEventListener("visibilitychange", this.reschedule);
    for (const type of ["keydown", "beforeinput", "paste"])
      document.removeEventListener(type, this.input, true);
  }
}

const scheduler = new WorldFrameScheduler();

export const registerWorldFrames = scheduler.register.bind(scheduler);
export type WorldFrames = ReturnType<typeof registerWorldFrames>;

export function terminalInputIsQuiet() {
  return scheduler.quiet;
}

export function worldMotionPreference() {
  return (scheduler.motion ??= window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ));
}

export function subscribeTerminalQuiet(listener: (quiet: boolean) => void) {
  scheduler.quietListeners.add(listener);
  return () => {
    scheduler.quietListeners.delete(listener);
  };
}
