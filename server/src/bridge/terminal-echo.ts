import type { Logger } from "../utils/logger";
/**
 * Echo timing only samples one typed character. Control keys, escape
 * sequences and pastes often redraw without a plain echo and skew the sample.
 */
export function isTypedCharacter(data: Uint8Array): boolean {
  if (data.length === 0 || data.length > 4) return false;
  const text = Buffer.from(data).toString("utf8");
  return (
    Array.from(text).length === 1 &&
    !/[\u0000-\u001f\u007f-\u009f\ufffd]/.test(text)
  );
}

// A typed character the next surface has not followed within this long is
// dropped from echo timing: the sample would mostly measure idle time.
export const ECHO_SAMPLE_MAX_MS = 5000;

/** The next surface is only an upper bound on echo; unrelated output can win. */
export class TerminalEchoTimer {
  private pending: number | null = null;
  constructor(
    private logger: Logger,
    private terminal: string,
  ) {}
  input(data: Uint8Array): void {
    if (!this.logger.enabled("debug") || !isTypedCharacter(data)) return;
    const now = performance.now();
    if (this.pending === null || now - this.pending > ECHO_SAMPLE_MAX_MS)
      this.pending = now;
  }
  surface(): () => void {
    const surfaceAt = performance.now();
    const sentAt =
      this.pending !== null && surfaceAt - this.pending <= ECHO_SAMPLE_MAX_MS
        ? this.pending
        : null;
    this.pending = null;
    return () => {
      if (sentAt !== null)
        this.logger.debug("terminal echo", {
          terminal: this.terminal,
          input_to_surface_max_ms: Math.round(surfaceAt - sentAt),
          surface_to_send_ms: Math.round(performance.now() - surfaceAt),
        });
    };
  }
}
