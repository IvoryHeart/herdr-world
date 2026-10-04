type Timing = {
  now(): number;
  schedule(callback: () => void, delay: number): unknown;
  cancel(timer: unknown): void;
};

/** Test fixture producer: preserve every intended input and its original due time. */
export function startIndependentInput(
  emit: (input: { sequence: number; dueAt: number; sentAt: number }) => void,
  timing: Timing = {
    now: Date.now,
    schedule: (callback, delay) => setTimeout(callback, delay),
    cancel: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  },
) {
  const began = timing.now();
  let sequence = 0;
  let stopped = false;
  let timer: unknown;
  const send = () => {
    if (stopped) return;
    emit({ sequence, dueAt: began + 5 + sequence * 75, sentAt: timing.now() });
    sequence++;
    timer = timing.schedule(
      send,
      Math.max(0, began + 5 + sequence * 75 - timing.now()),
    );
  };
  timer = timing.schedule(send, 5);
  return () => {
    stopped = true;
    timing.cancel(timer);
  };
}
