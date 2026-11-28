type Point = { x: number; y: number };

/** CDP acknowledges dispatch before Blink delivers the trusted touch event. */
export function nativeTouchDriver(
  target: EventTarget,
  dispatch: (type: string, points: Point[]) => Promise<void>,
  afterDelivery: () => Promise<void>,
  expiry = () => AbortSignal.timeout(6000),
) {
  let active = 0;
  let pending: { type: string; resolve(): void } | undefined;
  const observe = (event: Event) => {
    active = (event as TouchEvent).touches.length;
    if (event.type === pending?.type || event.type === "touchcancel")
      pending?.resolve();
  };
  const events = ["touchstart", "touchmove", "touchend", "touchcancel"];
  for (const type of events) target.addEventListener(type, observe, true);
  return {
    async send(type: string, points: Point[] = []) {
      if (pending) throw new Error("Overlapping native touch dispatch");
      // Blink may have cancelled the sequence while processing a move.
      if (type !== "touchStart" && active === 0) return dispatch(type, points);
      const delivered = Promise.withResolvers<void>();
      const signal = expiry();
      const fail = () =>
        delivered.reject(new Error(`Native ${type} was not delivered`));
      pending = { type: type.toLowerCase(), resolve: delivered.resolve };
      signal.addEventListener("abort", fail, { once: true });
      // Observe rejection even when dispatch itself fails first.
      void delivered.promise.catch(() => {});
      try {
        signal.throwIfAborted();
        await dispatch(type, points);
        await delivered.promise;
        // Native events can checkpoint microtasks between capture and target
        // listeners. A native task lets the complete dispatch drain first.
        await afterDelivery();
      } finally {
        signal.removeEventListener("abort", fail);
        pending = undefined;
      }
    },
    close() {
      for (const type of events)
        target.removeEventListener(type, observe, true);
    },
  };
}
